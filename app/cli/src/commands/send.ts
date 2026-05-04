import {
  bcsSchema,
  type TransactionEnvelope,
  VersionedTransactionFromBcs,
} from "@fastxyz/schema";
import {
  encodeDepositCalldata,
  fastAddressToBytes32,
  InsufficientBalanceError as SDKInsufficientBalanceError,
  smartDeposit,
} from "@fastxyz/allset-sdk";
import {
  FastProvider,
  hashHex,
  Signer,
  TransactionBuilder,
  toHex,
} from "@fastxyz/sdk";
import { bech32m } from "bech32";
import { Effect, Schema } from "effect";
import type { SendArgs } from "../cli.js";
import type { ClientError } from "../errors/index.js";
import {
  CommandUnsupportedForTokenError,
  InvalidAddressError,
  InvalidAmountError,
  InvalidNetworkConfigError,
  FundingRequiredError,
  TokenNotFoundError,
  TransactionFailedError,
  UnsupportedChainError,
  WalletKindMismatchError,
} from "../errors/index.js";
import { InvalidUsageError } from "../errors/usage.js";
import { makeHistoryEntry } from "../schemas/history.js";
import { AllSet } from "../services/api/allset.js";
import { FastRpc } from "../services/api/fast.js";
import { ClientConfig } from "../services/config/client.js";
import { Output } from "../services/output.js";
import { Prompt } from "../services/prompt.js";
import { resolveSigner } from "../services/signer-resolver.js";
import { AccountStore } from "../services/storage/account.js";
import { HistoryStore } from "../services/storage/history.js";
import { NetworkConfigService } from "../services/storage/network.js";
import {
  resolveToken,
  tokenIsKnownOnNetwork,
} from "../services/token-resolver.js";
import type { Command } from "./index.js";

