import { Cause, Effect, Exit, Option } from "effect";

/** Run an Effect, throwing typed errors directly (not wrapped in FiberFailure). */
export const run = <A>(effect: Effect.Effect<A, unknown>): Promise<A> =>
  Effect.runPromiseExit(effect).then((exit) => {
    if (Exit.isSuccess(exit)) return exit.value;
    const failure = Cause.failureOption(exit.cause);
    if (Option.isSome(failure)) throw failure.value;
    throw Cause.squashWith(exit.cause, (e) => e);
  });
