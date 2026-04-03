/**
 * claims.ts — Claim encoding and ID extraction for AllSet bridge
 *
 * Provides standalone functions for encoding TransferClaim and IntentClaim
 * structures, building intent claim bytes for submitClaim(), and extracting
 * claim IDs from cross-sign results.
 *
 * These were previously inlined in bridge.ts executeIntent().
 */

import { encodeAbiParameters, keccak256, type Hex } from 'viem';
import type { Intent } from './intents.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hexToUint8Array(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// ABI type definitions (reused across encoding functions)
// ---------------------------------------------------------------------------

const TRANSFER_CLAIM_ABI_PARAMS = [
  {
    type: 'tuple' as const,
    components: [
      { name: 'from', type: 'string' as const },
      { name: 'nonce', type: 'uint256' as const },
      { name: 'asset', type: 'string' as const },
      { name: 'amount', type: 'uint256' as const },
      { name: 'to', type: 'string' as const },
    ],
  },
] as const;

const INTENT_CLAIM_ABI_PARAMS = [
  {
    type: 'tuple' as const,
    components: [
      { name: 'transferFastTxId', type: 'bytes32' as const },
      { name: 'deadline', type: 'uint256' as const },
      {
        name: 'intents',
        type: 'tuple[]' as const,
        components: [
          { name: 'action', type: 'uint8' as const },
          { name: 'payload', type: 'bytes' as const },
          { name: 'value', type: 'uint256' as const },
        ],
      },
    ],
  },
] as const;

// ---------------------------------------------------------------------------
// TransferClaim encoding
// ---------------------------------------------------------------------------

export interface TransferClaimParams {
  /** Sender address (will be lowercased) */
  from: string;
  /** Transaction nonce */
  nonce: number | bigint;
  /** Asset identifier (e.g. token symbol or address) */
  asset: string;
  /** Amount in smallest units */
  amount: bigint;
  /** Recipient address */
  to: string;
}

/**
 * ABI-encode a TransferClaim struct.
 *
 * @returns ABI-encoded hex string
 */
export function encodeTransferClaim(params: TransferClaimParams): Hex {
  return encodeAbiParameters(TRANSFER_CLAIM_ABI_PARAMS, [
    {
      from: params.from.toLowerCase(),
      nonce: BigInt(params.nonce),
      asset: params.asset,
      amount: params.amount,
      to: params.to,
    },
  ]);
}

/**
 * Compute the keccak256 hash of a TransferClaim (used as claim ID in some flows).
 *
 * @returns 0x-prefixed keccak256 hash
 */
export function hashTransferClaim(params: TransferClaimParams): Hex {
  return keccak256(encodeTransferClaim(params));
}

// ---------------------------------------------------------------------------
// IntentClaim encoding
// ---------------------------------------------------------------------------

export interface IntentClaimParams {
  /** Transfer transaction ID (bytes32 hex) */
  transferFastTxId: string;
  /** Unix timestamp deadline */
  deadline: bigint;
  /** Array of intents to execute on EVM */
  intents: Intent[];
}

/**
 * ABI-encode an IntentClaim struct.
 *
 * @returns ABI-encoded hex string
 */
export function encodeIntentClaim(params: IntentClaimParams): Hex {
  return encodeAbiParameters(INTENT_CLAIM_ABI_PARAMS, [
    {
      transferFastTxId: params.transferFastTxId as Hex,
      deadline: params.deadline,
      intents: params.intents.map((i) => ({
        action: i.action,
        payload: i.payload,
        value: i.value,
      })),
    },
  ]);
}

/**
 * Build the intent claim bytes for use with `window.fastset.submitClaim()` or
 * `TransactionBuilder.addExternalClaim()`.
 *
 * This is a convenience function that constructs an IntentClaim with the given
 * parameters and returns it as a Uint8Array ready for submission.
 *
 * @param transferFastTxId - The transfer transaction ID (bytes32 hex from cross-sign)
 * @param intents - Array of intents to execute on EVM
 * @param deadline - Optional Unix timestamp deadline (defaults to 1 hour from now)
 * @returns Uint8Array of ABI-encoded IntentClaim
 *
 * @example
 * ```ts
 * const intentBytes = buildIntentClaimBytes({
 *   transferFastTxId: '0xabc...',
 *   intents: [buildTransferIntent(tokenAddr, receiverAddr)],
 * });
 *
 * // Use with browser wallet
 * await window.fastset.submitClaim({
 *   claimData: Array.from(intentBytes),
 *   recipient: bridgeAddress,
 *   account: currentAccount,
 * });
 * ```
 */
export function buildIntentClaimBytes(params: {
  transferFastTxId: string;
  intents: Intent[];
  deadline?: bigint;
}): Uint8Array {
  const deadline = params.deadline ?? BigInt(Math.floor(Date.now() / 1000) + 3600);
  const encoded = encodeIntentClaim({
    transferFastTxId: params.transferFastTxId,
    deadline,
    intents: params.intents,
  });
  return hexToUint8Array(encoded);
}

// ---------------------------------------------------------------------------
// Claim ID extraction
// ---------------------------------------------------------------------------

/**
 * Extract the claim ID (Fast transaction hash) from an evmSign cross-sign result.
 *
 * The cross-sign service returns transaction bytes where bytes[32:64] contain
 * the canonical Fast network transaction hash.
 *
 * @param crossSignTransaction - The `transaction` field from an `EvmSignResult`
 * @returns 0x-prefixed hex string of the claim ID
 *
 * @example
 * ```ts
 * const crossSign = await evmSign(certificate, crossSignUrl);
 * const claimId = extractClaimId(crossSign.transaction);
 * // claimId === '0xabc123...'
 * ```
 */
export function extractClaimId(crossSignTransaction: number[]): Hex {
  const bytes = new Uint8Array(crossSignTransaction.slice(32, 64));
  return `0x${Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')}` as Hex;
}
