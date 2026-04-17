import { Schema } from 'effect';
import type { S } from '../palette/definition.ts';
import { CamelCaseStruct, TypedVariant } from '../util/index.ts';
import { makeClaimType, makeOperation } from './operations.ts';

/** The Release20260319 Transaction struct. Uses `claim: ClaimType`. */
export const makeTransactionRelease20260319 = <
  TNetId extends S,
  TAddr extends S,
  TNonce extends S,
  TBi extends S,
  TId extends S,
  TAmt extends S,
  TUd extends S,
  TKey extends S,
  TSt extends S,
  TQ extends S,
  TCD extends S,
  TSig extends S,
  Mode extends 'serde' | 'bcs' = 'serde',
>(
  p: {
    NetworkId: TNetId;
    Address: TAddr;
    Nonce: TNonce;
    BigInt: TBi;
    TokenId: TId;
    Amount: TAmt;
    UserData: TUd;
    StateKey: TKey;
    State: TSt;
    Quorum: TQ;
    ClaimData: TCD;
    Signature: TSig;
  },
  options?: { unitEncoding: Mode },
) =>
  CamelCaseStruct({
    network_id: p.NetworkId,
    sender: p.Address,
    nonce: p.Nonce,
    timestamp_nanos: p.BigInt,
    claim: makeClaimType(p, options),
    archival: Schema.Boolean,
    fee_token: Schema.NullOr(p.TokenId),
  });

/** The Release20260407 Transaction struct. Uses `claims: Array(Operation)`. */
export const makeTransactionRelease20260407 = <
  TNetId extends S,
  TAddr extends S,
  TNonce extends S,
  TBi extends S,
  TId extends S,
  TAmt extends S,
  TUd extends S,
  TKey extends S,
  TSt extends S,
  TQ extends S,
  TCD extends S,
  TSig extends S,
  Mode extends 'serde' | 'bcs' = 'serde',
>(
  p: {
    NetworkId: TNetId;
    Address: TAddr;
    Nonce: TNonce;
    BigInt: TBi;
    TokenId: TId;
    Amount: TAmt;
    UserData: TUd;
    StateKey: TKey;
    State: TSt;
    Quorum: TQ;
    ClaimData: TCD;
    Signature: TSig;
  },
  options?: { unitEncoding: Mode },
) =>
  CamelCaseStruct({
    network_id: p.NetworkId,
    sender: p.Address,
    nonce: p.Nonce,
    timestamp_nanos: p.BigInt,
    claims: Schema.Array(makeOperation(p, options)),
    archival: Schema.Boolean,
    fee_token: Schema.NullOr(p.TokenId),
  });

/** Alias for the latest transaction format. Currently {@link makeTransactionRelease20260407}. */
export const makeTransaction = makeTransactionRelease20260407;

/** VersionedTransaction — externally tagged, wraps all known release formats. */
export const makeVersionedTransaction = <
  TNetId extends S,
  TAddr extends S,
  TNonce extends S,
  TBi extends S,
  TId extends S,
  TAmt extends S,
  TUd extends S,
  TKey extends S,
  TSt extends S,
  TQ extends S,
  TCD extends S,
  TSig extends S,
  Mode extends 'serde' | 'bcs' = 'serde',
>(
  p: {
    NetworkId: TNetId;
    Address: TAddr;
    Nonce: TNonce;
    BigInt: TBi;
    TokenId: TId;
    Amount: TAmt;
    UserData: TUd;
    StateKey: TKey;
    State: TSt;
    Quorum: TQ;
    ClaimData: TCD;
    Signature: TSig;
  },
  options?: { unitEncoding: Mode },
) =>
  TypedVariant({
    Release20260319: makeTransactionRelease20260319(p, options),
    Release20260407: makeTransactionRelease20260407(p, options),
  });
