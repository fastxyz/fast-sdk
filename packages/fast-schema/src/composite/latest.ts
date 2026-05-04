/**
 * Canonical LatestTransaction schema.
 *
 * Aliased today to `TransactionRelease20260407FromBcs` (the latest version's
 * BCS-encoded Transaction schema). Defined as a separate symbol so that
 * downstream code can import a stable canonical name regardless of which
 * release happens to be the latest, and so that future releases can diverge
 * from the latest's structure without forcing every consumer to also re-spell
 * its types.
 *
 * Companion `Operation` type alias = the latest version's Operation enum
 * (`OperationRelease20260407.Type`). Structurally identical to
 * `LatestTransaction.Type.claims[number]`.
 *
 * **Future divergence:** when a new release introduces a structural change
 * incompatible with the previous latest, redefine this schema explicitly
 * via `CamelCaseStruct` (drop the alias and inline the field shapes), then
 * add bridges from older releases.
 *
 * Bridges in `latest-bridges.ts` upcast each release's BCS-encoded
 * Transaction into this canonical via `Schema.transformOrFail`.
 */

import { TransactionRelease20260407FromBcs } from '../palette/bcs.ts';
import { OperationRelease20260407 } from './operations-per-version.ts';

/** Canonical Operation = the latest version's Operation enum. */
export type Operation = typeof OperationRelease20260407.Type;

/**
 * Canonical Transaction schema.
 *
 * Today: alias to `TransactionRelease20260407FromBcs`. See file header for
 * the migration story when a future release diverges.
 */
export const LatestTransaction = TransactionRelease20260407FromBcs;
export type LatestTransaction = typeof LatestTransaction.Type;
