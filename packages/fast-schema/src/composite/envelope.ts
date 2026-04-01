import { Schema } from "effect";
import type { S } from "../palette/definition.ts";
import { CamelCaseStruct, TypedVariant } from "../util/index.ts";
import { makeVersionedTransaction } from "./transaction.ts";

export const makeMultiSigConfig = <TAddr extends S, TQ extends S, TNonce extends S>(
  p: { Address: TAddr; Quorum: TQ; Nonce: TNonce },
) => CamelCaseStruct({ authorized_signers: Schema.Array(p.Address), quorum: p.Quorum, nonce: p.Nonce });

export const makeMultiSig = <TAddr extends S, TSig extends S, TQ extends S, TNonce extends S>(
  p: { Address: TAddr; Signature: TSig; Quorum: TQ; Nonce: TNonce },
) => Schema.Struct({
  config: makeMultiSigConfig(p),
  signatures: Schema.Array(Schema.Tuple(p.Address, p.Signature)),
});

export const makeSignatureOrMultiSig = <TAddr extends S, TSig extends S, TQ extends S, TNonce extends S>(
  p: { Address: TAddr; Signature: TSig; Quorum: TQ; Nonce: TNonce },
) => TypedVariant({
  Signature: p.Signature,
  MultiSig: makeMultiSig(p),
});

export const makeTransactionEnvelope = <
  TNetId extends S, TAddr extends S, TNonce extends S, TBi extends S,
  TId extends S, TAmt extends S, TUd extends S, TKey extends S,
  TSt extends S, TQ extends S, TCD extends S, TSig extends S, TBal extends S,
>(p: {
  NetworkId: TNetId; Address: TAddr; Nonce: TNonce; BigInt: TBi;
  TokenId: TId; Amount: TAmt; UserData: TUd; StateKey: TKey;
  State: TSt; Quorum: TQ; ClaimData: TCD; Signature: TSig; Balance: TBal;
}) =>
  Schema.Struct({
    transaction: makeVersionedTransaction(p),
    signature: makeSignatureOrMultiSig(p),
  });

export const makeValidatedTransaction = <
  TNetId extends S, TAddr extends S, TNonce extends S, TBi extends S,
  TId extends S, TAmt extends S, TUd extends S, TKey extends S,
  TSt extends S, TQ extends S, TCD extends S, TSig extends S, TBal extends S,
>(p: {
  NetworkId: TNetId; Address: TAddr; Nonce: TNonce; BigInt: TBi;
  TokenId: TId; Amount: TAmt; UserData: TUd; StateKey: TKey;
  State: TSt; Quorum: TQ; ClaimData: TCD; Signature: TSig; Balance: TBal;
}) =>
  Schema.Struct({
    value: makeTransactionEnvelope(p),
    validator: p.Address,
    signature: p.Signature,
  });

export const makeTransactionCertificate = <
  TNetId extends S, TAddr extends S, TNonce extends S, TBi extends S,
  TId extends S, TAmt extends S, TUd extends S, TKey extends S,
  TSt extends S, TQ extends S, TCD extends S, TSig extends S, TBal extends S,
>(p: {
  NetworkId: TNetId; Address: TAddr; Nonce: TNonce; BigInt: TBi;
  TokenId: TId; Amount: TAmt; UserData: TUd; StateKey: TKey;
  State: TSt; Quorum: TQ; ClaimData: TCD; Signature: TSig; Balance: TBal;
}) =>
  Schema.Struct({
    envelope: makeTransactionEnvelope(p),
    signatures: Schema.Array(Schema.Tuple(p.Address, p.Signature)),
  });
