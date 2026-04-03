import { Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";
import { AccountStore } from "../../services/account-store.js";
import { Output } from "../../services/output.js";
import { PasswordService } from "../../services/password-service.js";

const nameOption = Options.text("name").pipe(
  Options.optional,
  Options.withDescription("Human-readable alias for the account"),
);

export const accountCreate = Command.make(
  "create",
  { name: nameOption },
  (args) =>
    Effect.gen(function* () {
      const accounts = yield* AccountStore;
      const password = yield* PasswordService;
      const output = yield* Output;

      const name = Option.isSome(args.name)
        ? args.name.value
        : yield* accounts.nextAutoName();

      const pwd = yield* password.resolve();
      const seed = crypto.getRandomValues(new Uint8Array(32));
      const entry = yield* accounts.create(name, seed, pwd);

      yield* output.humanLine(`Created account "${entry.name}"`);
      yield* output.humanLine(`  Fast address: ${entry.fastAddress}`);
      yield* output.humanLine(`  EVM address:  ${entry.evmAddress}`);
      yield* output.success({
        name: entry.name,
        fastAddress: entry.fastAddress,
        evmAddress: entry.evmAddress,
      });
    }),
).pipe(Command.withDescription("Create a new account"));
