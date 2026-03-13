import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  FAST_TOKEN_ID,
  FastBrowserWallet,
  FastProvider,
  clearDefaultsCache,
  getCertificateHash,
  type FastBrowserWalletAccount,
  type FastBrowserWalletAdapter,
  type FastTransaction,
  type FastTransactionCertificate,
} from '../src/browser.js';
import { bytesToHex } from '../src/bytes.js';

const VALID_FAST_ADDRESS = 'fast1424242424242424242424242424242424242424242424242424qlc29x9';
const originalFetch = globalThis.fetch;

function rpcResult(result: unknown): Response {
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', id: 1, result }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

function buildCertificate(
  sender: FastBrowserWalletAccount,
  recipient: string,
  claim: FastTransaction['claim'],
): FastTransactionCertificate {
  const transaction: FastTransaction = {
    sender: new Uint8Array(32).fill(3),
    recipient: new Uint8Array(32).fill(4),
    nonce: 11,
    timestamp_nanos: 456n,
    claim,
    archival: false,
  };

  return {
    envelope: {
      transaction: { Release20260303: transaction },
      signature: { Signature: Array.from(new Uint8Array(64).fill(7)) },
    },
    signatures: [[Array.from(new Uint8Array(32).fill(8)), Array.from(new Uint8Array(64).fill(9))]],
  };
}

function createMockInjectedWallet(): {
  adapter: FastBrowserWalletAdapter;
  emitAccountChanged: (account: FastBrowserWalletAccount) => void;
  calls: {
    transfer: Array<{ amount: string; recipient: string; account: FastBrowserWalletAccount; tokenId?: string }>;
    submitClaim: Array<{
      recipient: string;
      claimData: number[];
      account: FastBrowserWalletAccount;
    }>;
  };
} {
  const account: FastBrowserWalletAccount = {
    address: VALID_FAST_ADDRESS,
    publicKey: '11'.repeat(32),
  };
  let connected = false;
  let accountChanged: ((account: FastBrowserWalletAccount) => void) | null = null;
  const calls = {
    transfer: [] as Array<{ amount: string; recipient: string; account: FastBrowserWalletAccount; tokenId?: string }>,
    submitClaim: [] as Array<{ recipient: string; claimData: number[]; account: FastBrowserWalletAccount }>,
  };

  return {
    adapter: {
      async connect(): Promise<boolean> {
        connected = true;
        return true;
      },
      async disconnect(): Promise<boolean> {
        connected = false;
        return true;
      },
      isConnected(): boolean {
        return connected;
      },
      async getAccounts(): Promise<FastBrowserWalletAccount[]> {
        if (!connected) return [];
        return [account];
      },
      async getActiveNetwork(): Promise<string> {
        return 'custom';
      },
      onAccountChanged(callback: (nextAccount: FastBrowserWalletAccount) => void): () => void {
        accountChanged = callback;
        return () => {
          accountChanged = null;
        };
      },
      async signMessage(params): Promise<{ signature: string; messageBytes: string }> {
        return {
          signature: 'ab'.repeat(64),
          messageBytes: bytesToHex(new Uint8Array(params.message)),
        };
      },
      async transfer(params): Promise<FastTransactionCertificate> {
        calls.transfer.push(params);
        return buildCertificate(account, params.recipient, {
          TokenTransfer: {
            token_id: FAST_TOKEN_ID,
            amount: params.amount,
            user_data: null,
          },
        });
      },
      async submitClaim(params): Promise<FastTransactionCertificate> {
        calls.submitClaim.push({
          recipient: params.recipient,
          claimData: params.claimData,
          account: params.account,
        });
        return buildCertificate(account, params.recipient, {
          ExternalClaim: {
            claim: {
              verifier_committee: params.verifierCommittee ?? [],
              verifier_quorum: params.verifierQuorum ?? 0,
              claim_data: params.claimData,
            },
            signatures: params.signatures ?? [],
          },
        });
      },
    },
    emitAccountChanged(nextAccount): void {
      accountChanged?.(nextAccount);
    },
    calls,
  };
}

function collectBrowserGraph(entryFile: string): string[] {
  const visited = new Set<string>();

  function visit(filePath: string): void {
    if (visited.has(filePath)) return;
    visited.add(filePath);

    const source = fs.readFileSync(filePath, 'utf8');
    const importRegex = /from ['"](\.[^'"]+)['"]/g;
    for (const match of source.matchAll(importRegex)) {
      const specifier = match[1];
      const resolved = path.resolve(path.dirname(filePath), specifier);
      const candidateTs = resolved.replace(/\.js$/, '.ts');
      if (fs.existsSync(candidateTs)) {
        visit(candidateTs);
      }
    }
  }

  visit(entryFile);
  return [...visited];
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearDefaultsCache();
});

