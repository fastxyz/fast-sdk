import {
  createEvmExecutor,
  createEvmWallet,
  executeDeposit,
  executeWithdraw,
} from "@fastxyz/allset-sdk";
import { bcsSchema, VersionedTransactionFromBcs } from "@fastxyz/fast-schema";
import {
  FastProvider,
  hashHex,
  Signer,
  TransactionBuilder,
  toHex,
} from "@fastxyz/fast-sdk";
import { bech32m } from "bech32";
import { defineCommand } from "citty";
import { Effect, Schema } from "effect";
import { globalArgs } from "../cli-globals.js";
import { runHandler } from "../cli-runner.js";
import {
  InvalidAddressError,
  InvalidAmountError,
  InvalidConfigError,
  TransactionFailedError,
  UnsupportedChainError,
  UserCancelledError,
} from "../errors/index.js";
import { makeHistoryEntry } from "../schemas/history.js";
import { AccountStore } from "../services/account/account-store.js";
import { Config } from "../services/cli-config.js";
import { FastRpc } from "../services/fast-rpc.js";
import { HistoryStore } from "../services/history-store.js";
import { NetworkConfigService } from "../services/network-config.js";
import { Output } from "../services/output.js";
import { Password } from "../services/password.js";
import { resolveToken } from "../services/token-resolver.js";

