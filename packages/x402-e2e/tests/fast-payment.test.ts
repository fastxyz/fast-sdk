/**
 * x402 End-to-End Test — Fast Testnet
 *
 * Spins up a facilitator server and a content server in-process,
 * then uses x402Pay() to exercise the full 402 payment flow
 * against the real Fast testnet.
 *
 * Requires .env at repo root with:
 *   FAST_TEST_RPC_URL=...
 *   FAST_TEST_SIGNER_PRIVATE_KEY=...
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { Signer, toFastAddress, toHex } from '@fastxyz/sdk';
import { createFacilitatorServer } from '@fastxyz/x402-facilitator';
import { paymentMiddleware } from '@fastxyz/x402-server';
import { x402Pay } from '@fastxyz/x402-client';
import type { FacilitatorConfig } from '@fastxyz/x402-facilitator';

// ─── Config ──────────────────────────────────────────────────────────────────

loadEnv({ path: resolve(import.meta.dirname, '../../..', '.env') });

const FAST_TEST_RPC_URL = process.env.FAST_TEST_RPC_URL;
const FAST_TEST_SIGNER_PRIVATE_KEY = process.env.FAST_TEST_SIGNER_PRIVATE_KEY;

const FAST_TESTNET_USDC_TOKEN_ID = '0xd73a0679a2be46981e2a8aedecd951c8b6690e7d5f8502b34ed3ff4cc2163b46';
const PAYMENT_PRICE = '$0.001';
const NETWORK = 'fast-testnet';

// Deterministic recipient — derived from a fixed seed (not the test wallet)
const RECIPIENT_SEED = '0101010101010101010101010101010101010101010101010101010101010101';

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

const skip = !FAST_TEST_RPC_URL || !FAST_TEST_SIGNER_PRIVATE_KEY;

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
      privateKey: `0x${FAST_TEST_SIGNER_PRIVATE_KEY!}`,
      publicKey: toHex(payerPublicKey),
      address: payerAddress,
      rpcUrl: FAST_TEST_RPC_URL!,
    };

    // ── Derive recipient address ──
    const recipientSigner = new Signer(RECIPIENT_SEED);
    const recipientPublicKey = await recipientSigner.getPublicKey();
    recipientAddress = toFastAddress(recipientPublicKey);

    // ── Start facilitator server ──
    const facilitatorConfig: FacilitatorConfig = {
      fastNetworks: {
        [NETWORK]: {
          rpcUrl: FAST_TEST_RPC_URL!,
          committeePublicKeys: [],
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
    await Promise.all([
      contentServer && closeServer(contentServer),
      facilitatorServer && closeServer(facilitatorServer),
    ]);
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

  it(
    'completes full payment flow via x402Pay',
    async () => {
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
      expect(result.payment!.amount).toBe('0.001');
    },
    60_000,
  );
});
