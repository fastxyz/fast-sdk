import { toHex } from "@fastxyz/sdk";
import { Effect } from "effect";
import type { FundCryptoArgs } from "../../cli.js";
import {
  FundingRequiredError,
  InvalidAmountError,
  InvalidNetworkConfigError,
  TransactionFailedError,
  UnsupportedChainError,
} from "../../errors/index.js";
import { makeHistoryEntry } from "../../schemas/history.js";
import { AllSet } from "../../services/api/allset.js";
import { ClientConfig } from "../../services/config/client.js";
import { Output } from "../../services/output.js";
import { Prompt } from "../../services/prompt.js";
import { AccountStore } from "../../services/storage/account.js";
import { HistoryStore } from "../../services/storage/history.js";
import { NetworkConfigService } from "../../services/storage/network.js";
import { resolveToken } from "../../services/token-resolver.js";
import type { Command } from "../index.js";

export const fundCrypto: Command<FundCryptoArgs> = {
  cmd: "fund-crypto",
  handler: (args: FundCryptoArgs) =>
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
      if (Number.isNaN(amountFloat) || amountFloat <= 0) {
        return yield* Effect.fail(
          new InvalidAmountError({ message: "Amount must be a positive number" }),
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

      // Resolve token
      const tokenName =
        args.token ?? Object.keys(chainCfg.tokens)[0] ?? "USDC";
      const tokenInfo = yield* Effect.try({
        try: () => resolveToken(tokenName, network, args.chain),
        catch: (e) =>
          e instanceof Error
            ? (e as unknown as TransactionFailedError)
            : new TransactionFailedError({ message: String(e), cause: e }),
      });
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

      // Check ERC-20 balance on the specified chain
      const balance = yield* bridge.erc20Balance(
        chainCfg.evmRpcUrl,
        tokenInfo.evmAddress!,
        accountInfo.evmAddress,
      );

      if (balance < amountRaw) {
        const shortfall = amountRaw - balance;

        yield* output.humanLine(
          `Insufficient ${tokenName} balance on ${args.chain}.`,
        );
        yield* output.humanLine("");
        yield* output.humanLine(`  EVM address:  ${accountInfo.evmAddress}`);
        yield* output.humanLine(`  Chain:        ${args.chain}`);
        yield* output.humanLine(`  Current:      ${fmt(balance)} ${tokenName}`);
        yield* output.humanLine(`  Required:     ${args.amount} ${tokenName}`);
        yield* output.humanLine(`  Shortfall:    ${fmt(shortfall)} ${tokenName}`);
        yield* output.humanLine("");
        yield* output.humanLine(
          `Send at least ${fmt(shortfall)} ${tokenName} to the EVM address above on ${args.chain}.`,
        );
        yield* output.humanLine(
          `Note: You will also need ETH for gas fees on ${args.chain}.`,
        );

        return yield* Effect.fail(
          new FundingRequiredError({
            message: `Insufficient balance: need ${fmt(shortfall)} more ${tokenName} on ${args.chain}.`,
          }),
        );
      }

      // Check native ETH balance for gas
      const ethBalance = yield* bridge.nativeBalance(
        chainCfg.evmRpcUrl,
        accountInfo.evmAddress,
      );
      if (ethBalance === 0n) {
        yield* output.humanLine(`Insufficient ETH for gas on ${args.chain}.`);
        yield* output.humanLine("");
        yield* output.humanLine(`  EVM address:  ${accountInfo.evmAddress}`);
        yield* output.humanLine(`  Chain:        ${args.chain}`);
        yield* output.humanLine(`  ETH balance:  0`);
        yield* output.humanLine("");
        yield* output.humanLine(
          `Send ETH to the EVM address above on ${args.chain} to cover gas fees.`,
        );

        return yield* Effect.fail(
          new FundingRequiredError({
            message: `No ETH for gas on ${args.chain}. Send ETH to ${accountInfo.evmAddress}.`,
          }),
        );
      }

      // Balance sufficient — bridge to Fast without any interactive prompts
      const pwd = accountInfo.encrypted ? yield* prompt.password() : null;
      const { seed } = yield* accounts.export(accountInfo.name, pwd);

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
        senderAddress: evmAccount.address,
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
