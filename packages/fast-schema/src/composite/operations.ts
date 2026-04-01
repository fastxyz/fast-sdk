import { Schema } from "effect";
import type { S } from "../palette/definition.ts";
import { CamelCaseStruct, TypedVariant } from "../util/index.ts";

/** `Add` | `Remove` — unit enum for address list changes. */
export const makeAddressChange = <Mode extends "serde" | "bcs" = "serde">(
  options?: { unitEncoding: Mode },
) => TypedVariant({ Add: null, Remove: null }, options);

export const AddressChange = makeAddressChange();

export const makeTokenTransfer = <TId extends S, TAddr extends S, TAmt extends S, TUd extends S>(
  p: { TokenId: TId; Address: TAddr; Amount: TAmt; UserData: TUd },
) => CamelCaseStruct({ token_id: p.TokenId, recipient: p.Address, amount: p.Amount, user_data: p.UserData });

export const makeTokenCreation = <TAmt extends S, TAddr extends S, TUd extends S>(
  p: { Amount: TAmt; Address: TAddr; UserData: TUd },
) => CamelCaseStruct({ token_name: Schema.String, decimals: Schema.Number, initial_amount: p.Amount, mints: Schema.Array(p.Address), user_data: p.UserData });

export const makeTokenManagement = <
  TId extends S, TNonce extends S, TAddr extends S, TUd extends S,
  Mode extends "serde" | "bcs" = "serde",
>(
  p: { TokenId: TId; Nonce: TNonce; Address: TAddr; UserData: TUd },
  options?: { unitEncoding: Mode },
) => CamelCaseStruct({ token_id: p.TokenId, update_id: p.Nonce, new_admin: Schema.NullOr(p.Address), mints: Schema.Array(Schema.Tuple(makeAddressChange(options), p.Address)), user_data: p.UserData });

export const makeMint = <TId extends S, TAddr extends S, TAmt extends S>(
  p: { TokenId: TId; Address: TAddr; Amount: TAmt },
) => CamelCaseStruct({ token_id: p.TokenId, recipient: p.Address, amount: p.Amount });

export const makeBurn = <TId extends S, TAmt extends S>(
  p: { TokenId: TId; Amount: TAmt },
) => CamelCaseStruct({ token_id: p.TokenId, amount: p.Amount });

export const makeStateInitialization = <TKey extends S, TSt extends S>(
  p: { StateKey: TKey; State: TSt },
) => CamelCaseStruct({ key: p.StateKey, initial_state: p.State });

export const makeStateUpdate = <TKey extends S, TSt extends S, TBi extends S>(
  p: { StateKey: TKey; State: TSt; BigInt: TBi },
) => CamelCaseStruct({ key: p.StateKey, previous_state: p.State, next_state: p.State, compute_claim_tx_hash: p.StateKey, compute_claim_tx_timestamp: p.BigInt });

export const makeStateReset = <TKey extends S, TSt extends S>(
  p: { StateKey: TKey; State: TSt },
) => CamelCaseStruct({ key: p.StateKey, reset_state: p.State });

export const makeExternalClaimBody = <TAddr extends S, TQ extends S, TCD extends S>(
  p: { Address: TAddr; Quorum: TQ; ClaimData: TCD },
) => CamelCaseStruct({ verifier_committee: Schema.Array(p.Address), verifier_quorum: p.Quorum, claim_data: p.ClaimData });

export const makeVerifierSig = <TAddr extends S, TSig extends S>(
  p: { Address: TAddr; Signature: TSig },
) => CamelCaseStruct({ verifier_addr: p.Address, sig: p.Signature });

export const makeExternalClaim = <TAddr extends S, TQ extends S, TCD extends S, TSig extends S>(
  p: { Address: TAddr; Quorum: TQ; ClaimData: TCD; Signature: TSig },
) => Schema.Struct({ claim: makeExternalClaimBody(p), signatures: Schema.Array(makeVerifierSig(p)) });

export const makeValidatorConfig = <TAddr extends S>(
  p: { Address: TAddr },
) => CamelCaseStruct({ address: p.Address, host: Schema.String, rpc_port: Schema.Number });

export const makeCommitteeConfig = <TAddr extends S>(
  p: { Address: TAddr },
) => Schema.Struct({ validators: Schema.Array(makeValidatorConfig(p)) });

export const makeCommitteeChange = <TAddr extends S>(
  p: { Address: TAddr },
) => CamelCaseStruct({ new_committee: makeCommitteeConfig(p), epoch: Schema.Number });

/** The 12 operation variants (no Batch). Used inside Batch. */
export const makeOperation = <
  TId extends S, TAddr extends S, TAmt extends S, TUd extends S,
  TNonce extends S, TKey extends S, TSt extends S, TBi extends S,
  TQ extends S, TCD extends S, TSig extends S,
  Mode extends "serde" | "bcs" = "serde",
>(p: {
  TokenId: TId; Address: TAddr; Amount: TAmt; UserData: TUd;
  Nonce: TNonce; StateKey: TKey; State: TSt; BigInt: TBi;
  Quorum: TQ; ClaimData: TCD; Signature: TSig;
}, options?: { unitEncoding: Mode }) =>
  TypedVariant({
    TokenTransfer: makeTokenTransfer(p),
    TokenCreation: makeTokenCreation(p),
    TokenManagement: makeTokenManagement(p, options),
    Mint: makeMint(p),
    Burn: makeBurn(p),
    StateInitialization: makeStateInitialization(p),
    StateUpdate: makeStateUpdate(p),
    StateReset: makeStateReset(p),
    ExternalClaim: makeExternalClaim(p),
    JoinCommittee: makeValidatorConfig(p),
    LeaveCommittee: null,
    ChangeCommittee: makeCommitteeChange(p),
  }, options);

/** Top-level claim type: 12 operation variants + Batch. */
export const makeClaimType = <
  TId extends S, TAddr extends S, TAmt extends S, TUd extends S,
  TNonce extends S, TKey extends S, TSt extends S, TBi extends S,
  TQ extends S, TCD extends S, TSig extends S,
  Mode extends "serde" | "bcs" = "serde",
>(p: {
  TokenId: TId; Address: TAddr; Amount: TAmt; UserData: TUd;
  Nonce: TNonce; StateKey: TKey; State: TSt; BigInt: TBi;
  Quorum: TQ; ClaimData: TCD; Signature: TSig;
}, options?: { unitEncoding: Mode }) =>
  TypedVariant({
    TokenTransfer: makeTokenTransfer(p),
    TokenCreation: makeTokenCreation(p),
    TokenManagement: makeTokenManagement(p, options),
    Mint: makeMint(p),
    Burn: makeBurn(p),
    StateInitialization: makeStateInitialization(p),
    StateUpdate: makeStateUpdate(p),
    StateReset: makeStateReset(p),
    ExternalClaim: makeExternalClaim(p),
    JoinCommittee: makeValidatorConfig(p),
    LeaveCommittee: null,
    ChangeCommittee: makeCommitteeChange(p),
    Batch: Schema.Array(makeOperation(p, options)),
  }, options);
