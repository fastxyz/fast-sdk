import Table from "cli-table3";
import { Context, Effect, Layer } from "effect";
import { type CliError, toErrorCode } from "../errors/index.js";
import { Config } from "./config.js";

export interface OutputShape {
  readonly success: (data: unknown) => Effect.Effect<void>;
  readonly error: (err: CliError) => Effect.Effect<void>;
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
      success: (data) =>
        Effect.sync(() => {
          if (config.json) {
            process.stdout.write(
              `${JSON.stringify({ ok: true, data }, null, 2)}\n`,
            );
          }
        }),

      error: (err) =>
        Effect.sync(() => {
          if (config.json) {
            process.stdout.write(
              `${JSON.stringify(
                {
                  ok: false,
                  error: { code: toErrorCode(err), message: err.message },
                },
                null,
                2,
              )}\n`,
            );
          } else {
            process.stderr.write(`Error: ${err.message}\n`);
          }
        }),

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
