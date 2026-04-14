import { readFileSync } from "node:fs";
import { Signer, toHex } from "@fastxyz/sdk";
import type { EvmChainConfig, EvmWallet, FastWallet } from "@fastxyz/x402-client";
import { Effect } from "effect";
import type { PayArgs } from "../cli.js";
import { InternalError, InvalidPaymentLinkError, InvalidUsageError } from "../errors/index.js";
import { validateHeader, validateHttpMethod, validateUrl } from "../services/validate.js";
import { makeHistoryEntry } from "../schemas/history.js";
import { X402Service } from "../services/api/x402.js";
import { ClientConfig } from "../services/config/client.js";
import { Output } from "../services/output.js";
import { Prompt } from "../services/prompt.js";
import { AccountStore } from "../services/storage/account.js";
import { HistoryStore } from "../services/storage/history.js";
import { NetworkConfigService } from "../services/storage/network.js";
import type { Command } from "./index.js";

const parseHeaders = (raw: readonly string[]): Record<string, string> => {
  const headers: Record<string, string> = {};
  for (const h of raw) {
    const idx = h.indexOf(":");
    if (idx > 0) {
      headers[h.slice(0, idx).trim()] = h.slice(idx + 1).trim();
    }
  }
  return headers;
};

const resolveBody = (body: string | undefined) => {
  if (!body) return Effect.succeed(undefined);
  if (!body.startsWith("@")) return Effect.succeed(body);
  const path = body.slice(1);
  return Effect.try({
    try: () => readFileSync(path, "utf-8"),
    catch: (cause) =>
      new InternalError({
        message: `Failed to read body file "${path}"`,
        cause,
      }),
  });
};

export const pay: Command<PayArgs> = {
  cmd: "pay",
  handler: (args) =>
    Effect.gen(function* () {
      const x402 = yield* X402Service;
      const output = yield* Output;
      const config = yield* ClientConfig;
      const accounts = yield* AccountStore;
      const networkConfig = yield* NetworkConfigService;
      const historyStore = yield* HistoryStore;
      const prompt = yield* Prompt;

      const headers = parseHeaders(args.header);
      const body = yield* resolveBody(args.body);

      // Validate inputs
      const urlErr = validateUrl(args.url);
      if (urlErr) {
        return yield* Effect.fail(new InvalidUsageError({ message: urlErr }));
      }

      const methodErr = validateHttpMethod(args.method);
      if (methodErr) {
        return yield* Effect.fail(new InvalidUsageError({ message: methodErr }));
      }

      for (const h of args.header) {
        const headerErr = validateHeader(h);
        if (headerErr) {
          return yield* Effect.fail(new InvalidUsageError({ message: headerErr }));
        }
      }

      // -- Dry-run mode --
      if (args.dryRun) {
        const result = yield* x402.dryRun(args.url, args.method, headers);
        if (!result.paymentRequired) {
          yield* output.humanLine(`Server returned ${result.status} (no payment required)`);
          yield* output.ok({
            statusCode: result.status,
            paymentRequired: null,
            acceptedOptions: [],
          });
          return;
        }
        const accepts = result.paymentRequired.accepts ?? [];
        yield* output.humanLine("Payment required:");
        for (const opt of accepts) {
          yield* output.humanLine(`  Network: ${opt.network}`);
          yield* output.humanLine(`  Amount:  ${opt.maxAmountRequired}`);
          yield* output.humanLine(`  Pay to:  ${opt.payTo}`);
          yield* output.humanLine(`  Asset:   ${opt.asset ?? "USDC"}`);
          yield* output.humanLine("");
        }
        yield* output.ok({
          statusCode: 402,
          paymentRequired: result.paymentRequired,
          acceptedOptions: accepts,
        });
        return;
      }

      // -- Normal mode: resolve account + wallets --
      const network = yield* networkConfig.resolve(config.network);
      const accountInfo = yield* accounts.resolveAccount(config.account);
      const pwd = accountInfo.encrypted
        ? yield* prompt.password()
        : null;
      const { seed } = yield* accounts.export(accountInfo.name, pwd);

      const signer = new Signer(seed);
      const publicKeyBytes = yield* Effect.tryPromise({
        try: () => signer.getPublicKey(),
        catch: () =>
          new InvalidPaymentLinkError({ message: "Failed to derive public key" }),
      });
      const publicKey = toHex(publicKeyBytes);
      const fastAddress = yield* Effect.tryPromise({
        try: () => signer.getFastAddress(),
        catch: () =>
          new InvalidPaymentLinkError({ message: "Failed to derive Fast address" }),
      });

      const fastWallet: FastWallet = {
        type: "fast",
        privateKey: toHex(seed),
        publicKey,
        address: fastAddress,
        rpcUrl: network.url,
      };

      const evmWallet: EvmWallet = {
        type: "evm",
        privateKey: toHex(seed) as `0x${string}`,
        address: accountInfo.evmAddress as `0x${string}`,
      };

      // Build EVM network configs from allset chains
      const evmNetworks: Record<string, EvmChainConfig> = {};
      const allset = network.allSet;
      if (allset) {
        for (const [name, chain] of Object.entries(allset.chains)) {
          const usdcToken = chain.tokens.USDC ?? chain.tokens.testUSDC;
          if (usdcToken?.evmAddress) {
            evmNetworks[name] = {
              chainId: chain.chainId,
              rpcUrl: chain.evmRpcUrl,
              usdcAddress: usdcToken.evmAddress as `0x${string}`,
            };
          }
        }
      }

      const result = yield* x402.pay({
        url: args.url,
        method: args.method,
        headers,
        body,
        wallet: [fastWallet, evmWallet],
        evmNetworks,
      });

      if (!result.success) {
        return yield* Effect.fail(
          new InvalidPaymentLinkError({ message: result.note ?? "Payment failed" }),
        );
      }

      // Record in history if payment was made
      if (result.payment) {
        const p = result.payment;
        yield* historyStore.record(
          makeHistoryEntry({
            hash: p.txHash,
            type: "transfer",
            from: accountInfo.fastAddress,
            to: p.recipient,
            amount: p.amount,
            formatted: p.amount,
            tokenName: "USDC",
            tokenId: "",
            network: p.network,
            status: "confirmed",
            timestamp: new Date().toISOString(),
            explorerUrl: "",
            route: p.network.includes("fast") ? "fast" : "fast-to-evm",
          }),
        );
      }

      // Output
      if (result.payment) {
        const p = result.payment;
        yield* output.humanLine(`Payment successful (${p.network})`);
        yield* output.humanLine(`  Amount:    ${p.amount}`);
        yield* output.humanLine(`  Recipient: ${p.recipient}`);
        yield* output.humanLine(`  Tx hash:   ${p.txHash}`);
        yield* output.humanLine("");
      }

      yield* output.ok({
        txHash: result.payment?.txHash ?? null,
        amount: result.payment?.amount ?? null,
        recipient: result.payment?.recipient ?? null,
        network: result.payment?.network ?? null,
        response: result.body,
        statusCode: result.statusCode,
      });
    }),
};
