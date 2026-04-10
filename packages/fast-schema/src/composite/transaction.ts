import { Schema } from 'effect';
import type { S } from '../palette/definition.ts';
import { CamelCaseStruct, TypedVariant } from '../util/index.ts';
import { makeClaimType } from './operations.ts';

/** The Release20260319 Transaction struct. */
export const makeTransaction = <
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

/** VersionedTransaction — externally tagged, Release20260319 only for now. */
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
) => TypedVariant({ Release20260319: makeTransaction(p, options) });
