import { Command } from '@effect/cli';
import { NodeContext, NodeRuntime } from '@effect/platform-node';
import { Effect, Option } from 'effect';

import { rootCommand } from './cli.js';
import { type CliError, toErrorCode, toExitCode } from './errors/index.js';
import { Output } from './services/output.js';

const app = Command.run(rootCommand, {
  name: 'fast',
  version: '0.1.0',
});

const main = app(process.argv).pipe(
  Effect.catchAll((error: unknown) => {
    const err = error as CliError;
    const exitCode = toExitCode(err);
    const message = typeof err?.message === 'string' ? err.message : String(error);

    return Effect.gen(function* () {
      // Try Output service first (available inside command context)
      const outputOpt = yield* Effect.serviceOption(Output);
      if (Option.isSome(outputOpt)) {
        yield* outputOpt.value.error(err);
      } else if (process.argv.includes('--json')) {
        // Fallback for errors before command context is established
        process.stdout.write(`${JSON.stringify({ ok: false, error: { code: toErrorCode(err), message } }, null, 2)}\n`);
      } else {
        process.stderr.write(`Error: ${message}\n`);
      }
      process.exit(exitCode);
    });
  }),
  Effect.provide(NodeContext.layer),
);

NodeRuntime.runMain(main as Effect.Effect<void>);
