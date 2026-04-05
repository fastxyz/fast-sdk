import { defineCommand } from 'citty';
import { Effect } from 'effect';
import { globalArgs } from '../../cli-globals.js';
import { runHandler } from '../../cli-runner.js';
import { HistoryStore } from '../../services/history-store.js';
import { Output } from '../../services/output.js';

export const infoTx = defineCommand({
  meta: { name: 'tx', description: 'Look up a transaction by hash' },
  args: {
    ...globalArgs,
    hash: {
      type: 'positional',
      description: 'Transaction hash (hex)',
      required: true,
    },
  },
  run: ({ args }) => runHandler(args, Effect.gen(function* () {
    const history = yield* HistoryStore;
    const output = yield* Output;

    const entry = yield* history.getByHash(args.hash);

    yield* output.humanLine(`Transaction: ${entry.hash}`);
    yield* output.humanLine(`  Type:      ${entry.type}`);
    yield* output.humanLine(`  From:      ${entry.from}`);
    yield* output.humanLine(`  To:        ${entry.to}`);
    yield* output.humanLine(`  Amount:    ${entry.formatted} ${entry.tokenName}`);
    yield* output.humanLine(`  Status:    ${entry.status}`);
    yield* output.humanLine(`  Timestamp: ${entry.timestamp}`);
    if (entry.explorerUrl) {
      yield* output.humanLine(`  Explorer:  ${entry.explorerUrl}`);
    }
    yield* output.success(entry);
  })),
});
