import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  LatestFromRelease20260319,
  LatestFromRelease20260407,
  LatestFromVersionedTransaction,
  VersionBridges,
} from '../../../src/composite/latest-bridges.ts';
import { SupportedTransactionVersions } from '../../../src/base/internal.ts';

// ---------------------------------------------------------------------------
// Wire-format fixture builders (BCS encoded form)
//
// BCS palette:
//   - Addresses, TokenIds, etc.: number[] (32 elements)
//   - nonce / timestamp_nanos: number | bigint | string (→ bigint on decode)
//   - network_id: string
//   - Operations: TypedVariant BCS form { Key: value } or { Key: [] } for units
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

// ---------------------------------------------------------------------------
// Helpers to obtain properly decoded LatestTransaction values (for encode tests)
//
// Schema.encodeSync validates the input against LatestTransaction.Type, which
// includes branding (Amount, Address, etc.). To get a valid branded value we
// first decode a wire-format 20260407 transaction, then use the result as the
// encode input. This ensures all brands are applied.
// ---------------------------------------------------------------------------

/** Decode a wire 20260407 tx into a canonical LatestTransaction value. */
const decodeLatest = (wireOps: unknown[]) =>
  Schema.decodeUnknownSync(LatestFromRelease20260407)(
    wireRelease407Tx(wireOps) as never,
  );

/**
 * Minimal valid BCS wire form for an Escrow/Reject operation.
 * Reject is the simplest Escrow sub-variant: just a job_id (TokenId = 32 bytes).
 */
const wireEscrowReject = () => ({
  Escrow: { Reject: { job_id: NUM_TOKEN_ID } },
});

// ---------------------------------------------------------------------------
// LatestFromRelease20260319 — upcast (decode)
// ---------------------------------------------------------------------------

describe('LatestFromRelease20260319 — upcast (decode)', () => {
  it('upcasts a single-op claim into a one-element claims array', () => {
    const latest = Schema.decodeUnknownSync(LatestFromRelease20260319)(
      wireRelease319Tx(wireTokenTransfer()) as never,
    );
    expect(latest.claims).toHaveLength(1);
    expect(latest.claims[0].type).toBe('TokenTransfer');
  });

  it('upcasts a unit-variant (LeaveCommittee) claim into a one-element claims array', () => {
    const latest = Schema.decodeUnknownSync(LatestFromRelease20260319)(
      wireRelease319Tx(wireLeaveCommittee()) as never,
    );
    expect(latest.claims).toHaveLength(1);
    expect(latest.claims[0].type).toBe('LeaveCommittee');
  });

  it('upcasts a Batch claim into a flat claims array', () => {
    const wireBatch = {
      Batch: [wireTokenTransfer(), wireTokenTransfer()],
    };
    const latest = Schema.decodeUnknownSync(LatestFromRelease20260319)(
      wireRelease319Tx(wireBatch) as never,
    );
    expect(latest.claims).toHaveLength(2);
    expect(latest.claims[0].type).toBe('TokenTransfer');
    expect(latest.claims[1].type).toBe('TokenTransfer');
  });

  it('REJECTS an empty Batch claim on decode (symmetric with encode rejection of empty claims)', () => {
    const wireBatch = { Batch: [] };
    expect(() =>
      Schema.decodeUnknownSync(LatestFromRelease20260319)(
        wireRelease319Tx(wireBatch) as never,
      ),
    ).toThrow(/empty Batch/i);
  });
});

// ---------------------------------------------------------------------------
// LatestFromRelease20260319 — downcast (encode)
//
// For encode tests we need a valid LatestTransaction.Type value (with branded
// types). We obtain it by first decoding through the 20260407 bridge (which is
// an identity passthrough), so all brands are correctly applied.
// ---------------------------------------------------------------------------

/**
 * Typed view of a BCS-encoded Release20260319 transaction (wire form).
 * `claim` is a BCS TypedVariant wire object; `claims` is absent (undefined).
 */
interface Wire319Tx {
  readonly network_id: unknown;
  readonly sender: unknown;
  readonly nonce: unknown;
  readonly timestamp_nanos: unknown;
  readonly claim: Record<string, unknown>;
  readonly claims: undefined;
  readonly archival: unknown;
  readonly fee_token: unknown;
}