export const sendCommand = defineCommand({
  meta: {
    name: "send",
    description: "Send tokens (Fast→Fast, EVM→Fast, or Fast→EVM)",
  },
  args: {
    ...globalArgs,
    address: {
      type: "positional",
      description: "Recipient address (fast1... for Fast, 0x... for EVM)",
      required: true,
    },
    amount: {
      type: "positional",
      description: "Human-readable amount (e.g., 10.5)",
      required: true,
    },
    token: {
      type: "string",
      description:
        "Token to send (e.g., testUSDC, USDC). Defaults to the first token available on the current network.",
    },
    "from-chain": {
      type: "string",
      description: "Source EVM chain for bridge-in (e.g., arbitrum-sepolia)",
    },
    "to-chain": {
      type: "string",
      description:
        "Destination EVM chain for bridge-out (e.g., arbitrum-sepolia)",
    },
  },
  run: ({ args }) =>
    runHandler(
      args,
      Effect.gen(function* () {
        const accounts = yield* AccountStore;
        const passwordService = yield* Password;
        const rpc = yield* FastRpc;
        const output = yield* Output;
        const config = yield* Config;
        const historyStore = yield* HistoryStore;
        const networkConfig = yield* NetworkConfigService;

        const fromChain = args["from-chain"];
        const toChain = args["to-chain"];

        // Determine route
        const isFastAddress = args.address.startsWith("fast1");
        const isEvmAddress =
          args.address.startsWith("0x") && args.address.length === 42;

        if (!isFastAddress && !isEvmAddress) {
          return yield* Effect.fail(
            new InvalidAddressError({
              message: `Invalid recipient address "${args.address}". Must start with fast1 (Fast) or 0x (EVM).`,
            }),
          );
        }

        if (fromChain && isFastAddress === false) {
          // --from-chain with EVM address doesn't make sense
          return yield* Effect.fail(
            new InvalidAddressError({
              message: `--from-chain is for EVM→Fast deposits. Recipient must be a fast1 address.`,
            }),
          );
        }

        if (toChain && isEvmAddress === false) {
          return yield* Effect.fail(
            new InvalidAddressError({
              message: `--to-chain is for Fast→EVM withdrawals. Recipient must be a 0x EVM address.`,
            }),
          );
        }

        if (isEvmAddress && !toChain) {
          return yield* Effect.fail(
            new InvalidAddressError({
              message: `EVM recipient requires --to-chain. Example: fast send ${args.address} ${args.amount} --to-chain arbitrum-sepolia`,
            }),
          );
        }

        // Determine route label
        let route: "fast" | "evm-to-fast" | "fast-to-evm";
        if (fromChain) {
          route = "evm-to-fast";
        } else if (toChain) {
          route = "fast-to-evm";
        } else {
          route = "fast";
        }

        // Parse amount
        const amountFloat = Number.parseFloat(args.amount);
        if (Number.isNaN(amountFloat) || amountFloat <= 0) {
          return yield* Effect.fail(
            new InvalidAmountError({
              message: "Amount must be a positive number",
            }),
          );
        }

        // Resolve network
        const network = yield* networkConfig.resolve(config.network);

        // Resolve token name: use provided value or default to first token on the network
        const tokenChain = fromChain ?? toChain;
        const resolvedTokenName =
          args.token ??
          (() => {
            const chains = network.allset?.chains ?? {};
            const firstChain = Object.values(chains)[0];
            return firstChain
              ? (Object.keys(firstChain.tokens)[0] ?? "USDC")
              : "USDC";
          })();

        // Resolve token using the appropriate chain context
        const tokenInfo = yield* Effect.try({
          try: () => resolveToken(resolvedTokenName, network, tokenChain),
          catch: (e) => e as InvalidConfigError | Error,
        }).pipe(
          Effect.mapError((e) =>
            "message" in (e as object)
              ? (e as TransactionFailedError)
              : new TransactionFailedError({ message: String(e), cause: e }),
          ),
        );

        const { decimals } = tokenInfo;

        // Validate decimal places
        const decimalParts = args.amount.split(".");
        if (decimalParts.length > 1 && decimalParts[1]!.length > decimals) {
          return yield* Effect.fail(
            new InvalidAmountError({
              message: `Amount has too many decimal places for ${resolvedTokenName} (max ${decimals})`,
            }),
          );
        }

        const amountRaw = BigInt(Math.round(amountFloat * 10 ** decimals));

        // Resolve account and password
        const accountInfo = yield* accounts.resolveAccount(config.account);
        const pwd = yield* passwordService.resolve();
        const { seed } = yield* accounts.export_(accountInfo.name, pwd);

        // Interactive confirmation
        if (!config.nonInteractive && !config.json) {
          const routeLabel =
            route === "evm-to-fast"
              ? `EVM (${fromChain}) → Fast`
              : route === "fast-to-evm"
                ? `Fast → EVM (${toChain})`
                : "Fast → Fast";

          yield* output.humanLine(`Send ${args.amount} ${resolvedTokenName}`);
          yield* output.humanLine(
            `  From:  ${accountInfo.name} (${route === "evm-to-fast" ? accountInfo.evmAddress : accountInfo.fastAddress})`,
          );
          yield* output.humanLine(`  To:    ${args.address}`);
          yield* output.humanLine(`  Route: ${routeLabel}`);
          yield* output.humanLine(`  Token: ${resolvedTokenName}`);
          yield* output.humanLine("");
          const confirmed = yield* output.confirm("Confirm?");
          if (!confirmed) {
            return yield* Effect.fail(new UserCancelledError());
          }
        }

        let txHash: string;
        let estimatedTime: string | null = null;
        let evmExplorerUrl: string | null = null;

        if (route === "evm-to-fast") {
          // ── EVM → Fast (bridge-in) ──────────────────────────────────────────
          const allset = network.allset;
          if (!allset) {
            return yield* Effect.fail(
              new InvalidConfigError({
                message: `Network "${config.network}" does not have AllSet bridge config`,
              }),
            );
          }
          const chainCfg = allset.chains[fromChain!];
          if (!chainCfg) {
            return yield* Effect.fail(
              new UnsupportedChainError({ chain: fromChain! }),
            );
          }

          const evmAccount = createEvmWallet(toHex(seed));
          const evmClients = createEvmExecutor(
            evmAccount,
            chainCfg.evmRpcUrl,
            chainCfg.chainId,
          );

          const bridgeResult = yield* Effect.tryPromise({
            try: () =>
              executeDeposit({
                chainId: chainCfg.chainId,
                bridgeContract: chainCfg.bridgeContract as `0x${string}`,
                tokenAddress: tokenInfo.evmAddress! as `0x${string}`,
                isNative: false,
                amount: amountRaw.toString(),
                senderAddress: evmAccount.address,
                receiverAddress: args.address,
                evmClients,
              }),
            catch: (cause) =>
              new TransactionFailedError({
                message:
                  cause instanceof Error
                    ? cause.message
                    : "Bridge deposit failed",
                cause,
              }),
          });

          txHash = bridgeResult.txHash;
          evmExplorerUrl = chainCfg.evmExplorerUrl;
          estimatedTime = bridgeResult.estimatedTime ?? "1-5 minutes";
        } else if (route === "fast-to-evm") {
          // ── Fast → EVM (bridge-out) ─────────────────────────────────────────
          const allset = network.allset;
          if (!allset) {
            return yield* Effect.fail(
              new InvalidConfigError({
                message: `Network "${config.network}" does not have AllSet bridge config`,
              }),
            );
          }
          const chainCfg = allset.chains[toChain!];
          if (!chainCfg) {
            return yield* Effect.fail(
              new UnsupportedChainError({ chain: toChain! }),
            );
          }

          const signer = new Signer(seed);
          const provider = new FastProvider({ rpcUrl: network.rpcUrl });

          const bridgeResult = yield* Effect.tryPromise({
            try: () =>
              executeWithdraw({
                fastBridgeAddress: chainCfg.fastBridgeAddress,
                relayerUrl: chainCfg.relayerUrl,
                crossSignUrl: allset.crossSignUrl,
                tokenEvmAddress: tokenInfo.evmAddress!,
                tokenFastTokenId: toHex(tokenInfo.fastTokenId).slice(2),
                amount: amountRaw.toString(),
                receiverEvmAddress: args.address,
                signer,
                provider,
                networkId: network.networkId,
              }),
            catch: (cause) =>
              new TransactionFailedError({
                message:
                  cause instanceof Error
                    ? cause.message
                    : "Bridge withdrawal failed",
                cause,
              }),
          });

          txHash = bridgeResult.txHash;
          estimatedTime = bridgeResult.estimatedTime ?? "1-5 minutes";
        } else {
          // ── Fast → Fast ─────────────────────────────────────────────────────
          const signer = new Signer(seed);

          const publicKey = yield* Effect.tryPromise({
            try: () => signer.getPublicKey(),
            catch: (cause) =>
              new TransactionFailedError({
                message: "Failed to get public key",
                cause,
              }),
          });

          const accountInfoRpc = yield* rpc.getAccountInfo({
            address: publicKey,
            tokenBalancesFilter: null,
            stateKeyFilter: null,
            certificateByNonce: null,
          });
          const nonce = (accountInfoRpc as any)?.nextNonce ?? 0n;

          const recipientBytes = new Uint8Array(
            bech32m.fromWords(bech32m.decode(args.address).words),
          );

          const builder = new TransactionBuilder({
            networkId: network.networkId as any,
            signer,
            nonce,
          });

          const envelope = yield* Effect.tryPromise({
            try: () =>
              builder
                .addTokenTransfer({
                  tokenId: tokenInfo.fastTokenId,
                  recipient: recipientBytes,
                  amount: amountRaw,
                  userData: null,
                })
                .sign(),
            catch: (cause) =>
              new TransactionFailedError({
                message: "Failed to build transaction",
                cause,
              }),
          });

          yield* rpc.submitTransaction(envelope);

          // Compute the transaction hash from the signed envelope
          const bcsInput = yield* Schema.encode(VersionedTransactionFromBcs)(
            envelope.transaction,
          ).pipe(
            Effect.mapError(
              (cause) =>
                new TransactionFailedError({
                  message: "Failed to encode transaction for hashing",
                  cause,
                }),
            ),
          );
          txHash = yield* Effect.tryPromise({
            try: () => hashHex(bcsSchema.VersionedTransaction, bcsInput),
            catch: (cause) =>
              new TransactionFailedError({
                message: "Failed to compute transaction hash",
                cause,
              }),
          });
        }

        // evm-to-fast: EVM deposit tx → EVM chain explorer (/tx/)
        // fast-to-evm: Fast burn tx → Fast explorer (/txs/)
        // fast→fast:   Fast tx → Fast explorer (/txs/)
        const explorerUrl =
          route === "evm-to-fast" && evmExplorerUrl
            ? `${evmExplorerUrl}/tx/${txHash}`
            : `${network.explorerUrl}/txs/${txHash}`;

        // Record in local history
        yield* historyStore.record(
          makeHistoryEntry({
            hash: txHash,
            type: "transfer",
            from:
              route === "evm-to-fast"
                ? accountInfo.evmAddress
                : accountInfo.fastAddress,
            to: args.address,
            amount: amountRaw.toString(),
            formatted: args.amount,
            tokenName: resolvedTokenName,
            tokenId: toHex(tokenInfo.fastTokenId),
            network: config.network,
            status: route === "fast" ? "confirmed" : "pending",
            timestamp: new Date().toISOString(),
            explorerUrl,
            route,
            chainId:
              route === "evm-to-fast"
                ? network.allset!.chains[fromChain!]!.chainId
                : route === "fast-to-evm"
                  ? network.allset!.chains[toChain!]!.chainId
                  : null,
          }),
        );

        if (estimatedTime) {
          yield* output.humanLine(
            `Sent ${args.amount} ${resolvedTokenName} to ${args.address}`,
          );
          yield* output.humanLine(`  Transaction: ${txHash}`);
          yield* output.humanLine(`  Explorer:    ${explorerUrl}`);
          yield* output.humanLine(`  Estimated:   ${estimatedTime}`);
        } else {
          yield* output.humanLine(
            `Sent ${args.amount} ${resolvedTokenName} to ${args.address}`,
          );
          yield* output.humanLine(`  Transaction: ${txHash}`);
          yield* output.humanLine(`  Explorer:    ${explorerUrl}`);
        }

        yield* output.success({
          txHash,
          from:
            route === "evm-to-fast"
              ? accountInfo.evmAddress
              : accountInfo.fastAddress,
          to: args.address,
          amount: amountRaw.toString(),
          formatted: args.amount,
          tokenName: resolvedTokenName,
          route,
          explorerUrl,
          estimatedTime,
        });
      }),
    ),
});
