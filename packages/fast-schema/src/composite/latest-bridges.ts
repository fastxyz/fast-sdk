/**
 * Bidirectional bridges between per-release Transaction schemas and the
 * canonical LatestTransaction.
 *
 * Each `LatestFromRelease<XXX>` is a `Schema.transformOrFail` schema where:
 *   - decode (= upcast): release form → canonical. Always succeeds; older
 *     shapes are subsets of canonical.
 *   - encode (= downcast): canonical → release form. May fail when
 *     canonical contains operations the target version doesn't support
 *     or when the canonical violates a release-specific shape constraint.
 *
 * ## Effect Schema `transformOrFail` callback contract
 *
 * For `Schema.transformOrFail(A, B, { decode, encode })`:
 *   - `decode(a: A.Type) → B.Encoded` — Effect then runs `B.decode` to produce
 *     `B.Type`. The callback bridges A's decoded form to B's wire form.
 *   - `encode(b: B.Encoded) → A.Type` — Effect then runs `A.encode` to produce
 *     `A.Encoded`. The callback bridges B's wire form to A's decoded form.
 *
 * ## Shape difference between Release20260319 and Release20260407
 *
 * - Release20260319: `claim: ClaimType` — a TypedVariant with individual
 *   operation variants plus a `Batch` variant that wraps an array of ops.
 *   Wire (BCS): `{ TokenTransfer: { ... } }`, `{ Batch: [...] }`, etc.
 *   Decoded: `{ type: 'TokenTransfer', value: { ... } }`, `{ type: 'Batch', value: [...] }`.
 *
 * - Release20260407 (= canonical LatestTransaction): `claims: Operation[]`
 *   — a flat array of operations. No Batch wrapping.
 *   Wire (BCS): `[{ TokenTransfer: { ... } }, { LeaveCommittee: [] }, ...]`.
 *   Decoded: `[{ type: 'TokenTransfer', value: { ... } }, ...]`.
 *
 * ## Conversion logic
 *
 * Upcast (decode, 319 decoded → 407 wire):
 *   - If `claim.type === 'Batch'`, encode each batch op back to wire, put in `claims`.
 *   - Otherwise, encode the single claim back to wire, put it alone in `claims`.
 *
 * Downcast (encode, 407 wire → 319 decoded):
 *   - Check each wire op's type tag (the single key of the wire object). Reject
 *     ops not in Release20260319SupportedOperations (e.g. `Escrow`). Reject empty.
 *   - If single op, return it as `claim` directly (decoded TypedVariant form).
 *   - If multiple ops, return `{ type: 'Batch', value: [...decoded ops...] }` as `claim`.
 */

import { Either, ParseResult, Schema } from 'effect';
import type { TransactionVersion } from '../base/internal.ts';
import {
  OperationFromBcs,
  TransactionRelease20260319FromBcs,
  TransactionRelease20260407FromBcs,
  VersionedTransactionFromBcs,
} from '../palette/bcs.ts';
import { LatestTransaction } from './latest.ts';
import type { Operation } from './latest.ts';
import {
  Release20260319SupportedOperations,
  Release20260407SupportedOperations,
} from './operations-per-version.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SUPPORTED_20260319 = new Set<string>(Release20260319SupportedOperations);
const SUPPORTED_20260407 = new Set<string>(Release20260407SupportedOperations);

/** Extract the variant tag from a BCS-encoded wire operation. */
const wireOpType = (wireOp: unknown): string => {
  if (typeof wireOp === 'string') return wireOp; // serde unit variant (shouldn't occur in BCS)
  if (typeof wireOp === 'object' && wireOp !== null) {
    const keys = Object.keys(wireOp);
    if (keys.length === 1) return keys[0]!;
  }
  return '';
};

/**
 * Encode a decoded Operation (`{ type, value? }`) back to BCS wire form
 * (`{ Key: value }` or `{ Key: [] }`). Returns an Either: Right with the
 * wire form, or Left with the ParseIssue. This allows callers to propagate
 * encoding failures rather than silently falling back.
 */
const encodeOpToWire = (decodedOp: unknown): Either.Either<unknown, ParseResult.ParseIssue> => {
  return ParseResult.encodeUnknownEither(OperationFromBcs)(decodedOp);
};


