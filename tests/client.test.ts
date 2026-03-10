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
// fastUSDC token ID on staging
const FAST_USDC_TOKEN_ID = [180, 207, 27, 158, 34, 123, 182, 162, 27, 149, 147, 56, 137, 93, 251, 57, 184, 210, 169, 109, 250, 28, 229, 221, 99, 53, 97, 193, 147, 18, 76, 181] as const;

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
        assert.equal(err.code, 'NETWORK_NOT_CONFIGURED');
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
        assert.equal(err.code, 'NETWORK_NOT_CONFIGURED');
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
        assert.equal(err.code, 'NETWORK_NOT_CONFIGURED');
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

  it('creates a keyfile at path.join(tmpDir, "keys", "default.json")', async () => {
    const f = fast();
    await f.setup();
    const keyfilePath = path.join(tmpDir, 'keys', 'default.json');
    const stat = await fs.stat(keyfilePath);
    assert.ok(stat.isFile(), `expected keyfile at ${keyfilePath}`);
  });

  // Note: config.json is no longer created — network/token config is loaded from JSON files
});

describe('setup() idempotency', () => {
  it('returns same address on second call', async () => {
    const f = fast();
    const first = await f.setup();
    const second = await f.setup();
    assert.equal(first.address, second.address);
  });
});

describe('named keys', () => {
  it('creates keyfile with custom name via key option', async () => {
    const f = fast({ key: 'merchant' });
    await f.setup();
    const keyfilePath = path.join(tmpDir, 'keys', 'merchant.json');
    const stat = await fs.stat(keyfilePath);
    assert.ok(stat.isFile(), `expected keyfile at ${keyfilePath}`);
  });

  it('different key names create different addresses', async () => {
    const merchant = fast({ key: 'merchant2' });
    const buyer = fast({ key: 'buyer2' });
    const merchantResult = await merchant.setup();
    const buyerResult = await buyer.setup();
    assert.notEqual(merchantResult.address, buyerResult.address);
  });

  it('same key name returns same address', async () => {
    const f1 = fast({ key: 'consistent' });
    const f2 = fast({ key: 'consistent' });
    const result1 = await f1.setup();
    const result2 = await f2.setup();
    assert.equal(result1.address, result2.address);
  });
});

