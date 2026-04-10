/**
 * @fastxyz/x402-client
 *
 * Client SDK for x402 HTTP payment protocol.
 * Handles 402 Payment Required responses by signing and paying for content.
 *
 * Supports:
 * - Fast networks (via wallet.rpcUrl)
 * - EVM networks with EIP-3009 (via evmNetworks config)
 * - Auto-bridge from Fast → EVM when EVM balance is insufficient
 */

export * from './types.js';
export { bridgeFastusdcToUsdc, getFastBalance } from './bridge.js';
export { handleFastPayment, stringifyPaymentPayload } from './fast.js';
export { handleEvmPayment } from './evm.js';

import { getNetworkType } from '@fastxyz/x402-types';
import type { EvmChainConfig } from '@fastxyz/x402-types';

import type { X402PayParams, X402PayResult, PaymentRequired, ClientPaymentRequirement, Wallet, FastWallet, EvmWallet } from './types.js';

import { handleFastPayment, stringifyPaymentPayload } from './fast.js';
import { handleEvmPayment } from './evm.js';

// ─── Wallet helpers ───────────────────────────────────────────────────────────

function isFastWallet(wallet: Wallet): wallet is FastWallet {
  return wallet.type === 'fast';
}

function isEvmWallet(wallet: Wallet): wallet is EvmWallet {
  return wallet.type === 'evm';
}

// ─── Main Entry ───────────────────────────────────────────────────────────────

/**
 * Pay for x402-protected content.
 *
 * 1. Makes initial request to get payment requirements
 * 2. Creates and signs payment (TokenTransfer on Fast, EIP-3009 on EVM)
 * 3. If EVM balance is insufficient and Fast wallet is provided, auto-bridges via AllSet
 * 4. Retries the request with X-PAYMENT header
 */
export async function x402Pay(params: X402PayParams): Promise<X402PayResult> {
  const { url, method = 'GET', headers: customHeaders = {}, body: requestBody, wallet, evmNetworks, bridgeConfig, verbose = false } = params;

  const logs: string[] = [];
  const log = (msg: string) => {
    if (verbose) {
      logs.push(`[${new Date().toISOString()}] ${msg}`);
      logs.push('');
    }
  };

  const wallets = Array.isArray(wallet) ? wallet : [wallet];
  const fastWallet = wallets.find(isFastWallet);
  const evmWallet = wallets.find(isEvmWallet);

  log(`━━━ x402Pay START ━━━`);
  log(`URL: ${url}`);
  log(`Method: ${method}`);
  log(`Wallets: Fast=${fastWallet ? 'yes' : 'no'}, EVM=${evmWallet ? 'yes' : 'no'}`);

  // Step 1: Initial request
  log(`[Step 1] Making initial request...`);
  const initialRes = await fetch(url, {
    method,
    headers: customHeaders,
    body: requestBody,
  });
  log(`  Response: ${initialRes.status} ${initialRes.statusText}`);

  if (initialRes.status !== 402) {
    log(`  Not a 402 response, returning as-is`);
    const resHeaders: Record<string, string> = {};
    initialRes.headers.forEach((v: string, k: string) => {
      resHeaders[k] = v;
    });

    let resBody: unknown;
    try {
      resBody = await initialRes.json();
    } catch {
      resBody = await initialRes.text();
    }

    log(`━━━ x402Pay END (no payment needed) ━━━`);
    return {
      success: initialRes.ok,
      statusCode: initialRes.status,
      headers: resHeaders,
      body: resBody,
      note: initialRes.ok ? 'Request succeeded without payment.' : `Request failed with status ${initialRes.status}.`,
      logs: verbose ? logs : undefined,
    };
  }

  // Step 2: Parse 402 response
  log(`[Step 2] Parsing 402 payment requirements...`);
  const paymentRequired = (await initialRes.json()) as PaymentRequired;
  log(`  Payment Required: ${JSON.stringify(paymentRequired, null, 2)}`);

  if (!paymentRequired.accepts || paymentRequired.accepts.length === 0) {
    throw new Error('No payment requirements in 402 response');
  }

  // Step 3: Match network to wallet
  log(`[Step 3] Matching network to wallet...`);
  const accepts = paymentRequired.accepts as ClientPaymentRequirement[];
  const availableNetworks = accepts.map((r) => r.network);
  log(`  Available networks: ${availableNetworks.join(', ')}`);

  const fastReq = accepts.find((r) => getNetworkType(r.network) === 'fast');
  const evmReq = accepts.find((r) => getNetworkType(r.network) === 'evm');

  log(`  Fast match: ${fastReq?.network ?? 'none'}`);
  log(`  EVM match: ${evmReq?.network ?? 'none'}`);

  // Prioritize Fast (faster, cheaper)
  if (fastReq && fastWallet) {
    log(`  → Using Fast payment path`);
    return handleFastPayment(url, method, customHeaders, requestBody, paymentRequired, fastReq, fastWallet, verbose, logs);
  }

  if (evmReq && evmWallet) {
    log(`  → Using EVM payment path`);

    const chainConfig = evmNetworks?.[evmReq.network];
    if (!chainConfig) {
      throw new Error(`No EVM chain config for network "${evmReq.network}". ` + `Provide it via evmNetworks in X402PayParams.`);
    }

    return handleEvmPayment(
      url,
      method,
      customHeaders,
      requestBody,
      paymentRequired,
      evmReq,
      evmWallet,
      chainConfig,
      verbose,
      logs,
      fastWallet,
      bridgeConfig,
    );
  }

  // No matching wallet
  const supported = [];
  if (fastReq) supported.push(`Fast (${fastReq.network}) - needs FastWallet`);
  if (evmReq) supported.push(`EVM (${evmReq.network}) - needs EvmWallet`);

  throw new Error(
    `No matching wallet for available networks.\n` + `Server accepts: ${availableNetworks.join(', ')}\n` + `You need: ${supported.join(' or ')}`,
  );
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Parse a 402 response to extract payment requirements.
 */
export async function parse402Response(response: Response): Promise<PaymentRequired> {
  if (response.status !== 402) {
    throw new Error(`Expected 402 response, got ${response.status}`);
  }
  return response.json() as Promise<PaymentRequired>;
}

/**
 * Build an X-PAYMENT header value (for manual payment flows).
 */
export function buildPaymentHeader(payload: unknown): string {
  return Buffer.from(stringifyPaymentPayload(payload)).toString('base64');
}

/**
 * Parse an X-PAYMENT header value.
 */
export function parsePaymentHeader(header: string): unknown {
  return JSON.parse(Buffer.from(header, 'base64').toString('utf-8'));
}
