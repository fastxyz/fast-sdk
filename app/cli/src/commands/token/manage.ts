import { fromFastAddress, fromHex, toHex } from "@fastxyz/sdk";
import { Effect } from "effect";
import type { TokenManageArgs } from "../../cli.js";
import {
  InvalidAddressError,
  InvalidUsageError,
  TokenNotFoundError,
} from "../../errors/index.js";
import { makeHistoryEntry } from "../../schemas/history.js";
import { FastRpc } from "../../services/api/fast.js";
import { ClientConfig } from "../../services/config/client.js";
import { Output } from "../../services/output.js";
import { Prompt } from "../../services/prompt.js";
import { resolveSigner } from "../../services/signer-resolver.js";
import { AccountStore } from "../../services/storage/account.js";
import { HistoryStore } from "../../services/storage/history.js";
import { NetworkConfigService } from "../../services/storage/network.js";
import { resolveToken } from "../../services/token-resolver.js";
import { submitOperation } from "../../services/tx-pipeline.js";
import type { Command } from "../index.js";

const HEX_TOKEN_ID = /^(0x)?[0-9a-fA-F]{64}$/;

const splitAddrs = (csv: string | undefined): string[] =>
  (csv ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

const encodeMemo = (s: string | undefined): Uint8Array | null => {
  if (!s) return null;
  const bytes = new TextEncoder().encode(s);
  if (bytes.length > 32) {
    throw new InvalidUsageError({
      message: `--memo too long: ${bytes.length} bytes (max 32)`,
    });
  }
  const padded = new Uint8Array(32);
  padded.set(bytes, 0);
  return padded;
};

const parseAddr = (addr: string, label: string): Uint8Array => {
  if (!addr.startsWith("fast1")) {
    throw new InvalidAddressError({
      message: `${label} "${addr}" is not a bech32 fast1... address`,
    });
  }
  return fromFastAddress(addr);
};

export const tokenManage: Command<TokenManageArgs> = {
  cmd: "token-manage",
  handler: (args) =>
    Effect.gen(function* () {
      if (
        args.admin === undefined &&
        args.addMinters === undefined &&
        args.removeMinters === undefined
      ) {
        return yield* Effect.fail(
          new InvalidUsageError({
            message:
              "At least one of --admin, --add-minters, --remove-minters must be provided",
          }),
        );
      }

      const accounts = yield* AccountStore;
      const networks = yield* NetworkConfigService;
      const config = yield* ClientConfig;
      const output = yield* Output;
      const prompt = yield* Prompt;
      const rpc = yield* FastRpc;
      const historyStore = yield* HistoryStore;

      const network = yield* networks.resolve(config.network);

      let tokenId: Uint8Array;
      if (HEX_TOKEN_ID.test(args.token)) {
        tokenId = fromHex(args.token);
      } else {
        const resolved = yield* Effect.try({
          try: () => resolveToken(args.token, network, undefined),
          catch: (e) => e as TokenNotFoundError,
        });
        tokenId = resolved.fastTokenId;
      }

      // Fetch current metadata for updateId
      const info = (yield* rpc.getTokenInfo({
        tokenIds: [tokenId],
      } as never)) as unknown as {
        requestedTokenMetadata: ReadonlyArray<
          readonly [Uint8Array, { updateId: bigint } | null]
        >;
      };
      const found = info.requestedTokenMetadata?.[0];
      if (!found || !found[1]) {
        return yield* Effect.fail(
          new TokenNotFoundError({ token: args.token }),
        );
      }
      // Validator expects the operation to carry the token's CURRENT updateId
      // (it increments after settlement). Submitting current + 1 is rejected.
      // See fastset-multisig-cli/src/main.rs (uses current_update_id verbatim)
      // and fastset validator_tests confirming sequential ops use 0, 1, 2,...
      const currentUpdateId = found[1].updateId;

      // Build mints array
      const mintsChange: Array<
        readonly [{ type: "Add" | "Remove" }, Uint8Array]
      > = [];
      for (const addr of splitAddrs(args.addMinters)) {
        const bytes = yield* Effect.try({
          try: () => parseAddr(addr, "--add-minters entry"),
          catch: (e) => e as InvalidAddressError,
        });
        mintsChange.push([{ type: "Add" }, bytes]);
      }
      for (const addr of splitAddrs(args.removeMinters)) {
        const bytes = yield* Effect.try({
          try: () => parseAddr(addr, "--remove-minters entry"),
          catch: (e) => e as InvalidAddressError,
        });
        mintsChange.push([{ type: "Remove" }, bytes]);
      }

      const newAdmin =
        args.admin === undefined
          ? null
          : yield* Effect.try({
              try: () => parseAddr(args.admin!, "--admin"),
              catch: (e) => e as InvalidAddressError,
            });

      const userData = yield* Effect.try({
        try: () => encodeMemo(args.memo),
        catch: (e) => e as InvalidUsageError,
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
        yield* output.humanLine(`Manage token ${toHex(tokenId)}`);
        yield* output.humanLine(`  Caller (admin): ${accountInfo.fastAddress}`);
        if (args.admin)
          yield* output.humanLine(`  New admin:      ${args.admin}`);
        if (args.addMinters)
          yield* output.humanLine(`  Add minters:    ${args.addMinters}`);
        if (args.removeMinters)
          yield* output.humanLine(`  Remove minters: ${args.removeMinters}`);
        const ok = yield* prompt.confirm("Confirm?");
        if (!ok) return;
      }

      const result = yield* submitOperation({
        resolved,
        networkId: network.networkId as never,
        operation: {
          type: "TokenManagement",
          value: {
            tokenId,
            updateId: currentUpdateId,
            newAdmin,
            mints: mintsChange,
            userData,
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
          updateId: currentUpdateId.toString(),
          wallet: accountInfo.name,
        });
        return;
      }

      // Record in local history (only on success — incomplete-multisig has no cert)
      const explorerUrl = `${network.explorerUrl}/txs/${result.txHash}`;
      yield* historyStore.record(
        makeHistoryEntry({
          hash: result.txHash,
          type: "token-manage",
          from: accountInfo.fastAddress,
          to: "",
          amount: "0",
          formatted: "0",
          tokenName: args.token,
          tokenId: toHex(tokenId),
          network: config.network,
          status: "confirmed",
          timestamp: new Date().toISOString(),
          explorerUrl,
        }),
      );

      yield* output.humanLine(`Token managed.`);
      yield* output.humanLine(`  Transaction: ${result.txHash}`);
      yield* output.ok({
        status: "success",
        tokenId: toHex(tokenId),
        updateId: currentUpdateId.toString(),
        newAdmin: args.admin ?? null,
        addMinters: splitAddrs(args.addMinters),
        removeMinters: splitAddrs(args.removeMinters),
        txHash: result.txHash,
      });
    }),
};
