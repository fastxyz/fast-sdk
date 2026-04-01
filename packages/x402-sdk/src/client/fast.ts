/**
 * Fast payment handler for x402
 *
 * Uses @fastxyz/fast-sdk's TransactionBuilder + FastProvider for Fast network operations.
 */

import { FastProvider, Signer, TransactionBuilder, hashHex } from '@fastxyz/fast-sdk';
import { fromHex, fromFastAddress, toFastAddress } from '@fastxyz/fast-sdk';
import { bcsSchema } from '@fastxyz/fast-schema';
import type {
  FastWallet,
  PaymentRequired,
  PaymentRequirement,
  X402PayResult,
} from './types.js';
import { resolveFastRpcUrl } from './fast-rpc.js';

export const FAST_NETWORKS = ['fast-testnet', 'fast-mainnet'];

// ─── Cached Providers ─────────────────────────────────────────────────────────

const fastProviders: Record<string, FastProvider> = {};

function getFastProvider(network: string, rpcUrl?: string): FastProvider {
  const cacheKey = rpcUrl || network;
  if (!fastProviders[cacheKey]) {
    const resolvedRpcUrl = rpcUrl || (network === 'fast-mainnet'
      ? 'https://api.fast.xyz/proxy'
      : 'https://testnet.api.fast.xyz/proxy');

    fastProviders[cacheKey] = new FastProvider({
      rpcUrl: resolvedRpcUrl,
    });
  }
  return fastProviders[cacheKey];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toHuman(rawAmount: string, decimals: number): string {
  return (Number(rawAmount) / Math.pow(10, decimals)).toString();
}

function serializeFastRpcJsonValue(value: unknown, quoteBigInt = false): string | undefined {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'bigint') {
    return quoteBigInt ? `"${value.toString()}"` : value.toString();
  }
  if (value instanceof Uint8Array) {
    return serializeFastRpcJsonValue(Array.from(value), quoteBigInt);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => serializeFastRpcJsonValue(item, quoteBigInt) ?? 'null').join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .flatMap(([key, entryValue]) => {
        const serialized = serializeFastRpcJsonValue(entryValue, quoteBigInt);
        return serialized === undefined ? [] : [`${JSON.stringify(key)}:${serialized}`];
      });
    return `{${entries.join(',')}}`;
  }
  return undefined;
}

function serializeX402Payload(data: unknown): string {
  const serialized = serializeFastRpcJsonValue(data, true);
  if (serialized === undefined) {
    throw new TypeError('x402 payload must be JSON-serializable');
  }
  return serialized;
}

/**
 * Resolve the Fast network ID used in signed transactions.
 */
function resolveNetworkId(network: string): string {
  return network === 'fast-mainnet' ? 'fast:mainnet' : 'fast:testnet';
}

/**
 * Handle x402 payment on Fast network.
 * Uses TransactionBuilder + Signer + FastProvider for token transfers.
 */
