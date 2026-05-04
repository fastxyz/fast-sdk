/**
 * Encode a canonical LatestTransaction into a version-specific wire form.
 *
 * Throws ParseError if `latest` contains operations not supported by `version`
 * (e.g., encoding a Latest with an Escrow op as Release20260319 fails because
 * Escrow doesn't exist in 20260319's Operation enum).
 *
 * The returned value is the discriminated VersionedTransaction wire form
 * shaped as `{ Release20260319: <inner-wire> }` or `{ Release20260407: <inner-wire> }`,
 * matching the shape produced by VersionedTransactionFromBcs.Encoded.
 */

import { Schema } from 'effect';
import type { TransactionVersion } from '../base/internal.ts';
import { VersionBridges } from '../composite/latest-bridges.ts';
import type { LatestTransaction } from '../composite/latest.ts';

/**
 * Encode a canonical LatestTransaction into a version-specific versioned wire form.
 *
 * @param latest - A canonical LatestTransaction value (with branded types)
 * @param version - The target transaction version (Release20260319 or Release20260407)
 * @returns A versioned wire object with shape { [version]: <inner-wire> }
 * @throws ParseError if canonical contains operations not supported by the target version
 *
 * @example
 * ```ts
 * const latest = Schema.decodeUnknownSync(LatestFromRelease20260407)(wireForm);
 * const versioned407 = encodeAsVersion(latest, 'Release20260407');
 * // { Release20260407: <wire> }
 *
 * const versioned319 = encodeAsVersion(latest, 'Release20260319');
 * // Throws if latest contains an Escrow operation (not supported by 20260319)
 * // Otherwise: { Release20260319: <wire> }
 * ```
 */
export function encodeAsVersion(
  latest: LatestTransaction,
  version: TransactionVersion,
): { readonly [K in TransactionVersion]?: unknown } {
  // Use a switch statement to match the version and encode through the appropriate bridge.
  // Each bridge's encode-side applies the capability check (e.g., Escrow not in 20260319).
  switch (version) {
    case 'Release20260319': {
      const releaseWire = Schema.encodeSync(VersionBridges.Release20260319.schema)(latest);
      return { Release20260319: releaseWire } as { readonly [K in TransactionVersion]?: unknown };
    }
    case 'Release20260407': {
      const releaseWire = Schema.encodeSync(VersionBridges.Release20260407.schema)(latest);
      return { Release20260407: releaseWire } as { readonly [K in TransactionVersion]?: unknown };
    }
    default: {
      const exhaustiveCheck: never = version;
      throw new Error(`Unknown transaction version: ${String(exhaustiveCheck)}`);
    }
  }
}