// ---------------------------------------------------------------------------
// LatestFromRelease20260319 — real shape conversion + capability subsetting
// ---------------------------------------------------------------------------

/**
 * Bidirectional bridge between `TransactionRelease20260319` and the canonical
 * `LatestTransaction`.
 *
 * - **decode** (upcast, always succeeds): maps 319 wire → canonical wire.
 *   `claim` (single or Batch) → `claims` (flat array).
 * - **encode** (downcast, may fail): maps canonical wire → 319 decoded.
 *   Fails for Escrow ops (not in 20260319) or empty claims.
 */
export const LatestFromRelease20260319 = Schema.transformOrFail(
  TransactionRelease20260319FromBcs,
  LatestTransaction,
  {
    strict: false,
    decode: (release319, _opts, ast) => {
      // `release319` is `TransactionRelease20260319FromBcs.Type` (camelCase decoded).
      // Must return `LatestTransaction.Encoded` (snake_case 407 wire).
      //
      // claim is a TypedVariant decoded form: { type, value? }
      // - Batch: value is Operation.Type[] (decoded) — encode each to wire
      // - Other: single op in decoded form — encode back to wire
      const claim = release319.claim as { type: string; value?: unknown };

      // Reject empty Batch on decode (must be symmetric with encode-side rejection of empty claims).
      if (claim.type === 'Batch' && (claim.value as unknown[])?.length === 0) {
        return ParseResult.fail(
          new ParseResult.Type(
            ast,
            release319,
            'Release20260319 transactions cannot have an empty Batch',
          ),
        );
      }

      // Encode operations back to wire form, propagating any encoding failures.
      let encodeResults: Array<Either.Either<unknown, ParseResult.ParseIssue>>;
      if (claim.type === 'Batch') {
        const batchOps = (claim.value as unknown[]) ?? [];
        encodeResults = batchOps.map(encodeOpToWire);
      } else {
        encodeResults = [encodeOpToWire(claim)];
      }

      // Check for encoding failures and propagate the first one.
      const failure = encodeResults.find(Either.isLeft);
      if (failure !== undefined && Either.isLeft(failure)) {
        return ParseResult.fail(failure.left);
      }

      // All encodes succeeded; extract wire forms.
      const claimsWire = encodeResults.map((result) => (Either.getOrThrow(result) as unknown));

      return ParseResult.succeed({
        network_id: release319.networkId,
        sender: Array.from(release319.sender),
        nonce: release319.nonce,
        timestamp_nanos: release319.timestampNanos,
        claims: claimsWire,
        archival: release319.archival,
        fee_token: release319.feeToken !== null ? Array.from(release319.feeToken) : null,
      } as never);
    },
    encode: (wireLatest, _opts, ast) => {
      // `wireLatest` is `LatestTransaction.Encoded` (snake_case 407 wire).
      // Must return `TransactionRelease20260319FromBcs.Type` (camelCase 319 decoded).
      //
      // Strategy: decode the wire 407 form into LatestTransaction.Type (camelCase)
      // first, so we get properly branded Uint8Array/bigint values. Then rearrange
      // fields to build the 319 decoded form.
      //
      // `claims` in wire is: [{ TokenTransfer: {...} }, { LeaveCommittee: [] }, ...]
      const wireLatestObj = wireLatest as { claims?: readonly unknown[] };
      const wireOps = wireLatestObj.claims ?? [];

      // 1. Reject empty claims.
      if (wireOps.length === 0) {
        return ParseResult.fail(
          new ParseResult.Type(
            ast,
            wireLatest,
            'Release20260319 transactions require at least one operation',
          ),
        );
      }

      // 2. Capability check: reject ops not supported by 20260319.
      const unsupportedWire = wireOps.find(
        (wireOp) => !SUPPORTED_20260319.has(wireOpType(wireOp)),
      );
      if (unsupportedWire !== undefined) {
        return ParseResult.fail(
          new ParseResult.Type(
            ast,
            wireLatest,
            `Operation '${wireOpType(unsupportedWire)}' not supported by Release20260319`,
          ),
        );
      }

      // 3. Decode the full wire 407 form into canonical (camelCase) for proper brands.
      const decodedResult = ParseResult.decodeUnknownEither(LatestTransaction)(wireLatest);
      if (Either.isLeft(decodedResult)) return ParseResult.fail(decodedResult.left);
      const decodedLatest = decodedResult.right;

      // 4. Normalize: single op → bare claim decoded form; multiple → Batch.
      //    The decoded claims are OperationRelease20260407.Type (= { type, value? }).
      //    ClaimType for 319 accepts the same op structure for non-Batch variants.
      const decodedClaims = decodedLatest.claims;
      const claim =
        decodedClaims.length === 1
          ? decodedClaims[0]
          : { type: 'Batch' as const, value: decodedClaims };

      return ParseResult.succeed({
        networkId: decodedLatest.networkId,
        sender: decodedLatest.sender,
        nonce: decodedLatest.nonce,
        timestampNanos: decodedLatest.timestampNanos,
        claim,
        archival: decodedLatest.archival,
        feeToken: decodedLatest.feeToken,
      } as never);
    },
  },
);

