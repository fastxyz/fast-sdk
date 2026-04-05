/**
 * relay.ts — Standalone relayer submission for AllSet bridge
 *
 * Extracted from the bridge execution flow so Portal and other consumers
 * can call the relayer independently (e.g. for step-by-step UI, retry, revoke).
 */

import { FastError } from './errors.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Parameters for submitting a relay request to the AllSet relayer.
 */
export interface RelayParams {
  /** AllSet relayer URL for the destination EVM chain */
  relayerUrl: string;
  /** Cross-signed transfer claim bytes (from evmSign result) */
  encodedTransferClaim: number[];
  /** EVM signature proof for the transfer claim */
  transferProof: string;
  /** Fast network transaction ID for the transfer */
  transferFastTxId: string;
  /** Fast network sender address (fast1...) */
  fastsetAddress: string;
  /** EVM recipient/target address (0x...) */
  externalAddress: string;
  /** Cross-signed intent claim bytes (from evmSign result) */
  encodedIntentClaim?: number[];
  /** EVM signature proof for the intent claim */
  intentProof?: string;
  /** Fast network transaction ID for the intent */
  intentFastTxId?: string;
  /** Claim ID for the intent (may differ from intentFastTxId) */
  intentClaimId?: string;
  /** Token contract address on the destination EVM chain */
  externalTokenAddress?: string;
}

/**
 * Result from a successful relay submission.
 */
export interface RelayResult {
  /** Whether the relayer accepted the request */
  success: boolean;
}

// ---------------------------------------------------------------------------
// relayExecute
// ---------------------------------------------------------------------------

/**
 * Submit a relay request to the AllSet relayer service.
 *
 * The relayer executes the bridged operation on the destination EVM chain
 * (e.g. ERC-20 transfer, contract call, deposit back, or revoke).
 *
 * @example
 * ```ts
 * await relayExecute({
 *   relayerUrl: 'https://relayer.allset.xyz',
 *   encodedTransferClaim: Array.from(transferCrossSign.transaction),
 *   transferProof: transferCrossSign.signature,
 *   transferFastTxId: '0x...',
 *   fastsetAddress: 'fast1...',
 *   externalAddress: '0xRecipient...',
 *   encodedIntentClaim: Array.from(intentCrossSign.transaction),
 *   intentProof: intentCrossSign.signature,
 *   intentFastTxId: '0x...',
 *   externalTokenAddress: '0xToken...',
 * });
 * ```
 */
export async function relayExecute(params: RelayParams): Promise<RelayResult> {
  const {
    relayerUrl,
    encodedTransferClaim,
    transferProof,
    transferFastTxId,
    fastsetAddress,
    externalAddress,
    encodedIntentClaim,
    intentProof,
    intentFastTxId,
    intentClaimId,
    externalTokenAddress,
  } = params;

  const body: Record<string, unknown> = {
    encoded_transfer_claim: encodedTransferClaim,
    transfer_proof: transferProof,
    transfer_fast_tx_id: transferFastTxId,
    transfer_claim_id: transferFastTxId,
    fastset_address: fastsetAddress,
    external_address: externalAddress,
  };

  if (encodedIntentClaim && intentProof) {
    body.encoded_intent_claim = encodedIntentClaim;
    body.intent_proof = intentProof;
  }

  if (intentFastTxId) {
    body.intent_fast_tx_id = intentFastTxId;
  }

  if (intentClaimId) {
    body.intent_claim_id = intentClaimId;
  }

  if (externalTokenAddress) {
    body.external_token_address = externalTokenAddress;
  }

  const relayRes = await fetch(`${relayerUrl.replace(/\/$/, '')}/relay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!relayRes.ok) {
    const text = await relayRes.text();
    throw new FastError('TX_FAILED', `Relayer request failed (${relayRes.status}): ${text}`, {
      note: 'The intent was submitted to Fast network but the relayer rejected it. Try again.',
    });
  }

  return { success: true };
}
