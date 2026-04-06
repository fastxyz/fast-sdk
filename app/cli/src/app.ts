import { Effect, Layer, type Option } from "effect";
import { InternalError, type ClientError, toExitCode } from "./errors/index.js";
import { FastRpcLive } from "./services/api/fast.js";
import { makeConfigLayer } from "./services/config/config.js";
import { Output, OutputLive } from "./services/output.js";
import { PromptLive } from "./services/prompt.js";
import { AccountStoreLive } from "./services/storage/account.js";
import { DatabaseLive } from "./services/storage/database.js";
import { HistoryStoreLive } from "./services/storage/history.js";
import { NetworkConfigLive } from "./services/storage/network.js";

/** Parsed global CLI options passed from main.ts into command handlers. */
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

  // Foundation: database + config
  const foundation = Layer.mergeAll(DatabaseLive, cliConfigLayer);

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
 * - Catches ClientErrors, prints via Output, and exits with the mapped code
 * - Catches defects (unexpected throws) and writes a fallback message to stderr
 */
export const runHandler = <A, R>(
  opts: GlobalOptions,
  program: Effect.Effect<A, ClientError, R>,
): Promise<void> => {
  const layer = makeAppLayer(opts);

  const handled = program.pipe(
    Effect.catchAll((err: ClientError) =>
      Effect.gen(function* () {
        const output = yield* Output;
        yield* output.fail(err);
        process.exit(toExitCode(err));
      }),
    ),
    Effect.catchAllDefect((defect) =>
      Effect.gen(function* () {
        const output = yield* Output;
        yield* output.fail(
          new InternalError({
            message: defect instanceof Error ? defect.message : String(defect),
            cause: defect,
          }),
        );
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