/** Typed view of a BCS-encoded Release20260407 / canonical transaction (wire form). */
interface Wire407Tx {
  readonly claims: readonly unknown[];
}

describe('LatestFromRelease20260319 — downcast (encode)', () => {
  it('downcasts a single-op claims array into a bare claim', () => {
    const latest = decodeLatest([wireTokenTransfer()]);
    const release319 = Schema.encodeSync(LatestFromRelease20260319)(latest) as Wire319Tx;
    // BCS variant key is 'TokenTransfer'
    const claimVariant = Object.keys(release319.claim)[0];
    expect(claimVariant).toBe('TokenTransfer');
    expect(release319.claims).toBeUndefined();
  });

  it('downcasts a unit-variant single-op claims array into a bare claim', () => {
    const latest = decodeLatest([wireLeaveCommittee()]);
    const release319 = Schema.encodeSync(LatestFromRelease20260319)(latest) as Wire319Tx;
    // BCS unit variant encodes as { LeaveCommittee: [] }
    expect(release319.claim).toHaveProperty('LeaveCommittee');
    expect(release319.claims).toBeUndefined();
  });

  it('downcasts a multi-op claims array into a Batch claim', () => {
    const latest = decodeLatest([wireTokenTransfer(), wireLeaveCommittee()]);
    const release319 = Schema.encodeSync(LatestFromRelease20260319)(latest) as Wire319Tx;
    const batch = release319.claim.Batch;
    expect(batch).toBeDefined();
    expect(batch).toHaveLength(2);
    expect(release319.claims).toBeUndefined();
  });

  it('REJECTS canonical with an Escrow op (not supported by 20260319)', () => {
    // Decode a valid 407 tx that contains an Escrow op, then try to encode it
    // through the 319 bridge — our capability check must fire.
    const latest = decodeLatest([wireEscrowReject()]);
    expect(() =>
      Schema.encodeSync(LatestFromRelease20260319)(latest),
    ).toThrow(/Escrow.*not supported.*Release20260319/i);
  });

  it('REJECTS canonical with empty claims', () => {
    // Decode a valid 407 tx with no claims, then encode through 319 bridge.
    const latest = decodeLatest([]);
    expect(() =>
      Schema.encodeSync(LatestFromRelease20260319)(latest),
    ).toThrow(/at least one operation/i);
  });

  it('round-trips for a single TokenTransfer (decode → encode → decode)', () => {
    // Decode 319 wire → canonical
    const decoded = Schema.decodeUnknownSync(LatestFromRelease20260319)(
      wireRelease319Tx(wireTokenTransfer()) as never,
    );
    expect(decoded.claims).toHaveLength(1);
    expect(decoded.claims[0].type).toBe('TokenTransfer');

    // Encode canonical → 319 wire
    const encoded = Schema.encodeSync(LatestFromRelease20260319)(decoded);

    // Decode again → canonical
    const reDecoded = Schema.decodeUnknownSync(LatestFromRelease20260319)(encoded);
    expect(reDecoded.claims).toHaveLength(1);
    expect(reDecoded.claims[0].type).toBe('TokenTransfer');
  });

  it('round-trips for a multi-op Batch (decode → encode → decode)', () => {
    const wireBatch = {
      Batch: [wireTokenTransfer(), wireLeaveCommittee()],
    };
    const decoded = Schema.decodeUnknownSync(LatestFromRelease20260319)(
      wireRelease319Tx(wireBatch) as never,
    );
    expect(decoded.claims).toHaveLength(2);

    const encoded = Schema.encodeSync(LatestFromRelease20260319)(decoded);
    const reDecoded = Schema.decodeUnknownSync(LatestFromRelease20260319)(encoded);
    expect(reDecoded.claims).toHaveLength(2);
    expect(reDecoded.claims[0].type).toBe('TokenTransfer');
    expect(reDecoded.claims[1].type).toBe('LeaveCommittee');
  });
});

// ---------------------------------------------------------------------------
// LatestFromRelease20260407 — identity passthrough
// ---------------------------------------------------------------------------