// ---------------------------------------------------------------------------
// LatestFromRelease20260407 — identity passthrough (canonical = this version)
// ---------------------------------------------------------------------------

/**
 * Bidirectional bridge between `TransactionRelease20260407` and the canonical
 * `LatestTransaction`.
 *
 * Since `LatestTransaction` is aliased to `TransactionRelease20260407FromBcs`,
 * both schemas are structurally identical. This bridge is an identity
 * passthrough with a capability check (future-proofing for when the canonical
 * advances past 20260407):
 *
 * - **decode** (upcast): convert decoded 407 form back to 407 wire, pass through.
 * - **encode** (downcast): capability check, pass 407 wire through.
 */
export const LatestFromRelease20260407 = Schema.transformOrFail(
  TransactionRelease20260407FromBcs,
  LatestTransaction,
  {
    strict: false,
    decode: (release407, _opts, _ast) => {
      // `release407` is `TransactionRelease20260407FromBcs.Type` (camelCase decoded).
      // Must return `LatestTransaction.Encoded` (snake_case 407 wire).
      // Since A = B = TransactionRelease20260407FromBcs, encode the decoded value
      // back to wire format.
      const encoded = ParseResult.encodeUnknownEither(TransactionRelease20260407FromBcs)(
        release407,
      );
      if (Either.isLeft(encoded)) return ParseResult.fail(encoded.left);
      return ParseResult.succeed(encoded.right as never);
    },
    encode: (wireLatest, _opts, ast) => {
      // `wireLatest` is `LatestTransaction.Encoded` (snake_case 407 wire).
      // Must return `TransactionRelease20260407FromBcs.Type` (camelCase 407 decoded).
      //
      // Capability check on wire ops.
      const wireLatestObj = wireLatest as { claims?: readonly unknown[] };
      const wireOps = wireLatestObj.claims ?? [];
      const unsupportedWire = wireOps.find(
        (wireOp) => !SUPPORTED_20260407.has(wireOpType(wireOp)),
      );
      if (unsupportedWire !== undefined) {
        return ParseResult.fail(
          new ParseResult.Type(
            ast,
            wireLatest,
            `Operation '${wireOpType(unsupportedWire)}' not supported by Release20260407`,
          ),
        );
      }

      // Pass the wire form through — Effect will decode it via A.decode.
      // Since A = B = TransactionRelease20260407FromBcs, decode wire → decoded.
      const decoded = ParseResult.decodeUnknownEither(TransactionRelease20260407FromBcs)(
        wireLatest,
      );
      if (Either.isLeft(decoded)) return ParseResult.fail(decoded.left);
      return ParseResult.succeed(decoded.right as never);
    },
  },
);

// ---------------------------------------------------------------------------
// VersionBridges — typed registry, single source of truth for "what versions
// exist and what each one supports"
// ---------------------------------------------------------------------------

interface BridgeEntry {
  readonly schema: typeof LatestFromRelease20260319 | typeof LatestFromRelease20260407;
  readonly supportedOperations: readonly string[];
}

export const VersionBridges = {
  Release20260319: {
    schema: LatestFromRelease20260319,
    supportedOperations: Release20260319SupportedOperations,
  },
  Release20260407: {
    schema: LatestFromRelease20260407,
    supportedOperations: Release20260407SupportedOperations,
  },
} as const satisfies Record<TransactionVersion, BridgeEntry>;

// Type-level helpers derived from VersionBridges
export type SupportedOpTagFor<V extends TransactionVersion> =
  (typeof VersionBridges)[V]['supportedOperations'][number];

