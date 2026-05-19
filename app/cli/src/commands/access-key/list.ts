import { Effect } from "effect";
import type { AccessKeyListArgs } from "../../cli.js";
import { Output } from "../../services/output.js";
import { AccessKeyStore } from "../../services/storage/access-key.js";
import { AccountStore } from "../../services/storage/account.js";
import { ClientConfig } from "../../services/config/client.js";
import { KeyManagerApi } from "../../services/api/key-manager.js";
import { NetworkConfigService } from "../../services/storage/network.js";
import {
  formatBaseUnits,
  statusForAccessKey,
} from "../../services/access-key-runtime.js";
import type { Command } from "../index.js";

function resolveTokenName(
  tokenId: string | undefined,
  network: {
    readonly allSet?: {
      readonly chains: Record<
        string,
        {
          readonly tokens: Record<string, { readonly fastTokenId: string }>;
        }
      >;
    };
  },
): string {
  if (!tokenId || !network.allSet) {
    return tokenId ?? "-";
  }
  for (const chain of Object.values(network.allSet.chains)) {
    for (const [name, token] of Object.entries(chain.tokens)) {
      if (token.fastTokenId.toLowerCase() === tokenId.toLowerCase()) {
        return name;
      }
    }
  }
  return tokenId;
}

export const accessKeyList: Command<AccessKeyListArgs> = {
  cmd: "access-key-list",
  handler: (_args: AccessKeyListArgs) =>
    Effect.gen(function* () {
      const accounts = yield* AccountStore;
      const accessKeyStore = yield* AccessKeyStore;
      const config = yield* ClientConfig;
      const keyManager = yield* KeyManagerApi;
      const networkService = yield* NetworkConfigService;
      const output = yield* Output;

      const ownerAccount = yield* accounts.resolveAccount(config.account);
      const network = yield* networkService.resolve(config.network);
      const [remoteKeys, localKeys] = yield* Effect.all([
        keyManager.listAccessKeys(ownerAccount.fastAddress),
        accessKeyStore.list(ownerAccount.fastAddress, config.network),
      ]);

      const rowsById = new Map<string, {
        accessKeyId: string;
        label: string;
        source: string;
        clientId: string;
        token: string;
        remaining: string | null;
        status: string;
        local: boolean;
        createdAt: string | null;
      }>();

      for (const key of remoteKeys) {
        const tokenId = key.policy.allowedTokens[0];
        const tokenName = resolveTokenName(tokenId, network);
        const decimals = tokenName.toUpperCase().includes("USDC") ? 6 : 0;
        rowsById.set(key.accessKeyId, {
          accessKeyId: key.accessKeyId,
          label: key.label ?? key.accessKeyId,
          source: key.source ?? "external",
          clientId: key.policy.clientId,
          token: tokenName,
          remaining: formatBaseUnits(key.capabilities.remainingTotalSpend, decimals),
          status: statusForAccessKey(key),
          local: false,
          createdAt: key.createdAt ? String(key.createdAt) : null,
        });
      }

      for (const key of localKeys) {
        const existing = rowsById.get(key.accessKeyId);
        if (existing) {
          rowsById.set(key.accessKeyId, {
            ...existing,
            label: existing.label === key.accessKeyId && key.label ? key.label : existing.label,
            clientId: existing.clientId || key.clientId,
            createdAt: existing.createdAt ?? key.createdAt,
            local: true,
          });
          continue;
        }

        rowsById.set(key.accessKeyId, {
          accessKeyId: key.accessKeyId,
          label: key.label ?? key.accessKeyId,
          source: "local-only",
          clientId: key.clientId,
          token: "-",
          remaining: null,
          status: "unregistered",
          local: true,
          createdAt: key.createdAt ?? null,
        });
      }

      const rows = [...rowsById.values()].sort((left, right) =>
        (right.createdAt ?? "").localeCompare(left.createdAt ?? ""),
      );

      if (rows.length === 0) {
        yield* output.humanLine(`No access keys found for ${ownerAccount.fastAddress}`);
      } else {
        yield* output.humanTable(
          ["LABEL", "STATUS", "SOURCE", "CLIENT", "TOKEN", "LOCAL"],
          rows.map((row) => [
            row.label,
            row.status,
            row.source,
            row.clientId,
            row.token,
            row.local ? "yes" : "no",
          ]),
        );
      }

      yield* output.ok({
        ownerAccount: ownerAccount.fastAddress,
        accessKeys: rows,
      });
    }),
};