export async function handleFastPayment(
  url: string,
  method: string,
  customHeaders: Record<string, string>,
  requestBody: string | undefined,
  paymentRequired: PaymentRequired,
  fastReq: PaymentRequirement,
  wallet: FastWallet,
  verbose: boolean = false,
  logs: string[] = []
): Promise<X402PayResult> {
  const log = (msg: string) => {
    if (verbose) {
      logs.push(`[${new Date().toISOString()}] ${msg}`);
      logs.push('');
    }
  };

  log(`━━━ Fast Payment Handler START ━━━`);
  log(`  Network: ${fastReq.network}`);
  log(`  Amount: ${fastReq.maxAmountRequired} (raw)`);
  log(`  Recipient: ${fastReq.payTo}`);

  const rpcUrl = resolveFastRpcUrl(fastReq.network, wallet.rpcUrl);
  log(`  RPC: ${rpcUrl}`);
  log(`  Payer: ${wallet.address}`);

  // Get Fast provider
  log(`[Fast] Getting FastProvider...`);
  const provider = getFastProvider(fastReq.network, rpcUrl);

  // Create Signer from private key
  log(`[Fast] Creating Signer from private key...`);
  const signer = new Signer(wallet.privateKey);
  const publicKey = await signer.getPublicKey();
  const derivedAddress = toFastAddress(publicKey);
  log(`  Wallet address: ${derivedAddress}`);

  // Verify address matches
  if (derivedAddress !== wallet.address) {
    throw new Error(
      `Address mismatch: expected ${wallet.address}, got ${derivedAddress}`
    );
  }

  // Get account info for nonce
  log(`[Fast] Getting account info for nonce...`);
  const accountInfo = await provider.getAccountInfo({
    address: publicKey,
    tokenBalancesFilter: null,
    stateKeyFilter: null,
    certificateByNonce: null,
  });
  const nonce = accountInfo.nextNonce;
  log(`  Next nonce: ${nonce}`);

  // Determine token ID
  log(`[Fast] Determining token...`);
  let tokenId: Uint8Array;
  if (fastReq.asset) {
    const assetHex = fastReq.asset.startsWith('0x') ? fastReq.asset.slice(2) : fastReq.asset;
    tokenId = fromHex(assetHex);
    log(`  Token: ${fastReq.asset} (from payment requirement)`);
  } else {
    throw new Error('No token asset specified in payment requirement');
  }

  // Resolve recipient address to bytes
  const recipientBytes = fastReq.payTo.startsWith('fast1')
    ? fromFastAddress(fastReq.payTo)
    : fromHex(fastReq.payTo);

  // Build and sign transaction using TransactionBuilder
  const amountHuman = toHuman(fastReq.maxAmountRequired, 6);
  log(`[Fast] Building transaction via TransactionBuilder...`);
  log(`  Amount: ${fastReq.maxAmountRequired} raw → ${amountHuman} USDC`);
  const txStartTime = Date.now();

  const networkId = resolveNetworkId(fastReq.network) as 'fast:mainnet' | 'fast:testnet';
  const builder = new TransactionBuilder({
    networkId,
    signer,
    nonce,
  });

  builder.addTokenTransfer({
    tokenId,
    recipient: recipientBytes,
    amount: BigInt(fastReq.maxAmountRequired),
    userData: null,
  });

  const envelope = await builder.sign();

  // Submit the signed transaction
  log(`[Fast] Submitting transaction...`);
  const submitResult = await provider.submitTransaction(envelope);
  if (submitResult.type !== 'Success') {
    throw new Error(`Transaction submission failed: ${submitResult.type}`);
  }

  log(`  Transaction complete in ${Date.now() - txStartTime}ms`);

  // The submit result already contains the certificate
  const certificate = submitResult.value;

  // Derive a transaction hash from the certificate envelope
  // Convert TypedVariant format {type, value} to BCS enum input format {Release20260319: ...}
  const tx = certificate.envelope.transaction;
  const bcsInput = { [tx.type]: tx.value } as unknown as Parameters<typeof bcsSchema.VersionedTransaction.serialize>[0];
  const txHash = await hashHex(bcsSchema.VersionedTransaction, bcsInput);
  log(`  txHash: ${txHash}`);

  // Build x402 payment payload with the certificate
  log(`[Fast] Building x402 payment payload...`);
  const paymentPayload = {
    x402Version: paymentRequired.x402Version ?? 1,
    scheme: 'exact',
    network: fastReq.network,
    payload: {
      type: 'signAndSendTransaction',
      transactionCertificate: certificate,
    },
  };

  const payloadBase64 = Buffer.from(serializeX402Payload(paymentPayload)).toString('base64');
  log(`  Payload base64 length: ${payloadBase64.length}`);

  // Retry request with X-PAYMENT header
  log(`[Fast] Sending paid request with X-PAYMENT header...`);
  const paidRes = await fetch(url, {
    method,
    headers: { ...customHeaders, 'X-PAYMENT': payloadBase64 },
    body: requestBody,
  });
  log(`  Response: ${paidRes.status} ${paidRes.statusText}`);

  const resHeaders: Record<string, string> = {};
  paidRes.headers.forEach((v, k) => { resHeaders[k] = v; });

  let resBody: unknown;
  try { resBody = await paidRes.json(); } catch { resBody = await paidRes.text(); }

  log(`━━━ Fast Payment Handler END ━━━`);
  log(`  Success: ${paidRes.ok}`);
  log(`  Amount: ${amountHuman}`);

  return {
    success: paidRes.ok,
    statusCode: paidRes.status,
    headers: resHeaders,
    body: resBody,
    payment: {
      network: fastReq.network,
      amount: amountHuman,
      recipient: fastReq.payTo,
      txHash,
    },
    note: paidRes.ok
      ? `Fast payment of ${amountHuman} successful. Content delivered.`
      : `Payment submitted (tx: ${txHash}) but server returned ${paidRes.status}.`,
    logs: verbose ? logs : undefined,
  };
}
