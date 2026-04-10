import { Schema } from 'effect';
import { AddressFromInput, AmountFromInput, NonceFromInput, StateKeyFromInput, TokenIdFromInput } from '../base/input.ts';
import { makeTransactionEnvelope } from '../composite/envelope.ts';
import type { S } from '../palette/definition.ts';
import { CamelCaseStruct } from '../util/index.ts';

export const makeSubmitTransactionParams = <
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
  TBal extends S,
>(p: {
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
  Balance: TBal;
}) => makeTransactionEnvelope(p);

export const makeFaucetDripParams = <TAddr extends S, TAmt extends S, TId extends S>(p: { Address: TAddr; Amount: TAmt; TokenId: TId }) =>
  CamelCaseStruct({
    recipient: p.Address,
    amount: p.Amount,
    token_id: Schema.NullOr(p.TokenId),
  });

export const makeGetAccountInfoParams = <TAddr extends S, TId extends S, TKey extends S, TNonce extends S>(p: {
  Address: TAddr;
  TokenId: TId;
  StateKey: TKey;
  Nonce: TNonce;
}) =>
  CamelCaseStruct({
    address: p.Address,
    token_balances_filter: Schema.NullOr(Schema.Array(p.TokenId)),
    state_key_filter: Schema.NullOr(Schema.Array(p.StateKey)),
    certificate_by_nonce: Schema.NullOr(Schema.Struct({ start: p.Nonce, limit: Schema.Number })),
  });

export const makeGetPendingMultisigParams = <TAddr extends S>(p: { Address: TAddr }) => Schema.Struct({ address: p.Address });

export const makeGetTokenInfoParams = <TId extends S>(p: { TokenId: TId }) => CamelCaseStruct({ token_ids: Schema.Array(p.TokenId) });

export const makeGetTransactionCertificatesParams = <TAddr extends S, TNonce extends S>(p: { Address: TAddr; Nonce: TNonce }) =>
  CamelCaseStruct({
    address: p.Address,
    from_nonce: p.Nonce,
    limit: Schema.Number,
  });

/** User-input schemas with camelCase fields and flexible types. */

export const FaucetDripInput = Schema.Struct({
  recipient: AddressFromInput,
  amount: AmountFromInput,
  tokenId: Schema.NullOr(TokenIdFromInput),
});

export const GetAccountInfoInput = Schema.Struct({
  address: AddressFromInput,
  tokenBalancesFilter: Schema.optionalWith(Schema.NullOr(Schema.Array(TokenIdFromInput)), { default: () => null }),
  stateKeyFilter: Schema.optionalWith(Schema.NullOr(Schema.Array(StateKeyFromInput)), { default: () => null }),
  certificateByNonce: Schema.optionalWith(
    Schema.NullOr(
      Schema.Struct({
        start: NonceFromInput,
        limit: Schema.Number,
      }),
    ),
    { default: () => null },
  ),
});

export const GetPendingMultisigInput = Schema.Struct({
  address: AddressFromInput,
});

export const GetTokenInfoInput = Schema.Struct({
  tokenIds: Schema.Array(TokenIdFromInput),
});

export const GetTransactionCertificatesInput = Schema.Struct({
  address: AddressFromInput,
  fromNonce: NonceFromInput,
  limit: Schema.Number,
});

export type FaucetDripInputParams = typeof FaucetDripInput.Encoded;
export type GetAccountInfoInputParams = typeof GetAccountInfoInput.Encoded;
export type GetPendingMultisigInputParams = typeof GetPendingMultisigInput.Encoded;
export type GetTokenInfoInputParams = typeof GetTokenInfoInput.Encoded;
export type GetTransactionCertificatesInputParams = typeof GetTransactionCertificatesInput.Encoded;
