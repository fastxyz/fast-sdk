import { Context, Effect, Layer, Option } from 'effect';
import * as readline from 'node:readline';
import { PasswordRequiredError } from '../errors/index.js';
import { CliConfig } from './cli-config.js';

export interface PasswordServiceShape {
  readonly resolve: () => Effect.Effect<string, PasswordRequiredError>;
}

export class PasswordService extends Context.Tag('PasswordService')<PasswordService, PasswordServiceShape>() {}

const promptPassword = (prompt: string): Effect.Effect<string, PasswordRequiredError> =>
  Effect.async<string, PasswordRequiredError>((resume) => {
    process.stderr.write(prompt);

    if (process.stdin.isTTY) {
      // TTY mode: use raw input so characters aren't echoed
      let password = '';
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');

      const onData = (char: string) => {
        if (char === '\r' || char === '\n' || char === '\u0004') {
          cleanup();
          process.stderr.write('\n');
          resume(Effect.succeed(password));
        } else if (char === '\u0003') {
          // Ctrl+C
          cleanup();
          process.exit(130);
        } else if (char === '\u007f' || char === '\b') {
          // Backspace
          password = password.slice(0, -1);
        } else {
          password += char;
        }
      };

      const cleanup = () => {
        process.stdin.removeListener('data', onData);
        process.stdin.pause();
        process.stdin.setRawMode(false);
      };

      process.stdin.on('data', onData);
    } else {
      // Non-TTY (piped): fall back to readline
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stderr,
      });
      rl.question('', (answer) => {
        rl.close();
        resume(Effect.succeed(answer));
      });
    }
  });

export const PasswordServiceLive = Layer.effect(
  PasswordService,
  Effect.gen(function* () {
    const config = yield* CliConfig;

    return {
      resolve: () =>
        Effect.gen(function* () {
          if (Option.isSome(config.password)) {
            return config.password.value;
          }

          const envPassword = process.env.FAST_PASSWORD;
          if (envPassword !== undefined && envPassword !== '') {
            return envPassword;
          }

          if (config.nonInteractive || config.json) {
            return yield* Effect.fail(new PasswordRequiredError());
          }

          return yield* promptPassword('Password: ');
        }),
    };
  }),
);
