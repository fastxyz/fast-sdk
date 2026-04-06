import { Effect } from "effect";
import type { AccountSetDefaultArgs } from "../../cli.js";
import { Output } from "../../services/output.js";
import { AccountStore } from "../../services/storage/account.js";

export const accountSetDefaultHandler = (args: AccountSetDefaultArgs) =>
  Effect.gen(function* () {
    const accounts = yield* AccountStore;
    const output = yield* Output;

    yield* accounts.setDefault(args.name);
    const info = yield* accounts.get(args.name);

    yield* output.humanLine(`Default account set to "${args.name}"`);
    yield* output.success({
      name: info.name,
      fastAddress: info.fastAddress,
    });
  });
