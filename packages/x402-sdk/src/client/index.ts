/**
 * x402-client
 * 
 * Client SDK for x402 HTTP payment protocol.
 * Handles 402 Payment Required responses by signing and paying for content.
 * 
 * Supports:
 * - Fast networks (fast-testnet, fast-mainnet)
 * - EVM networks with EIP-3009 (arbitrum-sepolia, base-sepolia, etc.)
 * - Auto-bridge from Fast → EVM when EVM balance is insufficient
 */

export * from './types.js';

import type { 
  X402PayParams, 
  X402PayResult, 
  PaymentRequired, 
  Wallet,
  FastWallet,
  EvmWallet,
} from './types.js';

import { handleFastPayment, FAST_NETWORKS } from './fast.js';
import { handleEvmPayment, EVM_NETWORKS } from './evm.js';
import { stringifyPaymentPayload } from './fast.js';

export { FAST_NETWORKS, EVM_NETWORKS };

// Re-export bridge utilities for manual use
export { 
  bridgeFastusdcToUsdc, 
  getFastBalance,
  getBridgeConfig,
} from './bridge.js';

/**
 * Check if wallet is Fast type
 */
function isFastWallet(wallet: Wallet): wallet is FastWallet {
  return wallet.type === 'fast';
}

/**
 * Check if wallet is EVM type
 */
function isEvmWallet(wallet: Wallet): wallet is EvmWallet {
  return wallet.type === 'evm';
}

/**
 * Pay for x402-protected content.
 * 
 * Automatically handles 402 Payment Required responses by:
 * 1. Making initial request to get payment requirements
 * 2. Creating and signing payment (TokenTransfer on Fast, EIP-3009 on EVM)
 * 3. If EVM balance is insufficient and Fast wallet is provided, auto-bridges via AllSet
 * 4. Retrying the request with X-PAYMENT header
 */
export async function x402Pay(params: X402PayParams): Promise<X402PayResult> {
  const { 
    url, 
    method = 'GET', 
    headers: customHeaders = {}, 
    body: requestBody, 
    wallet,
    verbose = false,
  } = params;

  const logs: string[] = [];
  const log = (msg: string) => { 
    if (verbose) { 
      logs.push(`[${new Date().toISOString()}] ${msg}`); 
      logs.push(''); 
    } 
  };

  // Normalize wallets to array
  const wallets = Array.isArray(wallet) ? wallet : [wallet];
  const fastWallet = wallets.find(isFastWallet);
  const evmWallet = wallets.find(isEvmWallet);

  log(`━━━ x402Pay START ━━━`);
  log(`URL: ${url}`);
  log(`Method: ${method}`);
  log(`Wallets: Fast=${fastWallet ? 'yes' : 'no'}, EVM=${evmWallet ? 'yes' : 'no'}`);
  if (fastWallet && evmWallet) {
    log(`  → Auto-bridge enabled (both wallets provided)`);
  }

  // Step 1: Make initial request to get 402 response
  log(`[Step 1] Making initial request...`);
  const initialRes = await fetch(url, {
    method,
    headers: customHeaders,
    body: requestBody,
  });
  log(`  Response: ${initialRes.status} ${initialRes.statusText}`);

  // If not 402, return as-is
  if (initialRes.status !== 402) {
    log(`  Not a 402 response, returning as-is`);
    const resHeaders: Record<string, string> = {};
    initialRes.headers.forEach((v, k) => { resHeaders[k] = v; });
    
    let resBody: unknown;
    try { resBody = await initialRes.json(); } catch { resBody = await initialRes.text(); }

    log(`━━━ x402Pay END (no payment needed) ━━━`);
    return {
      success: initialRes.ok,
      statusCode: initialRes.status,
      headers: resHeaders,
      body: resBody,
      note: initialRes.ok 
        ? 'Request succeeded without payment.' 
        : `Request failed with status ${initialRes.status}.`,
      logs: verbose ? logs : undefined,
    };
  }

  // Step 2: Parse 402 response
  log(`[Step 2] Parsing 402 payment requirements...`);
  const paymentRequired = await initialRes.json() as PaymentRequired;
  log(`  Payment Required: ${JSON.stringify(paymentRequired, null, 2)}`);

  if (!paymentRequired.accepts || paymentRequired.accepts.length === 0) {
    throw new Error('No payment requirements in 402 response');
  }

  // Step 3: Find matching network and wallet
  log(`[Step 3] Matching network to wallet...`);
  const availableNetworks = paymentRequired.accepts.map(r => r.network);
  log(`  Available networks: ${availableNetworks.join(', ')}`);

  const fastReq = paymentRequired.accepts.find(r => FAST_NETWORKS.includes(r.network));
  const evmReq = paymentRequired.accepts.find(r => EVM_NETWORKS.includes(r.network));

  log(`  Fast match: ${fastReq?.network ?? 'none'}`);
  log(`  EVM match: ${evmReq?.network ?? 'none'}`);

  // Prioritize Fast (faster, cheaper), then EVM
  if (fastReq && fastWallet) {
    log(`  → Using Fast payment path`);
    return handleFastPayment(
      url, method, customHeaders, requestBody,
      paymentRequired, fastReq, fastWallet,
      verbose, logs
    );
  }

  if (evmReq && evmWallet) {
    log(`  → Using EVM payment path`);
    // Pass Fast wallet for auto-bridge if available
    return handleEvmPayment(
      url, method, customHeaders, requestBody,
      paymentRequired, evmReq, evmWallet,
      verbose, logs,
      fastWallet  // Enable auto-bridge if provided
    );
  }

  // No matching wallet
  const supportedNetworks = [];
  if (fastReq) supportedNetworks.push(`Fast (${fastReq.network}) - needs FastWallet`);
  if (evmReq) supportedNetworks.push(`EVM (${evmReq.network}) - needs EvmWallet`);

  throw new Error(
    `No matching wallet for available networks.\n` +
    `Server accepts: ${availableNetworks.join(', ')}\n` +
    `You need: ${supportedNetworks.join(' or ')}`
  );
}

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
