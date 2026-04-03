import * as readline from 'node:readline';
import { Context, Effect, Layer } from 'effect';
import * as readline from 'node:readline';
import { type CliError, toErrorCode } from '../errors/index.js';
import { CliConfig } from './cli-config.js';

export interface OutputShape {
  readonly success: (data: unknown) => Effect.Effect<void>;
  readonly error: (err: CliError) => Effect.Effect<void>;
  readonly humanLine: (text: string) => Effect.Effect<void>;
  readonly humanTable: (headers: string[], rows: string[][]) => Effect.Effect<void>;
  readonly confirm: (message: string) => Effect.Effect<boolean>;
  readonly debug: (message: string) => Effect.Effect<void>;
}

export class Output extends Context.Tag('Output')<Output, OutputShape>() {}

export const OutputLive = Layer.effect(
  Output,
  Effect.gen(function* () {
    const config = yield* CliConfig;

    return {
      success: (data) =>
        Effect.sync(() => {
          if (config.json) {
            process.stdout.write(`${JSON.stringify({ ok: true, data }, null, 2)}\n`);
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
          const colWidths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
          const pad = (s: string, w: number) => s.padEnd(w);
          const headerLine = headers.map((h, i) => pad(h, colWidths[i]!)).join('  ');
          process.stdout.write(`  ${headerLine}\n`);
          for (const row of rows) {
            const line = row.map((cell, i) => pad(cell, colWidths[i]!)).join('  ');
            process.stdout.write(`  ${line}\n`);
          }
        }),

      confirm: (message) => {
        if (config.nonInteractive || config.json) return Effect.succeed(true);
        return Effect.async<boolean>((resume) => {
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stderr,
          });
          rl.question(`${message} [y/N] `, (answer: string) => {
            rl.close();
            resume(Effect.succeed(answer.toLowerCase() === 'y'));
          });
        });
      },

      debug: (message) =>
        Effect.sync(() => {
          if (config.debug) {
            process.stderr.write(`[debug] ${message}\n`);
          }
        }),
    };
  }),
);
