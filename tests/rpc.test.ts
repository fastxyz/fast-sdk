import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { rpcCall } from '../src/core/rpc.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('rpcCall', () => {
  it('serializes bigint params as exact JSON numbers', async () => {
    let body = '';

    globalThis.fetch = async (_input, init) => {
      body = String(init?.body);
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true } }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    };

    await rpcCall('https://example.com/rpc', 'test_bigint', {
      exact: 1773281639713000064n,
    });

    assert.match(body, /"exact":1773281639713000064/);
  });

  it('serializes Uint8Array params as JSON arrays', async () => {
    let body = '';

    globalThis.fetch = async (_input, init) => {
      body = String(init?.body);
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true } }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    };

    await rpcCall('https://example.com/rpc', 'test_bytes', {
      payload: new Uint8Array([1, 2, 3]),
    });

    assert.match(body, /"payload":\[1,2,3\]/);
  });
});
