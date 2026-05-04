import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import { encodeAsVersion } from '../../../src/interface/encode-as-version.ts';
import {
  LatestFromVersionedTransaction,
  LatestFromRelease20260319,
  LatestFromRelease20260407,
} from '../../../src/composite/latest-bridges.ts';

// ---------------------------------------------------------------------------
// Wire-format fixture builders (BCS encoded form)
// ---------------------------------------------------------------------------

const NUM_ADDR = Array.from({ length: 32 }, () => 1);  // 32 x 0x01
const NUM_TOKEN_ID = Array.from({ length: 32 }, () => 0x11);

/** Wire-format (BCS encoded) TokenTransfer operation. */
const wireTokenTransfer = () => ({
  TokenTransfer: {
    token_id: NUM_TOKEN_ID,
    recipient: NUM_ADDR,
    amount: 100n,
    user_data: null,
  },
});

/** Wire-format (BCS encoded) LeaveCommittee unit operation. */
const wireLeaveCommittee = () => ({ LeaveCommittee: [] as const });

/** Wire-format base for a Release20260319 transaction. */
const wireRelease319Tx = (claim: unknown) => ({
  network_id: 'fast:testnet',
  sender: NUM_ADDR,
  nonce: 0n,
  timestamp_nanos: 0n,
  claim,
  archival: false,
  fee_token: null,
});

/** Wire-format base for a Release20260407 / canonical transaction. */
const wireRelease407Tx = (claims: unknown[]) => ({
  network_id: 'fast:testnet',
  sender: NUM_ADDR,
  nonce: 0n,
  timestamp_nanos: 0n,
  claims,
  archival: false,
  fee_token: null,
});

/**
 * Minimal valid BCS wire form for an Escrow/Reject operation.
 * Reject is the simplest Escrow sub-variant: just a job_id (TokenId = 32 bytes).
 */
const wireEscrowReject = () => ({
  Escrow: { Reject: { job_id: NUM_TOKEN_ID } },
});

// ---------------------------------------------------------------------------
// Helpers to obtain properly decoded LatestTransaction values
// ---------------------------------------------------------------------------

/** Decode a versioned wire form into a canonical LatestTransaction value. */
const decodeLatest = (wireWrapped: unknown) =>
  Schema.decodeUnknownSync(LatestFromVersionedTransaction)(wireWrapped);

/** Decode a wire 20260407 tx into a canonical LatestTransaction value. */
const decodeLatest407 = (wireOps: unknown[]) =>
  Schema.decodeUnknownSync(LatestFromRelease20260407)(
    wireRelease407Tx(wireOps) as never,
  );

// ---------------------------------------------------------------------------
// encodeAsVersion function tests
// ---------------------------------------------------------------------------

describe('encodeAsVersion', () => {
  it('encodes a canonical TokenTransfer transaction as Release20260407', () => {
    const latest = decodeLatest407([wireTokenTransfer()]);
    const result = encodeAsVersion(latest, 'Release20260407');
    expect(result).toHaveProperty('Release20260407');
    expect(result.Release20260407).toBeDefined();
  });

  it('encodes a canonical TokenTransfer transaction as Release20260319 (downcast)', () => {
    const latest = decodeLatest407([wireTokenTransfer()]);
    const result = encodeAsVersion(latest, 'Release20260319');
    expect(result).toHaveProperty('Release20260319');
    expect(result.Release20260319).toBeDefined();
  });

  it('encodes a canonical multi-op transaction as Release20260319 (Batch)', () => {
    const latest = decodeLatest407([wireTokenTransfer(), wireLeaveCommittee()]);
    const result = encodeAsVersion(latest, 'Release20260319');
    expect(result).toHaveProperty('Release20260319');
    expect(result.Release20260319).toBeDefined();
  });

  it('REJECTS canonical with Escrow when target is Release20260319', () => {
    // Canonical has Escrow op; encodeAsVersion(latest, 'Release20260319') should throw
    const latest = decodeLatest407([wireEscrowReject()]);
    expect(() =>
      encodeAsVersion(latest, 'Release20260319'),
    ).toThrow(/Escrow.*not supported.*Release20260319/i);
  });

  it('ACCEPTS canonical with Escrow when target is Release20260407', () => {
    // Canonical has Escrow op; encodeAsVersion(latest, 'Release20260407') should NOT throw
    const latest = decodeLatest407([wireEscrowReject()]);
    expect(() =>
      encodeAsVersion(latest, 'Release20260407'),
    ).not.toThrow();
  });

  it('produces output shaped { Release20260319: <wire> } for 319 target', () => {
    const latest = decodeLatest407([wireTokenTransfer()]);
    const result = encodeAsVersion(latest, 'Release20260319');
    const keys = Object.keys(result);
    expect(keys).toEqual(['Release20260319']);
  });

  it('produces output shaped { Release20260407: <wire> } for 407 target', () => {
    const latest = decodeLatest407([wireTokenTransfer()]);
    const result = encodeAsVersion(latest, 'Release20260407');
    const keys = Object.keys(result);
    expect(keys).toEqual(['Release20260407']);
  });

  it('round-trips through decodeLatest when encoding back as source version', () => {
    // Decode a 319 wire, upcast to canonical, encode back as 319
    const wire319 = {
      Release20260319: wireRelease319Tx(wireTokenTransfer()) as never,
    };
    const latest = decodeLatest(wire319);
    const encoded = encodeAsVersion(latest, 'Release20260319');
    expect(encoded).toHaveProperty('Release20260319');
    // The inner wire should be the Release20260319 wire form (with 'claim' field)
    const innerWire = encoded.Release20260319 as Record<string, unknown>;
    expect(innerWire).toHaveProperty('claim');
    expect(innerWire).not.toHaveProperty('claims');
  });

  it('round-trips through decodeLatest when encoding canonical as 407', () => {
    const wire407 = {
      Release20260407: wireRelease407Tx([wireTokenTransfer()]) as never,
    };
    const latest = decodeLatest(wire407);
    const encoded = encodeAsVersion(latest, 'Release20260407');
    expect(encoded).toHaveProperty('Release20260407');
    // The inner wire should be the Release20260407 wire form (with 'claims' array)
    const innerWire = encoded.Release20260407 as Record<string, unknown>;
    expect(innerWire).toHaveProperty('claims');
    expect(Array.isArray(innerWire.claims)).toBe(true);
  });

  it('handles empty claims array when target is Release20260407', () => {
    const latest = decodeLatest407([]);
    const result = encodeAsVersion(latest, 'Release20260407');
    expect(result).toHaveProperty('Release20260407');
  });

  it('REJECTS empty claims array when target is Release20260319', () => {
    const latest = decodeLatest407([]);
    expect(() =>
      encodeAsVersion(latest, 'Release20260319'),
    ).toThrow(/at least one operation/i);
  });
});
