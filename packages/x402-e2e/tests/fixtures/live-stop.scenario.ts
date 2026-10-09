import { afterAll, describe, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { requireMatrixGate } from '../../src/live-config.js';

// No clients, signers, RPCs or credentials: payment is a counter only.
const failureStage = process.env.X402_OFFLINE_FAILURE_STAGE;
const failureIndex = Number(process.env.X402_OFFLINE_FAILURE_INDEX);
const state = { started: 0, payments: 0, completed: 0, closed: 0 };

async function listen(): Promise<Server> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  state.closed++;
}

describe.sequential('offline live-runner failure injection', () => {
  afterAll(() => {
    console.info(`OFFLINE_MATRIX_RESULT:${JSON.stringify(state)}`);
    requireMatrixGate({ X402_LIVE_MATRIX: '1' }, state.completed);
  });

  for (let index = 0; index < 8; index++) {
    it(`case ${index}`, async () => {
      state.started++;
      const facilitator = await listen();
      let content: Server | undefined;
      try {
        content = await listen();
        if (index === failureIndex && failureStage === 'preflight') throw new Error('offline preflight failure');
        state.payments++;
        if (index === failureIndex && failureStage === 'payment') throw new Error('offline payment outcome unknown');
        if (index === failureIndex && failureStage === 'confirmation') throw new Error('offline certificate lookup failure');
        state.completed++;
      } finally {
        if (content) await close(content);
        await close(facilitator);
      }
    });
  }
});
