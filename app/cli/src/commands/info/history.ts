import { Command, Options } from "@effect/cli"
import { Effect, Option } from "effect"
import { HistoryStore } from "../../services/history-store.js"
import { Output } from "../../services/output.js"

const fromOption = Options.text("from").pipe(
  Options.optional,
  Options.withDescription("Filter by sender account name or address"),
)

const toOption = Options.text("to").pipe(
  Options.optional,
  Options.withDescription("Filter by recipient address"),
)

const tokenOption = Options.text("token").pipe(
  Options.optional,
  Options.withDescription("Filter by token"),
)

const limitOption = Options.integer("limit").pipe(
  Options.withDefault(20),
  Options.withDescription("Max number of records to return"),
)

const offsetOption = Options.integer("offset").pipe(
  Options.withDefault(0),
  Options.withDescription("Number of records to skip"),
)

export const infoHistory = Command.make(
  "history",
  { from: fromOption, to: toOption, token: tokenOption, limit: limitOption, offset: offsetOption },
  (args) =>
    Effect.gen(function* () {
      const history = yield* HistoryStore
      const output = yield* Output

      const entries = yield* history.list({
        from: Option.getOrUndefined(args.from),
        to: Option.getOrUndefined(args.to),
        token: Option.getOrUndefined(args.token),
        limit: args.limit,
        offset: args.offset,
      })

      yield* output.humanTable(
        ["HASH", "TYPE", "FROM", "TO", "AMOUNT", "TOKEN", "STATUS", "TIME"],
        entries.map((e) => [
          e.hash.slice(0, 10) + "...",
          e.type,
          e.from.slice(0, 10) + "...",
          e.to.slice(0, 10) + "...",
          e.formatted,
          e.tokenName,
          e.status,
          e.timestamp,
        ]),
      )
      yield* output.success({ transactions: entries })
    }),
).pipe(Command.withDescription("Show transaction history"))
