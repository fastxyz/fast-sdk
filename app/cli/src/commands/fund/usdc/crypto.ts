import {
  encodeDepositCalldata,
  fastAddressToBytes32,
  InsufficientBalanceError as SDKInsufficientBalanceError,
  smartDeposit,
  weiToTokenUnits,
} from "@fastxyz/allset-sdk";
import { toHex } from "@fastxyz/sdk";
import { Effect } from "effect";
import type { FundUsdcCryptoArgs } from "../../../cli.js";
import type { ClientError } from "../../../errors/index.js";
import {
  CommandUnsupportedForTokenError,
  FundingRequiredError,
  InvalidAmountError,
  InvalidNetworkConfigError,
  TokenNotFoundError,
  TransactionFailedError,
  UnsupportedChainError,
} from "../../../errors/index.js";
import { InvalidUsageError } from "../../../errors/usage.js";
import { makeHistoryEntry } from "../../../schemas/history.js";
import { AllSet } from "../../../services/api/allset.js";
import { ClientConfig } from "../../../services/config/client.js";
import { Output } from "../../../services/output.js";
import { Prompt } from "../../../services/prompt.js";
import { AccountStore } from "../../../services/storage/account.js";
import { HistoryStore } from "../../../services/storage/history.js";
import { NetworkConfigService } from "../../../services/storage/network.js";
import {
  resolveToken,
  tokenIsKnownOnNetwork,
} from "../../../services/token-resolver.js";
import type { Command } from "../../index.js";

