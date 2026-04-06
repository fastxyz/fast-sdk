import { Effect } from "effect";
import type { InfoTxArgs } from "../../cli.js";
import { Output } from "../../services/output.js";
import { HistoryStore } from "../../services/storage/history.js";

export const infoTxHandler = (args: InfoTxArgs) =>
  Effect.gen(function* () {
    const history = yield* HistoryStore;
    const output = yield* Output;

    const entry = yield* history.getByHash(args.hash);

    yield* output.humanLine(`Transaction: ${entry.hash}`);
    yield* output.humanLine(`  Type:      ${entry.type}`);
    yield* output.humanLine(`  From:      ${entry.from}`);
    yield* output.humanLine(`  To:        ${entry.to}`);
    yield* output.humanLine(
      `  Amount:    ${entry.formatted} ${entry.tokenName}`,
    );
    yield* output.humanLine(`  Status:    ${entry.status}`);
    yield* output.humanLine(`  Timestamp: ${entry.timestamp}`);
    if (entry.explorerUrl) {
      yield* output.humanLine(`  Explorer:  ${entry.explorerUrl}`);
    }
    yield* output.ok(entry);
  });
