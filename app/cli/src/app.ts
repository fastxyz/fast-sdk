import { Effect, Layer, type Option } from "effect";
import { FastRpcLive } from "./services/api/fast.js";
import { makeConfigLayer } from "./services/config/config.js";
import { type CliError, toErrorCode, toExitCode } from "./errors/index.js";
import { EnvLive } from "./services/env.js";
import { OutputLive, Output } from "./services/output.js";
import { PromptLive } from "./services/prompt.js";
import { AccountStoreLive } from "./services/storage/account.js";
import { DatabaseLive } from "./services/storage/database.js";
import { HistoryStoreLive } from "./services/storage/history.js";
import { NetworkConfigLive } from "./services/storage/network.js";

/**
 * Parsed global CLI options. Merges the former `ParsedOptions` (layers.ts)
 * and `GlobalArgsParsed` (cli-runner.ts) into a single canonical type.
 */
export interface GlobalOptions {
  readonly json: boolean;
  readonly debug: boolean;
  readonly nonInteractive: boolean;
  readonly network: string;
  readonly account: Option.Option<string>;
  readonly password: Option.Option<string>;
}

export const makeAppLayer = (opts: GlobalOptions) => {
  const cliConfigLayer = makeConfigLayer({
    json: opts.json,
    debug: opts.debug,
    nonInteractive: opts.nonInteractive || opts.json,
    network: opts.network,
    account: opts.account,
    password: opts.password,
  });

  // Foundation: database + config + env
  const foundation = Layer.mergeAll(DatabaseLive, cliConfigLayer, EnvLive);

  // Services that depend only on foundation
  const tier1 = Layer.mergeAll(
    OutputLive,
    PromptLive,
    NetworkConfigLive,
    HistoryStoreLive,
    AccountStoreLive,
  ).pipe(Layer.provide(foundation));

  // Services that depend on tier1
  const tier2 = Layer.mergeAll(FastRpcLive).pipe(
    Layer.provide(Layer.merge(foundation, tier1)),
  );

  return Layer.mergeAll(foundation, tier1, tier2);
};

/**
 * Bridges command handlers to Effect programs.
 *
 * - Builds the app layer from parsed global options
 * - Provides it to the program
 * - Catches CliErrors, prints via Output, and exits with the mapped code
 * - Catches defects (unexpected throws) and writes a fallback message to stderr
 */
export const runHandler = <A, R>(
  opts: GlobalOptions,
  program: Effect.Effect<A, CliError, R>,
): Promise<void> => {
  const layer = makeAppLayer(opts);

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
        const message =
          defect instanceof Error ? defect.message : String(defect);
        if (opts.json) {
          process.stdout.write(
            `${JSON.stringify({ ok: false, error: { code: "UNKNOWN_ERROR", message } }, null, 2)}\n`,
          );
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
  // for generic handler signatures.
  return Effect.runPromise(handled as Effect.Effect<void, never, never>);
};

// Re-export for use inside handlers that need to inspect the raw error code
export { toErrorCode };