export const fundUsdcCrypto: Command<FundUsdcCryptoArgs> = {
  cmd: "fund-usdc-crypto",
  handler: (args: FundUsdcCryptoArgs) =>
    Effect.gen(function* () {
      const accounts = yield* AccountStore;
      const bridge = yield* AllSet;
      const output = yield* Output;
      const config = yield* ClientConfig;
      const prompt = yield* Prompt;
      const networkConfig = yield* NetworkConfigService;
      const historyStore = yield* HistoryStore;

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

      // Resolve network and account
      const network = yield* networkConfig.resolve(config.network);
      const accountInfo = yield* accounts.resolveAccount(config.account);

      if (!network.allSet) {
        return yield* Effect.fail(
          new InvalidNetworkConfigError({ name: config.network }),
        );
      }

      const chainCfg = network.allSet.chains[args.chain];
      if (!chainCfg) {
        return yield* Effect.fail(new UnsupportedChainError({ chain: args.chain }));
      }

      // Resolve token name: explicit --token wins; otherwise use the network's default.
      const tokenWasDefaulted = args.token === undefined;
      const tokenName = args.token ?? network.defaultToken?.symbol;
      if (tokenName === undefined) {
        return yield* Effect.fail(
          new InvalidUsageError({
            message: `No default token found on ${config.network}; please specify a token.`,
          }),
        );
      }

      const tokenInfo = yield* Effect.try({
        try: () => resolveToken(tokenName, network, args.chain),
        catch: (e) => e as TokenNotFoundError | UnsupportedChainError | Error,
      }).pipe(
        Effect.mapError((e): ClientError => {
          if (
            e instanceof TokenNotFoundError &&
            (tokenWasDefaulted ||
              tokenIsKnownOnNetwork(network, tokenName))
          ) {
            const suggestion = tokenWasDefaulted
              ? `Try --token USDC. Pass --token explicitly. See 'fast info bridge-tokens' for tokens available on ${args.chain}.`
              : `Try --token USDC. See 'fast info bridge-tokens' for tokens available on ${args.chain}.`;
            return new CommandUnsupportedForTokenError({
              command: "fund usdc crypto",
              token: tokenName,
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
            message: `Amount has too many decimal places for ${tokenName} (max ${decimals})`,
          }),
        );
      }

      const amountRaw = BigInt(Math.round(amountFloat * 10 ** decimals));
      const fmt = (n: bigint) =>
        (Number(n) / 10 ** decimals).toFixed(decimals).replace(/\.?0+$/, "");

      const gasSymbol = chainCfg.gasToken?.symbol ?? "ETH";
      // On chains whose gas token is the deposited ERC-20 (Arc: USDC), the
      // approve + deposit fees come out of the same balance as the deposit, so
      // the balance must cover amount + a fee reserve. Skipped for EIP-7702,
      // where the paymaster charges gas separately.
      const depositTokenIsGasToken =
        !args.eip7702 &&
        chainCfg.gasToken?.erc20Address !== undefined &&
        chainCfg.gasToken.erc20Address.toLowerCase() === tokenInfo.evmAddress!.toLowerCase();
      let gasReserveRaw = 0n;
      if (depositTokenIsGasToken) {
        const reserveWei = yield* bridge.gasReserve(chainCfg.evmRpcUrl);
        // native units are 18 decimals; convert to the token's smallest unit
        gasReserveRaw = weiToTokenUnits(reserveWei, decimals);
      }
      const requiredRaw = amountRaw + gasReserveRaw;

      // Check ERC-20 balance on the specified chain
      const balance = yield* bridge.erc20Balance(
        chainCfg.evmRpcUrl,
        tokenInfo.evmAddress!,
        accountInfo.evmAddress,
      );

      if (balance < requiredRaw) {
        const shortfall = requiredRaw - balance;

        yield* output.humanLine(
          `Insufficient ${tokenName} balance on ${args.chain}.`,
        );
        yield* output.humanLine("");
        yield* output.humanLine(`  EVM address:  ${accountInfo.evmAddress}`);
        yield* output.humanLine(`  Chain:        ${args.chain}`);
        yield* output.humanLine(`  Current:      ${fmt(balance)} ${tokenName}`);
        yield* output.humanLine(`  Required:     ${args.amount} ${tokenName}`);
        if (depositTokenIsGasToken) {
          yield* output.humanLine(
            `  Gas reserve:  ${fmt(gasReserveRaw)} ${tokenName} (${args.chain} pays gas in ${gasSymbol})`,
          );
        }
        yield* output.humanLine(`  Shortfall:    ${fmt(shortfall)} ${tokenName}`);
        yield* output.humanLine("");
        yield* output.humanLine(
          `Send at least ${fmt(shortfall)} ${tokenName} to the EVM address above on ${args.chain}.`,
        );
        if (!args.eip7702 && !depositTokenIsGasToken) {
          yield* output.humanLine(
            `Note: You will also need ${gasSymbol} for gas fees on ${args.chain}.`,
          );
        }

        return yield* Effect.fail(
          new FundingRequiredError({
            message: `Insufficient balance: need ${fmt(shortfall)} more ${tokenName} on ${args.chain}.`,
          }),
        );
      }

      // Check native balance for gas (skipped for EIP-7702 — gas paid via paymaster —
      // and when the deposit token is the gas token, already covered by the reserve above)
      if (!args.eip7702 && !depositTokenIsGasToken) {
        const ethBalance = yield* bridge.nativeBalance(
          chainCfg.evmRpcUrl,
          accountInfo.evmAddress,
        );
        if (ethBalance === 0n) {
          yield* output.humanLine(`Insufficient ${gasSymbol} for gas on ${args.chain}.`);
          yield* output.humanLine("");
          yield* output.humanLine(`  EVM address:  ${accountInfo.evmAddress}`);
          yield* output.humanLine(`  Chain:        ${args.chain}`);
          yield* output.humanLine(`  ${gasSymbol} balance:  0`);
          yield* output.humanLine("");
          yield* output.humanLine(
            `Send ${gasSymbol} to the EVM address above on ${args.chain} to cover gas fees.`,
          );

          return yield* Effect.fail(
            new FundingRequiredError({
              message: `No ${gasSymbol} for gas on ${args.chain}. Send ${gasSymbol} to ${accountInfo.evmAddress}.`,
            }),
          );
        }
      }

      const pwd = accountInfo.encrypted ? yield* prompt.password() : null;
      const { seed } = yield* accounts.export(accountInfo.name, pwd);

      if (args.eip7702) {
        // EIP-7702 path — gas paid in USDC via ERC-20 paymaster, no ETH required
        if (!network.allSet) {
          return yield* Effect.fail(
            new InvalidNetworkConfigError({ name: config.network }),
          );
        }

        const depositCalldata = encodeDepositCalldata({
          tokenAddress: tokenInfo.evmAddress!,
          amount: amountRaw,
          receiverBytes32: fastAddressToBytes32(accountInfo.fastAddress),
        });

        const smartResult = yield* Effect.tryPromise({
          try: () =>
            smartDeposit({
              privateKey: toHex(seed) as `0x${string}`,
              rpcUrl: chainCfg.evmRpcUrl,
              allsetApiUrl: network.allSet!.portalApiUrl,
              tokenAddress: tokenInfo.evmAddress! as `0x${string}`,
              amount: amountRaw,
              bridgeAddress: chainCfg.bridgeContract as `0x${string}`,
              depositCalldata,
            }),
          catch: (e) => {
            if (e instanceof SDKInsufficientBalanceError) {
              return new FundingRequiredError({ message: e.message });
            }
            return new TransactionFailedError({ message: String(e), cause: e });
          },
        });

        const explorerUrl = `${chainCfg.evmExplorerUrl}/tx/${smartResult.txHash}`;

        yield* historyStore.record(
          makeHistoryEntry({
            hash: smartResult.txHash,
            type: "transfer",
            from: accountInfo.evmAddress,
            to: accountInfo.fastAddress,
            amount: amountRaw.toString(),
            formatted: args.amount,
            tokenName,
            tokenId: toHex(tokenInfo.fastTokenId),
            network: config.network,
            status: "pending",
            timestamp: new Date().toISOString(),
            explorerUrl,
            route: "evm-to-fast",
            chainId: chainCfg.chainId,
          }),
        );

        yield* output.humanLine(
          `Funded ${args.amount} ${tokenName} to ${accountInfo.fastAddress} (EIP-7702)`,
        );
        yield* output.humanLine(`  Transaction: ${smartResult.txHash}`);
        yield* output.humanLine(`  UserOp:      ${smartResult.userOpHash}`);
        yield* output.humanLine(`  Explorer:    ${explorerUrl}`);

        yield* output.ok({
          txHash: smartResult.txHash,
          userOpHash: smartResult.userOpHash,
          from: accountInfo.evmAddress,
          to: accountInfo.fastAddress,
          amount: amountRaw.toString(),
          formatted: args.amount,
          tokenName,
          chain: args.chain,
          explorerUrl,
        });

        return;
      }

      // Standard EVM deposit path
      const evmAccount = bridge.createWallet(toHex(seed));
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
        receiverAddress: accountInfo.fastAddress,
        evmClients,
      });

      const explorerUrl = `${chainCfg.evmExplorerUrl}/tx/${bridgeResult.txHash}`;
      const estimatedTime = bridgeResult.estimatedTime ?? "1-5 minutes";

      yield* historyStore.record(
        makeHistoryEntry({
          hash: bridgeResult.txHash,
          type: "transfer",
          from: accountInfo.evmAddress,
          to: accountInfo.fastAddress,
          amount: amountRaw.toString(),
          formatted: args.amount,
          tokenName,
          tokenId: toHex(tokenInfo.fastTokenId),
          network: config.network,
          status: "pending",
          timestamp: new Date().toISOString(),
          explorerUrl,
          route: "evm-to-fast",
          chainId: chainCfg.chainId,
        }),
      );

      yield* output.humanLine(
        `Funded ${args.amount} ${tokenName} to ${accountInfo.fastAddress}`,
      );
      yield* output.humanLine(`  Transaction: ${bridgeResult.txHash}`);
      yield* output.humanLine(`  Explorer:    ${explorerUrl}`);
      yield* output.humanLine(`  Estimated:   ${estimatedTime}`);

      yield* output.ok({
        txHash: bridgeResult.txHash,
        from: accountInfo.evmAddress,
        to: accountInfo.fastAddress,
        amount: amountRaw.toString(),
        formatted: args.amount,
        tokenName,
        chain: args.chain,
        explorerUrl,
        estimatedTime,
      });
    }),
};