describe('browser entrypoint', () => {
  it('stays free of node: imports and Buffer in the reachable source graph', () => {
    const files = collectBrowserGraph(path.resolve(process.cwd(), 'src/browser.ts'));
    assert.ok(files.length > 0);
    for (const filePath of files) {
      const source = fs.readFileSync(filePath, 'utf8');
      assert.equal(source.includes('node:'), false, `Unexpected node import in ${filePath}`);
      assert.equal(source.includes('Buffer'), false, `Unexpected Buffer usage in ${filePath}`);
    }
  });

  it('loads provider config from constructor overrides in browser mode', async () => {
    const provider = new FastProvider({
      network: 'custom',
      networks: {
        custom: {
          rpc: 'https://custom.example.com/proxy',
          explorer: 'https://custom.example.com/explorer',
        },
      },
      tokens: {
        CUSTOM: {
          symbol: 'CUSTOM',
          tokenId: '0x1234',
          decimals: 4,
        },
      },
    });

    assert.equal(await provider.getExplorerUrl(), 'https://custom.example.com/explorer');
    const token = await provider.resolveKnownToken('custom');
    assert.deepEqual(token, {
      symbol: 'CUSTOM',
      tokenId: '0x1234',
      decimals: 4,
    });
  });

  it('supports injected-wallet connect, sign, send, submitClaim, and account change callbacks', async () => {
    const mock = createMockInjectedWallet();
    const provider = new FastProvider({
      network: 'custom',
      networks: {
        custom: {
          rpc: 'https://custom.example.com/proxy',
          explorer: 'https://custom.example.com/explorer',
        },
      },
    });
    const wallet = FastBrowserWallet.fromInjected(mock.adapter, provider);

    const seenAccounts: FastBrowserWalletAccount[] = [];
    const unsubscribe = wallet.onAccountChanged((account) => {
      seenAccounts.push(account);
    });

    assert.equal(await wallet.connect(), true);
    assert.equal(wallet.isConnected(), true);
    assert.equal(wallet.address, VALID_FAST_ADDRESS);

    const signed = await wallet.sign({ message: 'Hello, browser!' });
    assert.equal(signed.address, VALID_FAST_ADDRESS);
    assert.equal(signed.messageBytes, bytesToHex(new TextEncoder().encode('Hello, browser!')));
    assert.equal(signed.signature, 'ab'.repeat(64));

    const sent = await wallet.send({ to: VALID_FAST_ADDRESS, amount: '1' });
    assert.equal(mock.calls.transfer.length, 1);
    assert.equal(mock.calls.transfer[0]?.amount, 'de0b6b3a7640000');
    assert.equal(sent.txHash, getCertificateHash(sent.certificate));
    assert.equal(sent.explorerUrl, `https://custom.example.com/explorer/txs/${sent.txHash}`);

    const submitted = await wallet.submitClaim({
      recipient: VALID_FAST_ADDRESS,
      claimData: new Uint8Array([1, 2, 3]),
    });
    assert.equal(mock.calls.submitClaim.length, 1);
    assert.ok(submitted.txHash.startsWith('0x'));

    mock.emitAccountChanged({
      address: 'fast1anr2g7daw8rr0mp6mxce8u2f0g8x9jp3c4l5zxy7m47s0ve3e0wqej4h3m',
      publicKey: '22'.repeat(32),
    });
    assert.equal(seenAccounts.length, 1);
    assert.equal(wallet.address, seenAccounts[0]?.address ?? null);

    unsubscribe();
  });
});
