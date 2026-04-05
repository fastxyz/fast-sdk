import { Effect, Option } from 'effect';
import { type CliError, toErrorCode, toExitCode } from './errors/index.js';
import { makeAppLayer } from './layers.js';
import { Output } from './services/output.js';
import type { GlobalArgsParsed } from './cli-globals.js';

/**
 * Adapter that bridges citty handlers to Effect programs.
 *
 * - Builds the app layer from parsed global args
 * - Provides it to the program
 * - Catches CliErrors, prints via Output, and exits with the mapped code
 * - Unhandled throws propagate to citty's runMain (which prints usage)
 */
// biome-ignore lint/suspicious/noExplicitAny: layer-provided requirements are checked by Effect.provide
export const runHandler = <A, R>(
  args: GlobalArgsParsed,
  program: Effect.Effect<A, CliError, R>,
): Promise<void> => {
  const layer = makeAppLayer({
    json: args.json,
    debug: args.debug,
    nonInteractive: args['non-interactive'] || args.json,
    network: args.network,
    account: args.account ? Option.some(args.account) : Option.none(),
    password: args.password ? Option.some(args.password) : Option.none(),
  });

  const handled = program.pipe(
    Effect.catchAll((err: CliError) =>
      Effect.gen(function* () {
        const output = yield* Output;
        yield* output.error(err);
        // biome-ignore lint/suspicious/useIsNan: process.exit never returns
        process.exit(toExitCode(err));
      }),
    ),
    Effect.catchAllDefect((defect) =>
      Effect.sync(() => {
        // Fallback for non-CliError throws (bugs, assertion failures, etc.)
        const message = defect instanceof Error ? defect.message : String(defect);
        if (args.json) {
          process.stdout.write(`${JSON.stringify({ ok: false, error: { code: 'UNKNOWN_ERROR', message } }, null, 2)}\n`);
        } else {
          process.stderr.write(`Error: ${message}\n`);
        }
        process.exit(1);
      }),
    ),
    Effect.provide(layer),
    Effect.asVoid,
  );

  // The layer provides every service the program could need. Cast R → never
  // because Effect.provide's type-level requirement subtraction is too loose
  // for citty's generic handler signature.
  return Effect.runPromise(handled as Effect.Effect<void, never, never>);
};

// Re-export for use inside handlers that need to inspect the raw error code
export { toErrorCode };
