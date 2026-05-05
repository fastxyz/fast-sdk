import { fromHex, toHex } from "@fastxyz/sdk";
import { Effect } from "effect";
import type { TokenBurnArgs } from "../../cli.js";
import {
  InvalidAmountError,
  TokenNotFoundError,
} from "../../errors/index.js";
import { FastRpc } from "../../services/api/fast.js";
import { ClientConfig } from "../../services/config/client.js";
import { Output } from "../../services/output.js";
import { Prompt } from "../../services/prompt.js";
import { resolveSigner } from "../../services/signer-resolver.js";
import { AccountStore } from "../../services/storage/account.js";
import { NetworkConfigService } from "../../services/storage/network.js";
import { resolveToken } from "../../services/token-resolver.js";
import { submitOperation } from "../../services/tx-pipeline.js";
import type { Command } from "../index.js";

const HEX_TOKEN_ID = /^(0x)?[0-9a-fA-F]{64}$/;

const parseAmount = (s: string, decimals: number): bigint => {
  const trimmed = s.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new InvalidAmountError({
      message: `--amount not a non-negative decimal: "${s}"`,
    });
  }
  const [whole, frac = ""] = trimmed.split(".");
  if (frac.length > decimals) {
    throw new InvalidAmountError({
      message: `--amount has more fractional digits (${frac.length}) than the token allows (${decimals})`,
    });
  }
  const scaled = `${whole}${frac.padEnd(decimals, "0")}`;
  return BigInt(scaled);
};

export const tokenBurn: Command<TokenBurnArgs> = {
  cmd: "token-burn",
  handler: (args) =>
    Effect.gen(function* () {
      const accounts = yield* AccountStore;
      const networks = yield* NetworkConfigService;
      const config = yield* ClientConfig;
      const output = yield* Output;
      const prompt = yield* Prompt;
      const rpc = yield* FastRpc;

      const network = yield* networks.resolve(config.network);

      let tokenId: Uint8Array;
      let decimals: number;
      if (HEX_TOKEN_ID.test(args.token)) {
        tokenId = fromHex(args.token);
        const info = (yield* rpc.getTokenInfo({
          tokenIds: [tokenId],
        } as never)) as unknown as {
          requestedTokenMetadata: ReadonlyArray<
            readonly [Uint8Array, { decimals: number } | null]
          >;
        };
        const found = info.requestedTokenMetadata?.[0];
        if (!found || !found[1]) {
          return yield* Effect.fail(
            new TokenNotFoundError({ token: args.token }),
          );
        }
        decimals = found[1].decimals;
      } else {
        const resolved = yield* Effect.try({
          try: () => resolveToken(args.token, network, undefined),
          catch: (e) => e as TokenNotFoundError,
        });
        tokenId = resolved.fastTokenId;
        decimals = resolved.decimals;
      }

      const amount = yield* Effect.try({
        try: () => parseAmount(args.amount, decimals),
        catch: (e) => e as InvalidAmountError,
      });

      const accountInfo = yield* accounts.resolveAccount(config.account);
      const password =
        accountInfo.kind === "single" && !accountInfo.encrypted
          ? null
          : yield* prompt.password();
      const resolved = yield* resolveSigner({
        account: accountInfo,
        asMember: args.asMember,
        password,
      });

      if (!config.nonInteractive && !config.json) {
        yield* output.humanLine(
          `Burn ${args.amount} of token ${toHex(tokenId)}`,
        );
        yield* output.humanLine(`  From: ${accountInfo.fastAddress}`);
        const ok = yield* prompt.confirm("Confirm?");
        if (!ok) return;
      }

      const result = yield* submitOperation({
        resolved,
        networkId: network.networkId as never,
        operation: {
          type: "Burn",
          value: {
            tokenId,
            amount,
          } as never,
        },
      });

      if (result.status === "incomplete-multisig") {
        const quorum =
          resolved.kind === "multisig"
            ? resolved.account.multisigConfig.quorum
            : 1;
        yield* output.humanLine(
          `Submitted as multisig partial: 1/${quorum} signatures collected.`,
        );
        yield* output.ok({
          status: "incomplete-multisig",
          tokenId: toHex(tokenId),
          amount: args.amount,
          wallet: accountInfo.name,
        });
        return;
      }

      yield* output.humanLine(`Burned ${args.amount}.`);
      yield* output.humanLine(`  Transaction: ${result.txHash}`);
      yield* output.ok({
        status: "success",
        tokenId: toHex(tokenId),
        amount: args.amount,
        txHash: result.txHash,
      });
    }),
};