export type OperationFor<V extends TransactionVersion> = Extract<
  Operation,
  { type: SupportedOpTagFor<V> }
>;

// ---------------------------------------------------------------------------
// LatestFromVersionedTransaction — auto-dispatch decoder
//
// Decode (always succeeds): given a VersionedTransaction wire form, dispatches
// on the version tag to the appropriate per-version bridge's decode path.
//
// Encode REFUSES: callers must pick a target version explicitly via
// encodeAsVersion(latest, version).
// ---------------------------------------------------------------------------

export const LatestFromVersionedTransaction = Schema.transformOrFail(
  VersionedTransactionFromBcs,
  LatestTransaction,
  {
    strict: false,
    decode: (versioned, _opts, ast) => {
      // `versioned` is `VersionedTransactionFromBcs.Type`:
      //   { type: 'Release20260319', value: TransactionRelease20260319FromBcs.Type }
      //   | { type: 'Release20260407', value: TransactionRelease20260407FromBcs.Type }
      //
      // Must return `LatestTransaction.Encoded` (snake_case 407 wire form).
      //
      // Strategy (encode → bridge-decode → re-encode):
      //   1. Re-encode `versioned.value` through the per-release BCS schema → wire bytes
      //   2. Decode those wire bytes through the version bridge → LatestTransaction.Type
      //   3. Re-encode LatestTransaction.Type → LatestTransaction.Encoded
      //
      // We switch on versioned.type to pick the right source schema (and bridge),
      // rather than going through VersionBridges[type].schema.from (which isn't a
      // public API of Schema.transformOrFail).
      const { type, value } = versioned as
        | { type: 'Release20260319'; value: typeof TransactionRelease20260319FromBcs.Type }
        | { type: 'Release20260407'; value: typeof TransactionRelease20260407FromBcs.Type };

      switch (type) {
        case 'Release20260319': {
          // Re-encode the decoded 319 value back to wire form.
          const wireResult = ParseResult.encodeUnknownEither(TransactionRelease20260319FromBcs)(
            value,
          );
          if (Either.isLeft(wireResult)) return ParseResult.fail(wireResult.left);

          // Decode through the 319 bridge → LatestTransaction.Type.
          const latestResult = ParseResult.decodeUnknownEither(LatestFromRelease20260319)(
            wireResult.right,
          );
          if (Either.isLeft(latestResult)) return ParseResult.fail(latestResult.left);

          // Re-encode LatestTransaction.Type → LatestTransaction.Encoded.
          const encodedResult = ParseResult.encodeUnknownEither(LatestTransaction)(
            latestResult.right,
          );
          if (Either.isLeft(encodedResult)) return ParseResult.fail(encodedResult.left);

          return ParseResult.succeed(encodedResult.right as never);
        }
        case 'Release20260407': {
          // Re-encode the decoded 407 value back to wire form.
          const wireResult = ParseResult.encodeUnknownEither(TransactionRelease20260407FromBcs)(
            value,
          );
          if (Either.isLeft(wireResult)) return ParseResult.fail(wireResult.left);

          // Decode through the 407 bridge → LatestTransaction.Type.
          const latestResult = ParseResult.decodeUnknownEither(LatestFromRelease20260407)(
            wireResult.right,
          );
          if (Either.isLeft(latestResult)) return ParseResult.fail(latestResult.left);

          // Re-encode LatestTransaction.Type → LatestTransaction.Encoded.
          const encodedResult = ParseResult.encodeUnknownEither(LatestTransaction)(
            latestResult.right,
          );
          if (Either.isLeft(encodedResult)) return ParseResult.fail(encodedResult.left);

          return ParseResult.succeed(encodedResult.right as never);
        }
        default: {
          const exhaustiveCheck: never = type;
          return ParseResult.fail(
            new ParseResult.Type(
              ast,
              versioned,
              `Unknown transaction version: ${String(exhaustiveCheck)}`,
            ),
          );
        }
      }
    },
    encode: (_latest, _opts, ast) =>
      ParseResult.fail(
        new ParseResult.Type(
          ast,
          _latest,
          'LatestFromVersionedTransaction does not support encode — use encodeAsVersion(latest, version) which requires an explicit target version',
        ),
      ),
  },
);
