/**
 * Canonical LatestTransaction schema.
 *
 * Structurally identical to Release20260407 today. Owns the canonical
 * Operation type alias (= OperationRelease20260407.Type, the latest's
 * Operation union). When a new release lands with a structural change
 * to the Transaction shape itself, this file is the migration point.
 *
 * Downstream code (TransactionBuilder, x402-facilitator BCS extractor)
 * operates on `LatestTransaction` regardless of which release produced
 * the wire bytes — bridges in `latest-bridges.ts` upcast on decode.
 */

import { Schema } from 'effect';
import { BcsPalette } from '../palette/definition.ts';
import { makeTransactionRelease20260407 } from './transaction.ts';
import { OperationRelease20260407 } from './operations-per-version.ts';

/** Canonical Operation = the latest version's Operation enum. */
export type Operation = typeof OperationRelease20260407.Type;

/**
 * Canonical Transaction schema.
 *
 * Today: structurally aliased to TransactionRelease20260407FromBcs (the
 * latest version's BCS-encoded Transaction schema). Defined separately
 * so future releases can extend or reshape canonical without forcing
 * downstream code to also re-spell its types.
 *
 * If a future release introduces a structural change incompatible with
 * the previous latest, redefine this schema explicitly via CamelCaseStruct
 * (see comments below) and add new bridges from old releases.
 */
export const LatestTransaction = makeTransactionRelease20260407(BcsPalette, {
  unitEncoding: 'bcs',
});

export type LatestTransaction = typeof LatestTransaction.Type;
