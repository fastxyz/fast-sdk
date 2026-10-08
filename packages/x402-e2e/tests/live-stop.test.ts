import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function runScenario(stage: string, index = 0) {
  const run = spawnSync(
    process.execPath,
    [
      createRequire(import.meta.url).resolve('vitest/vitest.mjs'),
      'run',
      '--config',
      'tests/fixtures/live-stop.config.ts',
      '--maxWorkers=1',
      '--minWorkers=1',
    ],
    {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      // Do not pass live opt-ins or wallet credentials to the offline subprocess.
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        FORCE_COLOR: '0',
        X402_OFFLINE_FAILURE_STAGE: stage,
        X402_OFFLINE_FAILURE_INDEX: String(index),
      },
      encoding: 'utf8',
      timeout: 20_000,
    },
  );
  expect(run.error).toBeUndefined();
  const output = `${run.stdout}\n${run.stderr}`;
  const result = output.match(/OFFLINE_MATRIX_RESULT:(\{[^\n]+\})/);
  expect(result, output).not.toBeNull();
  return { status: run.status, output, state: JSON.parse(result![1]) };
}

describe('live matrix stops before later payments (offline)', () => {
  it.each(['preflight', 'payment', 'confirmation'])(
    'stops after a %s failure and closes both servers',
    (stage) => {
      const result = runScenario(stage);
      expect(result.status).toBe(1);
      expect(result.output).toContain('eight successful live payments');
      expect(result.state).toEqual({ started: 1, payments: stage === 'preflight' ? 0 : 1, completed: 0, closed: 2 });
    },
    30_000,
  );

  it('also stops when the first Base case fails after four successful Fast cases', () => {
    const result = runScenario('confirmation', 4);
    expect(result.status).toBe(1);
    expect(result.state).toEqual({ started: 5, payments: 5, completed: 4, closed: 10 });
  }, 30_000);

  it('still runs all eight successful cases and satisfies the gate', () => {
    const result = runScenario('none');
    expect(result.status).toBe(0);
    expect(result.state).toEqual({ started: 8, payments: 8, completed: 8, closed: 16 });
  }, 30_000);
});
