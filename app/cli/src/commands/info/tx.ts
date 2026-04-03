import { Args, Command } from "@effect/cli"
import { Effect } from "effect"
import { HistoryStore } from "../../services/history-store.js"
import { Output } from "../../services/output.js"

const hashArg = Args.text({ name: "hash" }).pipe(
  Args.withDescription("Transaction hash (hex)"),
)

export const infoTx = Command.make("tx", { hash: hashArg }, (args) =>
  Effect.gen(function* () {
    const history = yield* HistoryStore
    const output = yield* Output

    const entry = yield* history.getByHash(args.hash)

    yield* output.humanLine(`Transaction: ${entry.hash}`)
    yield* output.humanLine(`  Type:      ${entry.type}`)
    yield* output.humanLine(`  From:      ${entry.from}`)
    yield* output.humanLine(`  To:        ${entry.to}`)
    yield* output.humanLine(`  Amount:    ${entry.formatted} ${entry.tokenName}`)
    yield* output.humanLine(`  Status:    ${entry.status}`)
    yield* output.humanLine(`  Timestamp: ${entry.timestamp}`)
    if (entry.explorerUrl) {
      yield* output.humanLine(`  Explorer:  ${entry.explorerUrl}`)
    }
    yield* output.success(entry)
  }),
).pipe(Command.withDescription("Look up a transaction by hash"))
