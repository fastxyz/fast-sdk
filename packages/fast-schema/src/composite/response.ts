import { Schema } from "effect";
import type { S } from "../palette/definition.ts";
import { CamelCaseStruct, TypedVariant } from "../util/index.ts";
import { makeTransactionCertificate, makeValidatedTransaction } from "./envelope.ts";

export const makeNonceRange = <TNonce extends S>(p: { Nonce: TNonce }) =>
  Schema.Struct({ start: p.Nonce, limit: Schema.Number });

export const makePageRequest = <TBi extends S>(p: { BigInt: TBi }) =>
  Schema.Struct({ limit: Schema.Number, token: Schema.optional(p.BigInt) });

export const makePage = <A, I, R>(itemSchema: Schema.Schema<A, I, R>) =>
  CamelCaseStruct({ data: Schema.Array(itemSchema), next_page_token: Schema.BigIntFromSelf });

export const makeTokenMetadata = <TNonce extends S, TAddr extends S, TAmt extends S>(
  p: { Nonce: TNonce; Address: TAddr; Amount: TAmt },
) => CamelCaseStruct({
  update_id: p.Nonce, admin: p.Address, token_name: Schema.String,
  decimals: Schema.Number, total_supply: p.Amount, mints: Schema.Array(p.Address),
});

export const makeAccountInfoResponse = <
  TNetId extends S, TAddr extends S, TNonce extends S, TBi extends S,
  TId extends S, TAmt extends S, TUd extends S, TKey extends S,
  TSt extends S, TQ extends S, TCD extends S, TSig extends S, TBal extends S,
>(p: {
  NetworkId: TNetId; Address: TAddr; Nonce: TNonce; BigInt: TBi;
  TokenId: TId; Amount: TAmt; UserData: TUd; StateKey: TKey;
  State: TSt; Quorum: TQ; ClaimData: TCD; Signature: TSig; Balance: TBal;
}) => CamelCaseStruct({
  sender: p.Address, balance: p.Balance, next_nonce: p.Nonce,
  pending_confirmation: Schema.NullOr(makeValidatedTransaction(p)),
  requested_state: Schema.Array(Schema.Tuple(p.StateKey, p.State)),
  requested_certificates: Schema.NullOr(Schema.Array(makeTransactionCertificate(p))),
  requested_validated_transaction: Schema.NullOr(makeValidatedTransaction(p)),
  token_balance: Schema.Array(Schema.Tuple(p.TokenId, p.Balance)),
});

export const makeTokenInfoResponse = <
  TNetId extends S, TAddr extends S, TNonce extends S, TBi extends S,
  TId extends S, TAmt extends S, TUd extends S, TKey extends S,
  TSt extends S, TQ extends S, TCD extends S, TSig extends S, TBal extends S,
>(p: {
  NetworkId: TNetId; Address: TAddr; Nonce: TNonce; BigInt: TBi;
  TokenId: TId; Amount: TAmt; UserData: TUd; StateKey: TKey;
  State: TSt; Quorum: TQ; ClaimData: TCD; Signature: TSig; Balance: TBal;
}) => CamelCaseStruct({
  requested_token_metadata: Schema.Array(Schema.Tuple(p.TokenId, Schema.NullOr(makeTokenMetadata(p)))),
});

export const makeSubmitTransactionResponse = <TAddr extends S, TSig extends S, TNonce extends S, TCD extends S>(
  p: { Address: TAddr; Signature: TSig; Nonce: TNonce; ClaimData: TCD },
) => CamelCaseStruct({ validator: p.Address, signature: p.Signature, next_nonce: p.Nonce, transaction_hash: p.ClaimData });

export const makeConfirmTransactionResponse = <TId extends S>(
  p: { TokenId: TId },
) => CamelCaseStruct({ token_ids: Schema.Array(p.TokenId) });

export const makeProxySubmitTransactionResult = <
  TNetId extends S, TAddr extends S, TNonce extends S, TBi extends S,
  TId extends S, TAmt extends S, TUd extends S, TKey extends S,
  TSt extends S, TQ extends S, TCD extends S, TSig extends S, TBal extends S,
>(p: {
  NetworkId: TNetId; Address: TAddr; Nonce: TNonce; BigInt: TBi;
  TokenId: TId; Amount: TAmt; UserData: TUd; StateKey: TKey;
  State: TSt; Quorum: TQ; ClaimData: TCD; Signature: TSig; Balance: TBal;
}) => TypedVariant({
  Success: makeTransactionCertificate(p),
  IncompleteVerifierSigs: null,
  IncompleteMultiSig: null,
});