export const send: Command<SendArgs> = {
  cmd: "send",
  handler: (args: SendArgs) =>
    Effect.gen(function* () {
      const accounts = yield* AccountStore;
      const bridge = yield* AllSet;
      const prompt = yield* Prompt;
      const rpc = yield* FastRpc;
      const output = yield* Output;
      const config = yield* ClientConfig;
      const historyStore = yield* HistoryStore;
      const networkConfig = yield* NetworkConfigService;

      const fromChain = args.fromChain;
      const toChain = args.toChain;

      // Determine route
      const isFastAddress = args.address.startsWith("fast1");
      const isEvmAddress =
        args.address.startsWith("0x") && args.address.length === 42;

      if (!isFastAddress && !isEvmAddress) {
        const msg = args.address.startsWith("0x")
          ? `Invalid EVM address "${args.address}": expected 42 characters (0x + 40 hex digits), got ${args.address.length}.`
          : `Invalid recipient address "${args.address}". Must start with fast1 (Fast network) or 0x (EVM).`;
        return yield* Effect.fail(new InvalidAddressError({ message: msg }));
      }

      if (fromChain && isFastAddress === false) {
        // --from-chain with EVM address doesn't make sense
        return yield* Effect.fail(
          new InvalidAddressError({
            message: `--from-chain is for EVM → Fast deposits. Recipient must be a fast1 address.`,
          }),
        );
      }

      if (toChain && isEvmAddress === false) {
        return yield* Effect.fail(
          new InvalidAddressError({
            message: `--to-chain is for Fast → EVM withdrawals. Recipient must be a 0x EVM address.`,
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
      if (Number.isNaN(amountFloat)) {
        return yield* Effect.fail(
          new InvalidAmountError({
            message: `Invalid amount "${args.amount}". Expected a positive number (e.g., 10 or 1.5).`,
          }),
        );
      }
      if (amountFloat <= 0) {
        return yield* Effect.fail(
          new InvalidAmountError({
            message: `Amount must be greater than zero (got "${args.amount}").`,
          }),
        );
      }

      // Resolve network
      const network = yield* networkConfig.resolve(config.network);

      // Resolve token name: explicit --token wins; otherwise use the network's default.
      const tokenChain = fromChain ?? toChain;
      const tokenWasDefaulted = args.token === undefined;
      const resolvedTokenName = args.token ?? network.defaultToken?.symbol;
      if (resolvedTokenName === undefined) {
        return yield* Effect.fail(
          new InvalidUsageError({
            message: `No default token found on ${config.network}; please specify a token.`,
          }),
        );
      }

      // Resolve token using the appropriate chain context.
      // When chain context is present and the token IS known on the network
      // but not on this specific chain, rewrap as CommandUnsupportedForTokenError
      // so the user sees "send --from-chain X is not supported for fastUSD on …"
      // instead of the generic "Unknown token" message.
      const tokenInfo = yield* Effect.try({
        try: () => resolveToken(resolvedTokenName, network, tokenChain),
        catch: (e) => e as TokenNotFoundError | UnsupportedChainError | Error,
      }).pipe(
        Effect.mapError((e): ClientError => {
          if (
            e instanceof TokenNotFoundError &&
            tokenChain !== undefined &&
            (tokenWasDefaulted ||
              tokenIsKnownOnNetwork(network, resolvedTokenName))
          ) {
            const commandLabel = fromChain
              ? `send --from-chain ${fromChain}`
              : `send --to-chain ${toChain}`;
            const suggestion = tokenWasDefaulted
              ? `Pass --token explicitly. See 'fast info bridge-tokens' for tokens available on ${tokenChain}.`
              : `See 'fast info bridge-tokens' for tokens available on ${tokenChain}.`;
            return new CommandUnsupportedForTokenError({
              command: commandLabel,
              token: resolvedTokenName,
              network: config.network,
              suggestion,
            });
          }
          if (
            e instanceof TokenNotFoundError ||
            e instanceof UnsupportedChainError
          ) {
            return e;
          }
          return new TransactionFailedError({ message: String(e), cause: e });
        }),
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

      // Resolve account.
      // EVM-bridging routes require a single-signer account (we need the seed
      // to sign EVM transactions). Fast → Fast tolerates multisig and uses
      // resolveSigner to dispatch on account kind.
      const accountInfo = yield* accounts.resolveAccount(config.account);
      if (
        (route === "evm-to-fast" || route === "fast-to-evm") &&
        accountInfo.kind !== "single"
      ) {
        return yield* Effect.fail(
          new WalletKindMismatchError({
            name: accountInfo.name,
            expected: "single",
            hint: "EVM bridging requires a single-signer account.",
          }),
        );
      }

      // Password resolution.
      // - single + encrypted: prompt for the keystore password.
      // - single + unencrypted: no password needed.
      // - multisig: prompt for the resolved member's keystore password
      //   (resolveSigner will pick the member and call accounts.export).
      const pwd: string | null =
        accountInfo.kind === "single"
          ? accountInfo.encrypted
            ? yield* prompt.password()
            : null
          : yield* prompt.password();

      // The route-specific guard above narrows EVM routes to single-signer.
      // Pre-derive the "from" address used in the confirmation prompt + history.
      const fromAddress =
        route === "evm-to-fast" && accountInfo.kind === "single"
          ? accountInfo.evmAddress
          : accountInfo.fastAddress;

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
          `  From:  ${accountInfo.name} (${fromAddress})`,
        );
        yield* output.humanLine(`  To:    ${args.address}`);
        yield* output.humanLine(`  Route: ${routeLabel}`);
        yield* output.humanLine(`  Token: ${resolvedTokenName}`);
        yield* output.humanLine("");
        const confirmed = yield* prompt.confirm("Confirm?");
        if (!confirmed) return;
      }

      let txHash: string;
      let estimatedTime: string | null = null;
      let evmExplorerUrl: string | null = null;

      if (route === "evm-to-fast") {
        // ── EVM → Fast (bridge-in) ──────────────────────────────────────────
        // Single-signer guard above ensures kind === "single" here.
        if (accountInfo.kind !== "single") {
          return yield* Effect.fail(
            new WalletKindMismatchError({
              name: accountInfo.name,
              expected: "single",
              hint: "EVM bridging requires a single-signer account.",
            }),
          );
        }
        const { seed } = yield* accounts.export(accountInfo.name, pwd);

        const allset = network.allSet;
        if (!allset) {
          return yield* Effect.fail(
            new InvalidNetworkConfigError({ name: config.network }),
          );
        }
        const chainCfg = allset.chains[fromChain!];
        if (!chainCfg) {
          return yield* Effect.fail(
            new UnsupportedChainError({ chain: fromChain! }),
          );
        }

        if (args.eip7702) {
          // EIP-7702: gas paid in USDC via paymaster, no ETH required
          const depositCalldata = encodeDepositCalldata({
            tokenAddress: tokenInfo.evmAddress!,
            amount: amountRaw,
            receiverBytes32: fastAddressToBytes32(args.address),
          });

          const smartResult = yield* Effect.tryPromise({
            try: () =>
              smartDeposit({
                privateKey: toHex(seed) as `0x${string}`,
                rpcUrl: chainCfg.evmRpcUrl,
                allsetApiUrl: allset.portalApiUrl,
                tokenAddress: tokenInfo.evmAddress! as `0x${string}`,
                amount: amountRaw,
                bridgeAddress: chainCfg.bridgeContract as `0x${string}`,
                depositCalldata,
              }),
            catch: (e) => {
              if (e instanceof SDKInsufficientBalanceError) {
                return new FundingRequiredError({ message: e.message });
              }
              return new TransactionFailedError({
                message: String(e),
                cause: e,
              });
            },
          });

          txHash = smartResult.txHash;
          evmExplorerUrl = chainCfg.evmExplorerUrl;
        } else {
          const evmAccount = bridge.createWallet(toHex(seed));
          // Cast needed: viem version mismatch between allset-sdk and cli
          const evmClients = bridge.createExecutor(
            evmAccount as Parameters<typeof bridge.createExecutor>[0],
            chainCfg.evmRpcUrl,
            chainCfg.chainId,
          );

          const bridgeResult = yield* bridge.deposit({
            chainId: chainCfg.chainId,
            bridgeContract: chainCfg.bridgeContract as `0x${string}`,
            tokenAddress: tokenInfo.evmAddress! as `0x${string}`,
            isNative: false,
            amount: amountRaw.toString(),
            receiverAddress: args.address,
            evmClients,
          });

          txHash = bridgeResult.txHash;
          evmExplorerUrl = chainCfg.evmExplorerUrl;
          estimatedTime = bridgeResult.estimatedTime ?? "1-5 minutes";
        }
      } else if (route === "fast-to-evm") {
        // ── Fast → EVM (bridge-out) ─────────────────────────────────────────
        if (accountInfo.kind !== "single") {
          return yield* Effect.fail(
            new WalletKindMismatchError({
              name: accountInfo.name,
              expected: "single",
              hint: "EVM bridging requires a single-signer account.",
            }),
          );
        }
        const { seed } = yield* accounts.export(accountInfo.name, pwd);

        const allset = network.allSet;
        if (!allset) {
          return yield* Effect.fail(
            new InvalidNetworkConfigError({ name: config.network }),
          );
        }
        const chainCfg = allset.chains[toChain!];
        if (!chainCfg) {
          return yield* Effect.fail(
            new UnsupportedChainError({ chain: toChain! }),
          );
        }

        const signer = new Signer(seed);
        const provider = new FastProvider(network);

        const bridgeResult = yield* bridge.withdraw({
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
        });

        txHash = bridgeResult.txHash;
        estimatedTime = bridgeResult.estimatedTime ?? "1-5 minutes";
      } else {
        // ── Fast → Fast ─────────────────────────────────────────────────────
        // Polymorphic: works for single-signer + multisig accounts.
        const resolved = yield* resolveSigner({
          account: accountInfo,
          asMember: args.as,
          password: pwd,
        });

        const recipientBytes = new Uint8Array(
          bech32m.fromWords(bech32m.decode(args.address).words),
        );
        const tokenTransfer = {
          tokenId: tokenInfo.fastTokenId,
          recipient: recipientBytes,
          amount: amountRaw,
          userData: null,
        };

        let envelope: TransactionEnvelope;
        if (resolved.kind === "single") {
          const senderPubkey = yield* Effect.tryPromise({
            try: () => resolved.signer.getPublicKey(),
            catch: (cause) =>
              new TransactionFailedError({
                message: "Failed to get public key",
                cause,
              }),
          });
          const accountInfoRpc = yield* rpc.getAccountInfo({
            address: senderPubkey,
            tokenBalancesFilter: null,
            stateKeyFilter: null,
            certificateByNonce: null,
          } as never);
          const nonce = (accountInfoRpc as any)?.nextNonce ?? 0n;

          envelope = yield* Effect.tryPromise({
            try: () =>
              new TransactionBuilder({
                networkId: network.networkId as any,
                signer: resolved.signer,
                nonce,
              })
                .addTokenTransfer(tokenTransfer)
                .sign(),
            catch: (cause) =>
              new TransactionFailedError({
                message: "Failed to build transaction",
                cause,
              }),
          });
        } else {
          const senderBytes = yield* Effect.tryPromise({
            try: () => resolved.signer.getDerivedAddressBytes(),
            catch: (cause) =>
              new TransactionFailedError({
                message: "Failed to derive multisig address",
                cause,
              }),
          });
          const accountInfoRpc = yield* rpc.getAccountInfo({
            address: senderBytes,
            tokenBalancesFilter: null,
            stateKeyFilter: null,
            certificateByNonce: null,
          } as never);
          const nonce = (accountInfoRpc as any)?.nextNonce ?? 0n;

          envelope = yield* Effect.tryPromise({
            try: () =>
              resolved.signer.signTransaction({
                networkId: network.networkId as any,
                nonce,
                operations: [
                  { type: "TokenTransfer" as const, value: tokenTransfer },
                ],
              }),
            catch: (cause) =>
              new TransactionFailedError({
                message: "Failed to sign multisig transaction",
                cause,
              }),
          });
        }

        const submitResult = yield* rpc.submitTransaction(envelope);

        // Multisig partial: the proxy returns IncompleteMultiSig until quorum.
        // Skip hash computation + history record; we have no on-chain cert yet.
        const submitObj =
          (submitResult as { type?: string } | null) ?? null;
        if (submitObj?.type === "IncompleteMultiSig") {
          const quorum =
            resolved.kind === "multisig"
              ? resolved.account.multisigConfig.quorum
              : 1;
          yield* output.humanLine(
            `Submitted as multisig partial: 1/${quorum} signatures collected.`,
          );
          yield* output.humanLine(
            `Cosigners can run \`fast multisig pending\` to view, \`fast multisig vote\` to sign.`,
          );
          yield* output.ok({
            status: "incomplete-multisig",
            wallet: accountInfo.name,
            fastAddress: accountInfo.fastAddress,
            signedAs:
              resolved.kind === "multisig"
                ? resolved.memberAccount.name
                : accountInfo.name,
            signedCount: 1,
            quorum,
          });
          return;
        }

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
          from: fromAddress,
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
              ? network.allSet!.chains[fromChain!]!.chainId
              : route === "fast-to-evm"
                ? network.allSet!.chains[toChain!]!.chainId
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

      yield* output.ok({
        txHash,
        from: fromAddress,
        to: args.address,
        amount: amountRaw.toString(),
        formatted: args.amount,
        tokenName: resolvedTokenName,
        route,
        explorerUrl,
        estimatedTime,
      });
    }),
};