describe('LatestFromRelease20260407 — identity passthrough', () => {
  it('decodes a single-op transaction from wire format', () => {
    const latest = Schema.decodeUnknownSync(LatestFromRelease20260407)(
      wireRelease407Tx([wireTokenTransfer()]) as never,
    );
    expect(latest.claims).toHaveLength(1);
    expect(latest.claims[0].type).toBe('TokenTransfer');
  });

  it('encodes a canonical transaction back to wire format', () => {
    const decoded = decodeLatest([wireTokenTransfer()]);
    const encoded = Schema.encodeSync(LatestFromRelease20260407)(decoded) as Wire407Tx;
    expect(encoded.claims).toHaveLength(1);
  });

  it('full encode → decode round-trip for a single TokenTransfer', () => {
    const decoded = decodeLatest([wireTokenTransfer()]);
    const encoded = Schema.encodeSync(LatestFromRelease20260407)(decoded);
    const reDecoded = Schema.decodeUnknownSync(LatestFromRelease20260407)(encoded);
    expect(reDecoded.claims).toHaveLength(1);
    expect(reDecoded.claims[0].type).toBe('TokenTransfer');
  });

  it('accepts Escrow ops without capability error (20260407 supports Escrow)', () => {
    // Decode a valid 407 tx with an Escrow op, then round-trip through the
    // 407 bridge — the capability check must NOT throw.
    const latest = decodeLatest([wireEscrowReject()]);
    expect(() =>
      Schema.encodeSync(LatestFromRelease20260407)(latest),
    ).not.toThrow();
  });

  it('accepts empty claims array (20260407 has no min-length restriction)', () => {
    // A 407 tx with no claims encodes fine through the 407 bridge.
    const latest = decodeLatest([]);
    expect(() =>
      Schema.encodeSync(LatestFromRelease20260407)(latest),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// VersionBridges record
// ---------------------------------------------------------------------------

describe('VersionBridges record', () => {
  it('has an entry for every supported transaction version', () => {
    const bridgeKeys = Object.keys(VersionBridges).sort();
    const supported = [...SupportedTransactionVersions].sort();
    expect(bridgeKeys).toEqual(supported);
  });

  it('Release20260319 entry includes correct supportedOperations', () => {
    expect([...VersionBridges.Release20260319.supportedOperations]).toContain('TokenTransfer');
    expect([...VersionBridges.Release20260319.supportedOperations]).not.toContain('Escrow');
  });

  it('Release20260407 entry includes Escrow', () => {
    expect([...VersionBridges.Release20260407.supportedOperations]).toContain('Escrow');
  });
});

// ---------------------------------------------------------------------------
// LatestFromVersionedTransaction — auto-dispatch decoder
// ---------------------------------------------------------------------------

describe('LatestFromVersionedTransaction — auto-dispatch decoder', () => {
  it('decodes a Release20260319-tagged transaction via the 20260319 bridge', () => {
    const release319WireWrapped = {
      Release20260319: wireRelease319Tx(wireTokenTransfer()),
    };
    const latest = Schema.decodeUnknownSync(LatestFromVersionedTransaction)(
      release319WireWrapped as never,
    );
    expect(latest.claims).toHaveLength(1);
  });

  it('decodes a Release20260407-tagged transaction via the 20260407 bridge', () => {
    const release407WireWrapped = {
      Release20260407: wireRelease407Tx([wireTokenTransfer()]),
    };
    const latest = Schema.decodeUnknownSync(LatestFromVersionedTransaction)(
      release407WireWrapped as never,
    );
    expect(latest.claims).toHaveLength(1);
  });

  it('refuses to encode (must use encodeAsVersion)', () => {
    const release407WireWrapped = {
      Release20260407: wireRelease407Tx([wireTokenTransfer()]),
    };
    const latest = Schema.decodeUnknownSync(LatestFromVersionedTransaction)(
      release407WireWrapped as never,
    );
    expect(() =>
      Schema.encodeSync(LatestFromVersionedTransaction)(latest as never),
    ).toThrow(/encodeAsVersion/i);
  });
});
