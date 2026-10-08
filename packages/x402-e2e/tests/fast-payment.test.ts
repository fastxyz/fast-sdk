/**
 * x402 End-to-End Test — Fast Testnet
 *
 * Spins up a facilitator server and a content server in-process,
 * then uses x402Pay() to exercise the full 402 payment flow
 * against the real Fast testnet.
 *
 * Requires explicit X402_LIVE_FAST=1 and externally provided environment with:
 *   FAST_TEST_RPC_URL=...
 *   FAST_TEST_SIGNER_PRIVATE_KEY=...
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { Signer, toFastAddress, toHex } from '@fastxyz/sdk';
import { testnet } from '@fastxyz/sdk/networks';
import { createFacilitatorServer } from '@fastxyz/x402-facilitator';
import { paymentMiddleware } from '@fastxyz/x402-server';
import { x402Pay } from '@fastxyz/x402-client';
import type { FacilitatorConfig } from '@fastxyz/x402-facilitator';

// ─── Config ──────────────────────────────────────────────────────────────────

const FAST_TEST_RPC_URL = process.env.FAST_TEST_RPC_URL;
const FAST_TEST_SIGNER_PRIVATE_KEY = process.env.FAST_TEST_SIGNER_PRIVATE_KEY;

const FAST_TESTNET_USDC_TOKEN_ID = '0xd73a0679a2be46981e2a8aedecd951c8b6690e7d5f8502b34ed3ff4cc2163b46';
const PAYMENT_PRICE = '$0.001';
const NETWORK = 'fast-testnet';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function listenOnRandomPort(app: express.Express): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to get server address'));
        return;
      }
      resolve({ server, port: addr.port });
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

const skip = process.env.X402_LIVE_FAST !== '1';
if (
  !skip &&
  (!FAST_TEST_RPC_URL ||
    !FAST_TEST_SIGNER_PRIVATE_KEY ||
    !process.env.FAST_TEST_RECIPIENT_PRIVATE_KEY ||
    !process.env.FAST_TEST_COMMITTEE_PUBLIC_KEYS)
) {
  throw new Error('Explicit live Fast opt-in requires RPC, payer, controlled recipient key and trusted committee keys');
}
if (
  !skip &&
  (FAST_TEST_RPC_URL !== testnet.url ||
    process.env.X402_CONTROLLED_RECIPIENTS !== '1' ||
    process.env.FAST_TEST_COMMITTEE_PUBLIC_KEYS!.split(',').some((key) => !/^(?:0x)?[a-fA-F0-9]{64}$/.test(key.trim())))
) {
  throw new Error('Live Fast requires pinned testnet RPC, controlled recipient confirmation and nonempty trusted committee keys');
}

describe.skipIf(skip)('x402 E2E — Fast testnet payment flow', () => {
  let facilitatorServer: Server;
  let contentServer: Server;
  let facilitatorPort: number;
  let contentPort: number;
  let recipientAddress: string;
  let fastWallet: {
    type: 'fast';
    privateKey: string;
    publicKey: string;
    address: string;
    rpcUrl: string;
  };

  beforeAll(async () => {
    // ── Derive payer wallet ──
    const payerSigner = new Signer(FAST_TEST_SIGNER_PRIVATE_KEY!);
    const payerPublicKey = await payerSigner.getPublicKey();
    const payerAddress = toFastAddress(payerPublicKey);

    fastWallet = {
      type: 'fast',
      privateKey: `0x${FAST_TEST_SIGNER_PRIVATE_KEY!.replace(/^0x/, '')}`,
      publicKey: toHex(payerPublicKey),
      address: payerAddress,
      rpcUrl: FAST_TEST_RPC_URL!,
    };

    // ── Derive recipient address ──
    const recipientSigner = new Signer(process.env.FAST_TEST_RECIPIENT_PRIVATE_KEY!);
    const recipientPublicKey = await recipientSigner.getPublicKey();
    recipientAddress = toFastAddress(recipientPublicKey);
    expect(recipientAddress).not.toBe(payerAddress);

    // ── Start facilitator server ──
    const facilitatorConfig: FacilitatorConfig = {
      fastNetworks: {
        [NETWORK]: {
          rpcUrl: FAST_TEST_RPC_URL!,
          committeePublicKeys: process.env.FAST_TEST_COMMITTEE_PUBLIC_KEYS!.split(',').map((key) => key.trim()),
        },
      },
      debug: false,
    };

    const facilitatorApp = express();
    facilitatorApp.use(express.json());
    facilitatorApp.use(createFacilitatorServer(facilitatorConfig));

    const fResult = await listenOnRandomPort(facilitatorApp);
    facilitatorServer = fResult.server;
    facilitatorPort = fResult.port;

    // ── Start content server ──
    const contentApp = express();

    // Unprotected route
    contentApp.get('/free', (_req, res) => {
      res.json({ message: 'free content' });
    });

    // Protected route via x402 middleware
    contentApp.use(
      paymentMiddleware(
        { fast: recipientAddress },
        {
          'GET /premium': {
            price: PAYMENT_PRICE,
            network: NETWORK,
            networkConfig: {
              asset: FAST_TESTNET_USDC_TOKEN_ID,
              decimals: 6,
            },
          },
        },
        { url: `http://127.0.0.1:${facilitatorPort}` },
        { debug: false },
      ),
    );

    // Premium route handler (only reached after payment)
    contentApp.get('/premium', (_req, res) => {
      res.json({ message: 'premium content', secret: 42 });
    });

    const cResult = await listenOnRandomPort(contentApp);
    contentServer = cResult.server;
    contentPort = cResult.port;
  }, 30_000);

  afterAll(async () => {
    await Promise.all([contentServer && closeServer(contentServer), facilitatorServer && closeServer(facilitatorServer)]);
  });

  it('returns 200 for unprotected routes', async () => {
    const res = await fetch(`http://127.0.0.1:${contentPort}/free`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual({ message: 'free content' });
  });

  it('returns 402 with payment requirements for protected routes without payment', async () => {
    const res = await fetch(`http://127.0.0.1:${contentPort}/premium`);
    expect(res.status).toBe(402);

    const body = (await res.json()) as {
      error: string;
      accepts: Array<{
        scheme: string;
        network: string;
        maxAmountRequired: string;
        payTo: string;
        asset: string;
      }>;
    };
    expect(body.error).toBeTruthy();
    expect(body.accepts).toHaveLength(1);

    const req = body.accepts[0];
    expect(req.scheme).toBe('exact');
    expect(req.network).toBe(NETWORK);
    expect(req.payTo).toBe(recipientAddress);
    expect(req.asset).toBe(FAST_TESTNET_USDC_TOKEN_ID);
    expect(BigInt(req.maxAmountRequired)).toBe(1000n); // $0.001 = 1000 raw (6 decimals)
  });

  it('completes full payment flow via x402Pay', async () => {
    const result = await x402Pay({
      url: `http://127.0.0.1:${contentPort}/premium`,
      method: 'GET',
      wallet: fastWallet,
      verbose: true,
    });

    // Payment succeeded
    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(200);

    // Content delivered
    expect(result.body).toEqual({ message: 'premium content', secret: 42 });

    // Payment details
    expect(result.payment).toBeDefined();
    expect(result.payment!.network).toBe(NETWORK);
    expect(result.payment!.recipient).toBe(recipientAddress);
    expect(result.payment!.txHash).toBeTruthy();
    expect(typeof result.payment!.txHash).toBe('string');
    expect(result.payment!.amount).toBe('1000');
  }, 60_000);
});