describe('explicit keyFile', () => {
  it('uses explicit keyFile path when provided', async () => {
    const customPath = path.join(tmpDir, 'custom', 'mykey.json');
    const f = fast({ keyFile: customPath });
    await f.setup();
    const stat = await fs.stat(customPath);
    assert.ok(stat.isFile(), `expected keyfile at ${customPath}`);
  });

  it('keyFile takes priority over key option', async () => {
    const customPath = path.join(tmpDir, 'priority', 'priority.json');
    const f = fast({ key: 'ignored', keyFile: customPath });
    await f.setup();
    const stat = await fs.stat(customPath);
    assert.ok(stat.isFile(), `expected keyfile at ${customPath}`);
    // Verify the key option file was NOT created
    const ignoredPath = path.join(tmpDir, 'keys', 'ignored.json');
    try {
      await fs.stat(ignoredPath);
      assert.fail('ignored.json should not exist');
    } catch (err: unknown) {
      assert.equal((err as NodeJS.ErrnoException).code, 'ENOENT');
    }
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
  it('balance() returns 0 for the known FASTUSDC token when metadata exists but the wallet holds none', async () => {
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

      if (parsed.method === 'proxy_getTokenInfo') {
        return rpcResult({
          requested_token_metadata: [[FAST_USDC_TOKEN_ID, { token_name: 'fastUSDC', decimals: 6 }]],
        });
      }

      throw new Error(`Unexpected RPC method: ${parsed.method}`);
    }) as typeof fetch;

    const f = fast({ network: 'testnet' });
    await f.setup();
    const result = await f.balance({ token: 'fastUSDC' });

    assert.equal(result.amount, '0');
    assert.equal(result.token, 'fastUSDC');
  });

  it('balance() throws TOKEN_NOT_FOUND when known FASTUSDC metadata is missing on the selected network', async () => {
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const bodyText = typeof init?.body === 'string' ? init.body : '';
      const parsed = JSON.parse(bodyText) as { method: string; params: Record<string, unknown> };

      if (parsed.method === 'proxy_getAccountInfo') {
        return rpcResult({
          balance: '0',
          token_balance: [],
          next_nonce: 10,
        });
      }

      if (parsed.method === 'proxy_getTokenInfo') {
        return rpcResult({
          requested_token_metadata: [[FAST_USDC_TOKEN_ID, null]],
        });
      }

      throw new Error(`Unexpected RPC method: ${parsed.method}`);
    }) as typeof fetch;

    const f = fast({ network: 'mainnet' });
    await f.setup();

    await assert.rejects(
      () => f.balance({ token: 'fastUSDC' }),
      (error: unknown) => {
        assert.ok(error instanceof FastError);
        assert.equal(error.code, 'TOKEN_NOT_FOUND');
        return true;
      },
    );
  });

  it('balance() resolves a held token symbol like FASTUSDC', async () => {
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const bodyText = typeof init?.body === 'string' ? init.body : '';
      const parsed = JSON.parse(bodyText) as { method: string; params: Record<string, unknown> };

      if (parsed.method === 'proxy_getAccountInfo') {
        assert.deepEqual(parsed.params.token_balances_filter, []);
        return rpcResult({
          balance: '0',
          token_balance: [[FAST_USDC_TOKEN_ID, '4fba280']],
          next_nonce: 10,
        });
      }

      if (parsed.method === 'proxy_getTokenInfo') {
        return rpcResult({
          requested_token_metadata: [[FAST_USDC_TOKEN_ID, { token_name: 'fastUSDC', decimals: 6 }]],
        });
      }

      throw new Error(`Unexpected RPC method: ${parsed.method}`);
    }) as typeof fetch;

    const f = fast({ network: 'mainnet' });
    await f.setup();
    const result = await f.balance({ token: 'fastUSDC' });

    assert.equal(result.amount, '83.6');
    assert.equal(result.token, 'fastUSDC');
  });

  it('send() resolves a held token symbol like FASTUSDC before submit', async () => {
    let submittedTransaction: unknown = null;

    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const bodyText = typeof init?.body === 'string' ? init.body : '';
      const parsed = JSON.parse(bodyText) as { method: string; params: Record<string, unknown> };

      if (parsed.method === 'proxy_getAccountInfo') {
        assert.deepEqual(parsed.params.token_balances_filter, []);
        return rpcResult({
          balance: '0',
          token_balance: [[FAST_USDC_TOKEN_ID, '4fba280']],
          next_nonce: 7,
        });
      }

      if (parsed.method === 'proxy_getTokenInfo') {
        return rpcResult({
          requested_token_metadata: [[FAST_USDC_TOKEN_ID, { token_name: 'fastUSDC', decimals: 6 }]],
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
      token: 'fastUSDC',
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
    assert.deepEqual(tx.claim?.TokenTransfer?.token_id, FAST_USDC_TOKEN_ID);
    assert.equal(tx.claim?.TokenTransfer?.amount, '16e360');
  });

  it('send() resolves the known FASTUSDC token when metadata exists even if the wallet holds none yet', async () => {
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

      if (parsed.method === 'proxy_getTokenInfo') {
        return rpcResult({
          requested_token_metadata: [[FAST_USDC_TOKEN_ID, { token_name: 'fastUSDC', decimals: 6 }]],
        });
      }

      if (parsed.method === 'proxy_submitTransaction') {
        submittedTransaction = parsed.params.transaction;
        return rpcResult({ Success: { envelope: { hash: 'abc123' }, signatures: [] } });
      }

      throw new Error(`Unexpected RPC method: ${parsed.method}`);
    }) as typeof fetch;

    const f = fast({ network: 'testnet' });
    const { address } = await f.setup();
    const result = await f.send({
      to: address,
      amount: '1.5',
      token: 'fastUSDC',
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
    assert.deepEqual(tx.claim?.TokenTransfer?.token_id, FAST_USDC_TOKEN_ID);
    assert.equal(tx.claim?.TokenTransfer?.amount, '16e360');
  });

  it('send() throws TOKEN_NOT_FOUND when known FASTUSDC metadata is missing on the selected network', async () => {
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

      if (parsed.method === 'proxy_getTokenInfo') {
        return rpcResult({
          requested_token_metadata: [[FAST_USDC_TOKEN_ID, null]],
        });
      }

      throw new Error(`Unexpected RPC method: ${parsed.method}`);
    }) as typeof fetch;

    const f = fast({ network: 'mainnet' });
    const { address } = await f.setup();

    await assert.rejects(
      () => f.send({
        to: address,
        amount: '1.5',
        token: 'fastUSDC',
      }),
      (error: unknown) => {
        assert.ok(error instanceof FastError);
        assert.equal(error.code, 'TOKEN_NOT_FOUND');
        return true;
      },
    );
  });

  it('send() throws INVALID_ADDRESS for malformed recipient before RPC submit', async () => {
    let rpcCalled = false;

    globalThis.fetch = (async (_url: string | URL | Request, _init?: RequestInit) => {
      rpcCalled = true;
      throw new Error('RPC should not be called for invalid destination address');
    }) as typeof fetch;

    const f = fast({ network: 'mainnet' });
    await f.setup();

    await assert.rejects(
      () => f.send({
        to: 'fast1invalid_address_here',
        amount: '1',
      }),
      (error: unknown) => {
        assert.ok(error instanceof FastError);
        assert.equal(error.code, 'INVALID_ADDRESS');
        assert.match(error.message, /Invalid Fast address/i);
        return true;
      },
    );

    assert.equal(rpcCalled, false);
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

      if (parsed.method === 'proxy_getTokenInfo') {
        return rpcResult({
          requested_token_metadata: [[FAST_USDC_TOKEN_ID, { token_name: 'fastUSDC', decimals: 6 }]],
        });
      }

      if (parsed.method === 'proxy_submitTransaction') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            error: {
              code: -32000,
              message: 'Execution error: panicked at validator/src/ledger/validator.rs:97:8: quorum not reached: SubmitError(FastSet(InsufficientFunding))',
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

    const f = fast({ network: 'testnet' });
    const { address } = await f.setup();

    await assert.rejects(
      () => f.send({
        to: address,
        amount: '1.5',
        token: 'fastUSDC',
      }),
      (error: unknown) => {
        assert.ok(error instanceof FastError);
        assert.equal(error.code, 'INSUFFICIENT_BALANCE');
        assert.doesNotMatch(error.message, /validator\/src|panicked at/i);
        return true;
      },
    );
  });

  it('tokenInfo() resolves a held token symbol like FASTUSDC', async () => {
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const bodyText = typeof init?.body === 'string' ? init.body : '';
      const parsed = JSON.parse(bodyText) as { method: string; params: Record<string, unknown> };

      if (parsed.method === 'proxy_getAccountInfo') {
        return rpcResult({
          balance: '0',
          token_balance: [[FAST_USDC_TOKEN_ID, '4fba280']],
          next_nonce: 10,
        });
      }

      if (parsed.method === 'proxy_getTokenInfo') {
        return rpcResult({
          requested_token_metadata: [[FAST_USDC_TOKEN_ID, {
            token_name: 'fastUSDC',
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
    const info = await f.tokenInfo({ token: 'fastUSDC' });

    assert.equal(info.symbol, 'fastUSDC');
    assert.equal(info.decimals, 6);
    assert.equal(info.address, '0xb4cf1b9e227bb6a21b959338895dfb39b8d2a96dfa1ce5dd633561c193124cb5');
  });

  it('tokenInfo() resolves the known FASTUSDC token without requiring a held balance', async () => {
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const bodyText = typeof init?.body === 'string' ? init.body : '';
      const parsed = JSON.parse(bodyText) as { method: string; params: Record<string, unknown> };

      if (parsed.method === 'proxy_getTokenInfo') {
        return rpcResult({
          requested_token_metadata: [[FAST_USDC_TOKEN_ID, {
            token_name: 'fastUSDC',
            decimals: 6,
            total_supply: '12345000000',
          }]],
        });
      }

      throw new Error(`Unexpected RPC method: ${parsed.method}`);
    }) as typeof fetch;

    const f = fast({ network: 'mainnet' });
    const info = await f.tokenInfo({ token: 'fastUSDC' });

    assert.equal(info.symbol, 'fastUSDC');
    assert.equal(info.decimals, 6);
    assert.equal(info.address, '0xb4cf1b9e227bb6a21b959338895dfb39b8d2a96dfa1ce5dd633561c193124cb5');
    assert.equal(info.totalSupply, '12345000000');
  });
});

// faucet() tests removed - faucet no longer available
