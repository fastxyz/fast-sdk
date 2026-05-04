/**
 * Per-version Operation enum schemas.
 *
 * Each release version of the Fast network supports a specific set of
 * operations. This file defines an Operation TypedVariant per version,
 * listing exactly the variants that release accepts on the wire.
 *
 * Individual operation factories (TokenTransfer, Mint, etc.) are shared —
 * only enum membership differs by version. The `Release<XXX>SupportedOperations`
 * tuples document which tags belong to which version, type-checked via
 * `satisfies` against the union's Type discriminator.
 *
 * Used by `composite/latest-bridges.ts` for runtime capability checks at the
 * encode-side downcast, and by the SDK's TransactionBuilder for
 * `OperationFor<V>` type-level narrowing.
 */

import {
  BurnFromBcs,
  ExternalClaimFromBcs,
  EscrowFromBcs,
  MintFromBcs,
  StateInitializationFromBcs,
  StateResetFromBcs,
  StateUpdateFromBcs,
  TokenCreationFromBcs,
  TokenManagementFromBcs,
  TokenTransferFromBcs,
  ValidatorConfigFromBcs,
  CommitteeChangeFromBcs,
} from '../palette/bcs.ts';
import { TypedVariant } from '../util/index.ts';

/** Operation enum supported in Release20260319 transactions (excludes Escrow). */
export const OperationRelease20260319 = TypedVariant({
  TokenTransfer: TokenTransferFromBcs,
  TokenCreation: TokenCreationFromBcs,
  TokenManagement: TokenManagementFromBcs,
  Mint: MintFromBcs,
  Burn: BurnFromBcs,
  StateInitialization: StateInitializationFromBcs,
  StateUpdate: StateUpdateFromBcs,
  StateReset: StateResetFromBcs,
  ExternalClaim: ExternalClaimFromBcs,
  JoinCommittee: ValidatorConfigFromBcs,
  LeaveCommittee: null,
  ChangeCommittee: CommitteeChangeFromBcs,
}, { unitEncoding: 'bcs' });

/** Tags supported in Release20260319 — type-checked tuple, drift-guarded by test. */
export const Release20260319SupportedOperations = [
  'TokenTransfer',
  'TokenCreation',
  'TokenManagement',
  'Mint',
  'Burn',
  'StateInitialization',
  'StateUpdate',
  'StateReset',
  'ExternalClaim',
  'JoinCommittee',
  'LeaveCommittee',
  'ChangeCommittee',
] as const satisfies readonly (typeof OperationRelease20260319.Type)['type'][];

/** Operation enum supported in Release20260407 transactions (includes Escrow). */
export const OperationRelease20260407 = TypedVariant({
  TokenTransfer: TokenTransferFromBcs,
  TokenCreation: TokenCreationFromBcs,
  TokenManagement: TokenManagementFromBcs,
  Mint: MintFromBcs,
  Burn: BurnFromBcs,
  StateInitialization: StateInitializationFromBcs,
  StateUpdate: StateUpdateFromBcs,
  StateReset: StateResetFromBcs,
  ExternalClaim: ExternalClaimFromBcs,
  JoinCommittee: ValidatorConfigFromBcs,
  LeaveCommittee: null,
  ChangeCommittee: CommitteeChangeFromBcs,
  Escrow: EscrowFromBcs,
}, { unitEncoding: 'bcs' });

/** Tags supported in Release20260407 — type-checked tuple, drift-guarded by test. */
export const Release20260407SupportedOperations = [
  'TokenTransfer',
  'TokenCreation',
  'TokenManagement',
  'Mint',
  'Burn',
  'StateInitialization',
  'StateUpdate',
  'StateReset',
  'ExternalClaim',
  'JoinCommittee',
  'LeaveCommittee',
  'ChangeCommittee',
  'Escrow',
] as const satisfies readonly (typeof OperationRelease20260407.Type)['type'][];

/** Re-export the Operation type for downstream OperationFor<V> derivation. */
export type Release20260319Operation = typeof OperationRelease20260319.Type;
export type Release20260407Operation = typeof OperationRelease20260407.Type;
