import { Effect } from "effect";
import type { AccountListArgs } from "../../cli.js";
import { Output } from "../../services/output.js";
import { AccountStore } from "../../services/storage/account.js";

export const accountListHandler = (_args: AccountListArgs) =>
  Effect.gen(function* () {
    const accounts = yield* AccountStore;
    const output = yield* Output;

    const entries = yield* accounts.list();

    yield* output.humanTable(
      ["NAME", "FAST ADDRESS", "EVM ADDRESS", "DEFAULT"],
      entries.map((e) => [
        e.name,
        e.fastAddress,
        e.evmAddress,
        e.isDefault ? "✓" : "",
      ]),
    );
    yield* output.success({
      accounts: entries.map((e) => ({
        name: e.name,
        fastAddress: e.fastAddress,
        evmAddress: e.evmAddress,
        isDefault: e.isDefault,
      })),
    });
  });
