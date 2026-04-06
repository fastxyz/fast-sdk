import Table from "cli-table3";
import { Context, Effect, Layer } from "effect";
import { type ClientError, toErrorCode } from "../errors/index.js";
import { Config } from "./config/config.js";

// ---------------------------------------------------------------------------
// Pure functions — no Effect, no service. Can be called from anywhere.
// ---------------------------------------------------------------------------

export const writeOk = (data: unknown, json: boolean): void => {
  if (json) {
    process.stdout.write(
      `${JSON.stringify({ ok: true, data }, null, 2)}\n`,
    );
  }
};

export const writeFail = (err: ClientError, json: boolean): void => {
  if (json) {
    process.stdout.write(
      `${JSON.stringify(
        { ok: false, error: { code: toErrorCode(err), message: err.message } },
        null,
        2,
      )}\n`,
    );
  } else {
    process.stderr.write(`Error: ${err.message}\n`);
  }
};

// ---------------------------------------------------------------------------
// Effect service — delegates to the pure functions above.
// ---------------------------------------------------------------------------

export interface OutputShape {
  readonly ok: (data: unknown) => Effect.Effect<void>;
  readonly fail: (err: ClientError) => Effect.Effect<void>;
  readonly humanLine: (text: string) => Effect.Effect<void>;
  readonly humanTable: (
    headers: string[],
    rows: string[][],
  ) => Effect.Effect<void>;
  readonly debug: (message: string) => Effect.Effect<void>;
}

export class Output extends Context.Tag("Output")<Output, OutputShape>() {}

export const OutputLive = Layer.effect(
  Output,
  Effect.gen(function* () {
    const config = yield* Config;

    return {
      ok: (data) => Effect.sync(() => writeOk(data, config.json)),

      fail: (err) => Effect.sync(() => writeFail(err, config.json)),

      humanLine: (text) =>
        Effect.sync(() => {
          if (!config.json) {
            process.stdout.write(`${text}\n`);
          }
        }),

      humanTable: (headers, rows) =>
        Effect.sync(() => {
          if (config.json) return;
          const table = new Table({
            head: headers,
            style: { head: ["cyan"] },
          });
          for (const row of rows) table.push(row);
          process.stdout.write(`${table.toString()}\n`);
        }),

      debug: (message) =>
        Effect.sync(() => {
          if (config.debug) {
            process.stderr.write(`[debug] ${message}\n`);
          }
        }),
    };
  }),
);
