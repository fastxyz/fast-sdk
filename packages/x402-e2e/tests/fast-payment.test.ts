/**
 * x402 End-to-End Test — FAST Mainnet (standalone, not the matrix gate)
 *
 * Spins up a facilitator server and a content server in-process,
 * then uses x402Pay() to exercise the full 402 payment flow
 * against FAST mainnet using real fastUSD.
 *
 * Requires X402_LIVE_FAST=1, X402_MAINNET_SPENDING=1 and external credentials.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { Signer, toFastAddress, toHex } from '@fastxyz/sdk';
import { mainnet } from '@fastxyz/sdk/networks';
import { createFacilitatorServer } from '@fastxyz/x402-facilitator';
import { paymentMiddleware } from '@fastxyz/x402-server';
import { x402Pay } from '@fastxyz/x402-client';
import type { FacilitatorConfig } from '@fastxyz/x402-facilitator';

// ─── Config ──────────────────────────────────────────────────────────────────

const FAST_MAINNET_RPC_URL = process.env.FAST_MAINNET_RPC_URL;
const FAST_MAINNET_SIGNER_PRIVATE_KEY = process.env.FAST_MAINNET_SIGNER_PRIVATE_KEY;

const FAST_MAINNET_TOKEN_ID = mainnet.defaultToken.tokenId;
const PAYMENT_PRICE = '$0.001';
const NETWORK = 'fast-mainnet';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function listenOnRandomPort(app: express.Express): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
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
if (!skip && process.env.X402_MAINNET_SPENDING !== '1') {
  throw new Error('X402_MAINNET_SPENDING=1 is required to authorize real mainnet spending');
}
if (!skip && (!FAST_MAINNET_RPC_URL || !FAST_MAINNET_SIGNER_PRIVATE_KEY || !process.env.FAST_MAINNET_RECIPIENT_PRIVATE_KEY)) {
  throw new Error('Explicit live Fast opt-in requires RPC, payer and controlled recipient key');
}
if (!skip && (FAST_MAINNET_RPC_URL !== mainnet.url || process.env.X402_CONTROLLED_RECIPIENTS !== '1')) {
  throw new Error('Live Fast requires pinned mainnet RPC and controlled recipient confirmation');
}

describe.skipIf(skip)('x402 E2E — FAST mainnet standalone payment flow', () => {
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
    const payerSigner = new Signer(FAST_MAINNET_SIGNER_PRIVATE_KEY!);
    const payerPublicKey = await payerSigner.getPublicKey();
    const payerAddress = toFastAddress(payerPublicKey);

    fastWallet = {
      type: 'fast',
      privateKey: `0x${FAST_MAINNET_SIGNER_PRIVATE_KEY!.replace(/^0x/, '')}`,
      publicKey: toHex(payerPublicKey),
      address: payerAddress,
      rpcUrl: FAST_MAINNET_RPC_URL!,
    };

    // ── Derive recipient address ──
    const recipientSigner = new Signer(process.env.FAST_MAINNET_RECIPIENT_PRIVATE_KEY!);
    const recipientPublicKey = await recipientSigner.getPublicKey();
    recipientAddress = toFastAddress(recipientPublicKey);
    expect(recipientAddress).not.toBe(payerAddress);

    // ── Start facilitator server ──
    const facilitatorConfig: FacilitatorConfig = {
      fastNetworks: {
        [NETWORK]: {
          rpcUrl: FAST_MAINNET_RPC_URL!,
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
              asset: FAST_MAINNET_TOKEN_ID,
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
    expect(req.asset).toBe(FAST_MAINNET_TOKEN_ID);
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
