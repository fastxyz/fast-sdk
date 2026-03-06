import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { fast } from '../src/client.js';
import { FastError } from '../src/errors.js';

let tmpDir: string;
let originalConfigDir: string | undefined;
const originalFetch = globalThis.fetch;
const SET_USDC_TOKEN_ID = [30, 116, 73, 0, 2, 17, 130, 178, 147, 83, 139, 182, 104, 91, 119, 223, 9, 94, 53, 19, 100, 213, 80, 2, 22, 20, 206, 144, 200, 171, 158, 10] as const;

function rpcResult(result: unknown): Response {
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', id: 1, result }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

before(async () => {
  originalConfigDir = process.env.FAST_CONFIG_DIR;
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fast-client-test-'));
  process.env.FAST_CONFIG_DIR = tmpDir;
});

after(async () => {
  if (originalConfigDir !== undefined) {
    process.env.FAST_CONFIG_DIR = originalConfigDir;
  } else {
    delete process.env.FAST_CONFIG_DIR;
  }
  await fs.rm(tmpDir, { recursive: true, force: true });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('fast() factory', () => {
  it('returns an object (not null/undefined)', () => {
    const f = fast();
    assert.ok(f !== null && f !== undefined);
  });

  it('returns object with expected method names', () => {
    const f = fast();
    const methods = [
      'setup',
      'balance',
      'send',
      'submit',
      'evmSign',
      'sign',
      'verify',
      'tokens',
      'tokenInfo',
      'exportKeys',
    ];
    for (const method of methods) {
      assert.ok(
        typeof (f as unknown as Record<string, unknown>)[method] === 'function',
        `expected method "${method}" to exist`,
      );
    }
  });

  it('fast({ network: "testnet" }) works without error', () => {
    assert.doesNotThrow(() => fast({ network: 'testnet' }));
  });
});

describe('address before setup', () => {
  it('address is null before calling setup()', () => {
    const f = fast();
    assert.equal(f.address, null);
  });
});

describe('ensureSetup guard', () => {
  it('balance() throws before setup', async () => {
    const f = fast();
    await assert.rejects(
      () => f.balance(),
      (err: unknown) => {
        assert(err instanceof FastError);
        assert.equal(err.code, 'CHAIN_NOT_CONFIGURED');
        return true;
      },
    );
  });

  it('send() throws before setup', async () => {
    const f = fast();
    await assert.rejects(
      () => f.send({ to: 'fast1abc', amount: '1.0' }),
      (err: unknown) => {
        assert(err instanceof FastError);
        assert.equal(err.code, 'CHAIN_NOT_CONFIGURED');
        return true;
      },
    );
  });

  it('exportKeys() throws before setup', async () => {
    const f = fast();
    await assert.rejects(
      () => f.exportKeys(),
      (err: unknown) => {
        assert(err instanceof FastError);
        assert.equal(err.code, 'CHAIN_NOT_CONFIGURED');
        return true;
      },
    );
  });
});

describe('setup()', () => {
  it('returns { address: string } where address starts with "fast1"', async () => {
    const f = fast();
    const result = await f.setup();
    assert.ok(typeof result.address === 'string');
    assert.ok(result.address.startsWith('fast1'), `expected address to start with "fast1", got "${result.address}"`);
  });

  it('after setup, client.address is not null', async () => {
    const f = fast();
    await f.setup();
    assert.notEqual(f.address, null);
  });

  it('after setup, client.address matches the returned address', async () => {
    const f = fast();
    const result = await f.setup();
    assert.equal(f.address, result.address);
  });

  it('creates a keyfile at path.join(tmpDir, "keys", "fast.json")', async () => {
    const f = fast();
    await f.setup();
    const keyfilePath = path.join(tmpDir, 'keys', 'fast.json');
    const stat = await fs.stat(keyfilePath);
    assert.ok(stat.isFile(), `expected keyfile at ${keyfilePath}`);
  });

  it('creates a config at path.join(tmpDir, "config.json")', async () => {
    const f = fast();
    await f.setup();
    const configPath = path.join(tmpDir, 'config.json');
    const stat = await fs.stat(configPath);
    assert.ok(stat.isFile(), `expected config at ${configPath}`);
  });
});

describe('setup() idempotency', () => {
  it('returns same address on second call', async () => {
    const f = fast();
    const first = await f.setup();
    const second = await f.setup();
    assert.equal(first.address, second.address);
  });
});

describe('exportKeys()', () => {
  it('after setup, returns { publicKey: string, address: string }', async () => {
    const f = fast();
    await f.setup();
    const keys = await f.exportKeys();
    assert.ok(typeof keys.publicKey === 'string');
    assert.ok(typeof keys.address === 'string');
  });

  it('publicKey is 64 hex chars', async () => {
    const f = fast();
    await f.setup();
    const { publicKey } = await f.exportKeys();
    assert.match(publicKey, /^[0-9a-f]{64}$/, `expected 64 hex chars, got "${publicKey}"`);
  });

  it('address matches client.address', async () => {
    const f = fast();
    await f.setup();
    const { address } = await f.exportKeys();
    assert.equal(address, f.address);
  });
});

describe('sign() / verify() roundtrip', () => {
  it('sign then verify roundtrip', async () => {
    const f = fast();
    await f.setup();
    const { signature, address } = await f.sign({ message: 'hello' });
    const { valid } = await f.verify({ message: 'hello', signature, address });
    assert.equal(valid, true);
  });

  it('verify fails with wrong message', async () => {
    const f = fast();
    await f.setup();
    const { signature, address } = await f.sign({ message: 'hello' });
    const { valid } = await f.verify({ message: 'wrong', signature, address });
    assert.equal(valid, false);
  });
});

describe('custom token resolution', () => {
  it('balance() returns 0 for the known SETUSDC token when the wallet holds none', async () => {
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const bodyText = typeof init?.body === 'string' ? init.body : '';
      const parsed = JSON.parse(bodyText) as { method: string; params: Record<string, unknown> };

      if (parsed.method === 'proxy_getAccountInfo') {
        assert.deepEqual(parsed.params.token_balances_filter, []);
        return rpcResult({
          balance: '0',
          token_balance: [],
          next_nonce: 10,
        });
      }

      throw new Error(`Unexpected RPC method: ${parsed.method}`);
    }) as typeof fetch;

    const f = fast({ network: 'mainnet' });
    await f.setup();
    const result = await f.balance({ token: 'SETUSDC' });

    assert.equal(result.amount, '0');
    assert.equal(result.token, 'SETUSDC');
  });

  it('balance() resolves a held token symbol like SETUSDC', async () => {
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const bodyText = typeof init?.body === 'string' ? init.body : '';
      const parsed = JSON.parse(bodyText) as { method: string; params: Record<string, unknown> };

      if (parsed.method === 'proxy_getAccountInfo') {
        assert.deepEqual(parsed.params.token_balances_filter, []);
        return rpcResult({
          balance: '0',
          token_balance: [[SET_USDC_TOKEN_ID, '4fba280']],
          next_nonce: 10,
        });
      }

      if (parsed.method === 'proxy_getTokenInfo') {
        return rpcResult({
          requested_token_metadata: [[SET_USDC_TOKEN_ID, { token_name: 'setUSDC', decimals: 6 }]],
        });
      }

      throw new Error(`Unexpected RPC method: ${parsed.method}`);
    }) as typeof fetch;

    const f = fast({ network: 'mainnet' });
    await f.setup();
    const result = await f.balance({ token: 'SETUSDC' });

    assert.equal(result.amount, '83.6');
    assert.equal(result.token, 'setUSDC');
  });

  it('send() resolves a held token symbol like SETUSDC before submit', async () => {
    let submittedTransaction: unknown = null;

    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const bodyText = typeof init?.body === 'string' ? init.body : '';
      const parsed = JSON.parse(bodyText) as { method: string; params: Record<string, unknown> };

      if (parsed.method === 'proxy_getAccountInfo') {
        assert.deepEqual(parsed.params.token_balances_filter, []);
        return rpcResult({
          balance: '0',
          token_balance: [[SET_USDC_TOKEN_ID, '4fba280']],
          next_nonce: 7,
        });
      }

      if (parsed.method === 'proxy_getTokenInfo') {
        return rpcResult({
          requested_token_metadata: [[SET_USDC_TOKEN_ID, { token_name: 'setUSDC', decimals: 6 }]],
        });
      }

      if (parsed.method === 'proxy_submitTransaction') {
        submittedTransaction = parsed.params.transaction;
        return rpcResult({ Success: { envelope: { hash: 'abc123' }, signatures: [] } });
      }

      throw new Error(`Unexpected RPC method: ${parsed.method}`);
    }) as typeof fetch;

    const f = fast({ network: 'mainnet' });
    const { address } = await f.setup();
    const result = await f.send({
      to: address,
      amount: '1.5',
      token: 'SETUSDC',
    });

    assert.ok(result.txHash.startsWith('0x'));
    assert.ok(submittedTransaction);
    const tx = submittedTransaction as {
      claim?: {
        TokenTransfer?: {
          token_id?: number[];
          amount?: string;
        };
      };
    };
    assert.deepEqual(tx.claim?.TokenTransfer?.token_id, SET_USDC_TOKEN_ID);
    assert.equal(tx.claim?.TokenTransfer?.amount, '16e360');
  });

  it('send() resolves the known SETUSDC token even when the wallet holds none yet', async () => {
    let submittedTransaction: unknown = null;

    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const bodyText = typeof init?.body === 'string' ? init.body : '';
      const parsed = JSON.parse(bodyText) as { method: string; params: Record<string, unknown> };

      if (parsed.method === 'proxy_getAccountInfo') {
        assert.deepEqual(parsed.params.token_balances_filter, []);
        return rpcResult({
          balance: '0',
          token_balance: [],
          next_nonce: 4,
        });
      }

      if (parsed.method === 'proxy_submitTransaction') {
        submittedTransaction = parsed.params.transaction;
        return rpcResult({ Success: { envelope: { hash: 'abc123' }, signatures: [] } });
      }

      throw new Error(`Unexpected RPC method: ${parsed.method}`);
    }) as typeof fetch;

    const f = fast({ network: 'mainnet' });
    const { address } = await f.setup();
    const result = await f.send({
      to: address,
      amount: '1.5',
      token: 'SETUSDC',
    });

    assert.ok(result.txHash.startsWith('0x'));
    assert.ok(submittedTransaction);
    const tx = submittedTransaction as {
      claim?: {
        TokenTransfer?: {
          token_id?: number[];
          amount?: string;
        };
      };
    };
    assert.deepEqual(tx.claim?.TokenTransfer?.token_id, SET_USDC_TOKEN_ID);
    assert.equal(tx.claim?.TokenTransfer?.amount, '16e360');
  });

  it('send() maps Fast insufficient funding errors to INSUFFICIENT_BALANCE', async () => {
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const bodyText = typeof init?.body === 'string' ? init.body : '';
      const parsed = JSON.parse(bodyText) as { method: string; params: Record<string, unknown> };

      if (parsed.method === 'proxy_getAccountInfo') {
        return rpcResult({
          balance: '0',
          token_balance: [],
          next_nonce: 4,
        });
      }

      if (parsed.method === 'proxy_submitTransaction') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            error: {
              code: -32000,
              message: 'quorum not reached: SubmitError(FastSet(InsufficientFunding))',
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      throw new Error(`Unexpected RPC method: ${parsed.method}`);
    }) as typeof fetch;

    const f = fast({ network: 'mainnet' });
    const { address } = await f.setup();

    await assert.rejects(
      () => f.send({
        to: address,
        amount: '1.5',
        token: 'SETUSDC',
      }),
      (error: unknown) => {
        assert.ok(error instanceof FastError);
        assert.equal(error.code, 'INSUFFICIENT_BALANCE');
        return true;
      },
    );
  });

  it('tokenInfo() resolves a held token symbol like SETUSDC', async () => {
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const bodyText = typeof init?.body === 'string' ? init.body : '';
      const parsed = JSON.parse(bodyText) as { method: string; params: Record<string, unknown> };

      if (parsed.method === 'proxy_getAccountInfo') {
        return rpcResult({
          balance: '0',
          token_balance: [[SET_USDC_TOKEN_ID, '4fba280']],
          next_nonce: 10,
        });
      }

      if (parsed.method === 'proxy_getTokenInfo') {
        return rpcResult({
          requested_token_metadata: [[SET_USDC_TOKEN_ID, {
            token_name: 'setUSDC',
            decimals: 6,
            total_supply: '30ccd8f20',
            admin: [1, 2, 3],
            mints: [[4, 5, 6]],
          }]],
        });
      }

      throw new Error(`Unexpected RPC method: ${parsed.method}`);
    }) as typeof fetch;

    const f = fast({ network: 'mainnet' });
    await f.setup();
    const info = await f.tokenInfo({ token: 'SETUSDC' });

    assert.equal(info.symbol, 'setUSDC');
    assert.equal(info.decimals, 6);
    assert.equal(info.address, '0x1e744900021182b293538bb6685b77df095e351364d550021614ce90c8ab9e0a');
  });

  it('tokenInfo() resolves the known SETUSDC token without requiring a held balance', async () => {
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const bodyText = typeof init?.body === 'string' ? init.body : '';
      const parsed = JSON.parse(bodyText) as { method: string; params: Record<string, unknown> };

      if (parsed.method === 'proxy_getTokenInfo') {
        return rpcResult({
          requested_token_metadata: [[SET_USDC_TOKEN_ID, {
            token_name: 'setUSDC',
            decimals: 6,
            total_supply: '12345000000',
          }]],
        });
      }

      throw new Error(`Unexpected RPC method: ${parsed.method}`);
    }) as typeof fetch;

    const f = fast({ network: 'mainnet' });
    const info = await f.tokenInfo({ token: 'SETUSDC' });

    assert.equal(info.symbol, 'setUSDC');
    assert.equal(info.decimals, 6);
    assert.equal(info.address, '0x1e744900021182b293538bb6685b77df095e351364d550021614ce90c8ab9e0a');
    assert.equal(info.totalSupply, '12345000000');
  });
});
