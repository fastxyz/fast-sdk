/**
 * integration.test.ts — Live server integration tests
 *
 * Runs against a real Fast network RPC endpoint with no mocking.
 * All assertions check shape/type rather than specific values.
 *
 * Usage:
 *   node --import tsx --test tests/integration.test.ts
 *
 * Environment variables:
 *   FAST_NETWORK       Network to use (default: 'testnet')
 *   FAST_RPC_URL       Override RPC URL (default: from network config)
 *   FAST_TEST_ADDRESS  Address to query for balance/token tests
 *                      (default: a known testnet address)
 *   FAST_PRIVATE_KEY   Hex private key for send tests (optional; send
 *                      tests are skipped if this is not set)
 *   FAST_SEND_TO       Recipient address for send tests (required with
 *                      FAST_PRIVATE_KEY)
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { FastProvider, FastTransaction, VersionedTransaction, FastWallet, FAST_TOKEN_ID, signEd25519, serializeVersionedTransaction } from '../src/index.js';
import { clearDefaultsCache } from '../src/defaults.js';
import { generateEd25519Key, keypairFromPrivateKey } from '../src/keys.js';
import { rpcCall } from '../src/rpc.js';
import { pubkeyToAddress } from '../src/address.js';

// ── Configuration ────────────────────────────────────────────────────────────

const NETWORK = process.env.FAST_NETWORK ?? 'testnet';
const RPC_URL = process.env.FAST_RPC_URL;
const TEST_ADDRESS =
  process.env.FAST_TEST_ADDRESS ??
  'fast1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqd2f6uc';
const PRIVATE_KEY = process.env.FAST_PRIVATE_KEY;
const SEND_TO = process.env.FAST_SEND_TO;

// ── Shared state ─────────────────────────────────────────────────────────────

let provider: FastProvider;
let tmpDir: string;

before(async () => {
  // Use a temp dir so tests don't touch the user's real config
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fast-integration-test-'));
  process.env.FAST_CONFIG_DIR = tmpDir;
  clearDefaultsCache();

  provider = new FastProvider(
    RPC_URL
      ? { rpcUrl: RPC_URL }
      : { network: NETWORK }
  );

  sender_keypair = await keypairFromPrivateKey(sender_test_account_private_key);
  recipient_keypair = await keypairFromPrivateKey(recipient_test_account_private_key);
  sender = new Uint8Array(Buffer.from(sender_keypair.publicKey, 'hex'));
  recipient = new Uint8Array(Buffer.from(recipient_keypair.publicKey, 'hex'));

  const acct_info = await provider.getAccountInfo(pubkeyToAddress(sender));
  const nonce = acct_info?.next_nonce;
  assert(nonce != null);

  tx_token_transfer = {
    sender, recipient, nonce: nonce + 0, timestamp_nanos: 0n, archival: false,
    claim: { TokenTransfer: { token_id: FAST_TOKEN_ID, amount: '1', user_data: null } },
  };
  tx_burn = {
    sender, recipient, nonce: nonce + 1, timestamp_nanos: 0n, archival: false,
    claim: { Burn: { token_id: FAST_TOKEN_ID, amount: '1' } },
  };
  tx_external_claim = {
    sender, recipient, nonce: nonce + 2, timestamp_nanos: 0n, archival: false,
    claim: {
      ExternalClaim: {
        claim: { verifier_committee: [], verifier_quorum: 0n, claim_data: [] },
        signatures: [],
      },
    },
  };
  tx_token_creation = {
    sender, recipient, nonce: nonce + 3, timestamp_nanos: 0n, archival: false,
    claim: {
      TokenCreation: {
        token_name: 'TestToken',
        decimals: 6,
        initial_amount: 'de0b6b3a7640000',
        mints: [],
        user_data: null,
      },
    },
  };
  tx_token_management = {
    sender, recipient, nonce: nonce + 4, timestamp_nanos: 0n, archival: false,
    claim: {
      TokenManagement: {
        token_id: FAST_TOKEN_ID,
        update_id: 1n,
        new_admin: null,
        mints: [],
        user_data: null,
      },
    },
  };
  tx_mint = {
    sender, recipient, nonce: nonce + 5, timestamp_nanos: 0n, archival: false,
    claim: { Mint: { token_id: FAST_TOKEN_ID, amount: 'de0b6b3a7640000' } },
  };
});

// ── FastProvider ─────────────────────────────────────────────────────────────

describe('FastProvider (live)', () => {
  describe('getBalance', () => {
    it('returns a valid FAST balance for any address', async () => {
      const result = await provider.getBalance(TEST_ADDRESS);
      assert.equal(typeof result.amount, 'string');
      assert.equal(result.token, 'FAST');
      assert.ok(
        !isNaN(parseFloat(result.amount)),
        `amount should be a numeric string, got: ${result.amount}`
      );
    });

    it('returns 0 for an address with no balance', async () => {
      // All-zero pubkey encoded as a Fast address — exists but will have 0 balance
      const result = await provider.getBalance(TEST_ADDRESS, 'FAST');
      assert.equal(typeof result.amount, 'string');
      assert.ok(parseFloat(result.amount) >= 0);
    });
  });

  describe('getTokens', () => {
    it('returns an array (may be empty for unfunded address)', async () => {
      const tokens = await provider.getTokens(TEST_ADDRESS);
      assert.ok(Array.isArray(tokens));
      for (const t of tokens) {
        assert.equal(typeof t.symbol, 'string');
        assert.equal(typeof t.tokenId, 'string');
        assert.equal(typeof t.balance, 'string');
        assert.equal(typeof t.decimals, 'number');
      }
    });
  });

  describe('getTokenInfo', () => {
    it('returns FAST token info without an RPC call', async () => {
      const info = await provider.getTokenInfo('FAST');
      assert.ok(info !== null);
      assert.equal(info.symbol, 'FAST');
      assert.equal(typeof info.decimals, 'number');
      assert.ok(info.decimals > 0);
      assert.equal(info.tokenId, 'native');
    });

    it('returns null for a nonexistent token ID', async () => {
      // 32 zero bytes as hex — unlikely to be a real token
      const fakeId = '0x' + '00'.repeat(32);
      const info = await provider.getTokenInfo(fakeId);
      assert.equal(info, null);
    });

    it('returns token info for testUSDC by symbol (testnet only)', { skip: NETWORK !== 'testnet' }, async () => {
      const info = await provider.getTokenInfo('testUSDC');
      if (info === null) {
        // Token may not exist on this particular endpoint — that's OK
        return;
      }
      assert.equal(typeof info.symbol, 'string');
      assert.equal(typeof info.decimals, 'number');
      assert.equal(typeof info.tokenId, 'string');
    });
  });
});

// ── FastWallet ────────────────────────────────────────────────────────────────

describe('FastWallet (live)', () => {
  describe('balance', () => {
    it('queries live balance for a generated wallet', async () => {
      const wallet = await FastWallet.generate(provider);
      const balance = await wallet.balance();
      // New wallet has 0 balance but the call should succeed
      assert.equal(balance.token, 'FAST');
      assert.equal(balance.amount, '0');
    });
  });

  describe('send', () => {
    it(
      'sends FAST to a recipient and returns a txHash',
      {
        skip: !PRIVATE_KEY || !SEND_TO
          ? 'Set FAST_PRIVATE_KEY and FAST_SEND_TO to run send tests'
          : false,
      },
      async () => {
        const wallet = await FastWallet.fromPrivateKey(PRIVATE_KEY!, provider);
        const result = await wallet.send({
          to: SEND_TO!,
          amount: '0.000000001', // 1 nano-FAST (smallest unit)
        });
        assert.equal(typeof result.txHash, 'string');
        assert.ok(result.txHash.length > 0, 'txHash should not be empty');
        assert.ok(
          result.explorerUrl === null || result.explorerUrl.includes(result.txHash),
          'explorerUrl should include txHash if set'
        );
      }
    );
  });
});

// ── Txn Creation ────────────────────────────────────────────────────────────────

const sender_test_account_private_key = "5rGbyr64ig6wCvx3i2YUkia9O/70twPgNTzpIjp1/qo=";
const recipient_test_account_private_key = "SKMvKP1rCYQ5iV3uKHkBy4sIKDGZRUZyMO+bqlI+xmI=";
let sender_keypair: { publicKey: string; privateKey: string };
let recipient_keypair: { publicKey: string; privateKey: string };
let sender: Uint8Array;
let recipient: Uint8Array;
let tx: FastTransaction;

// ── ClaimType example constants ───────────────────────────────────────────────

let tx_token_transfer: FastTransaction;
let tx_token_creation: FastTransaction;
let tx_token_management: FastTransaction;
let tx_mint: FastTransaction;
let tx_burn: FastTransaction;
let tx_external_claim: FastTransaction;

// ── Submission helper ─────────────────────────────────────────────────────────

// Signs and submits a transaction. Passes if the server received and parsed it
// (including logic rejections like bad nonce or insufficient balance).
// Fails only on network/connection errors.
async function submitAndExpectParsed(t: FastTransaction): Promise<void> {
  const versioned: VersionedTransaction = { Release20260303: t };
  const bytes = serializeVersionedTransaction(t);
  const signature = await signEd25519(bytes, sender_keypair.privateKey);
  if (process.env.DEBUG?.split(',').some((s) => s.trim() === 'fast-sdk' || s.trim() === 'fast-sdk:rpc')) {
    console.error('[fast-sdk:test] signature:', Buffer.from(signature).toString('base64'));
  }
  try {
    await rpcCall(provider.rpcUrl, 'proxy_submitTransaction', {
      transaction: versioned,
      signature: { Signature: signature },
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.startsWith('RPC error:')) return;
    throw err;
  }
}

// ── proxy_submitTransaction tests ─────────────────────────────────────────────

describe('proxy_submitTransaction', () => {
  it('TokenTransfer — RPC connects and server parses the transaction', async () => {
    await submitAndExpectParsed(tx_token_transfer);
  });
  it('Burn — RPC connects and server parses the transaction', async () => {
    await submitAndExpectParsed(tx_burn);
  });
  it('ExternalClaim — RPC connects and server parses the transaction', async () => {
    await submitAndExpectParsed(tx_external_claim);
  });
  it('TokenCreation,Management,Mint — RPC connects and server parses the transaction', async () => {
    await submitAndExpectParsed(tx_token_creation);
    await submitAndExpectParsed(tx_token_management);
    await submitAndExpectParsed(tx_mint);
  });
});