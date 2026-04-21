import type { Schema } from 'effect';

export type S = Schema.Schema.AnyNoContext;

import {
  AddressFromBcs,
  AddressFromRest,
  AddressFromRpc,
  AmountFromBcs,
  AmountFromRest,
  AmountFromRpc,
  BalanceFromBcs,
  BalanceFromRest,
  BalanceFromRpc,
  ClaimDataFromBcs,
  ClaimDataFromRest,
  ClaimDataFromRpc,
  NetworkIdFromBcs,
  NetworkIdFromRest,
  NetworkIdFromRpc,
  NonceFromBcs,
  NonceFromRest,
  NonceFromRpc,
  QuorumFromBcs,
  QuorumFromRest,
  QuorumFromRpc,
  SignatureFromBcs,
  SignatureFromRest,
  SignatureFromRpc,
  StateFromBcs,
  StateFromRest,
  StateFromRpc,
  StateKeyFromBcs,
  StateKeyFromRest,
  StateKeyFromRpc,
  TokenIdFromBcs,
  TokenIdFromRest,
  TokenIdFromRpc,
  UserDataFromBcs,
  UserDataFromRest,
  UserDataFromRpc,
} from '../base/index.ts';
import { BigIntFromNumberOrStringOrSelf } from '../util/index.ts';

export interface BasePalette {
  readonly Amount: S;
  readonly Balance: S;
  readonly Nonce: S;
  readonly Quorum: S;
  readonly NetworkId: S;
  readonly Address: S;
  readonly Signature: S;
  readonly TokenId: S;
  readonly StateKey: S;
  readonly State: S;
  readonly ClaimData: S;
  readonly UserData: S;
  readonly BigInt: S;
}

export const RpcPalette = {
  Amount: AmountFromRpc,
  Balance: BalanceFromRpc,
  Nonce: NonceFromRpc,
  Quorum: QuorumFromRpc,
  NetworkId: NetworkIdFromRpc,
  Address: AddressFromRpc,
  Signature: SignatureFromRpc,
  TokenId: TokenIdFromRpc,
  StateKey: StateKeyFromRpc,
  State: StateFromRpc,
  ClaimData: ClaimDataFromRpc,
  UserData: UserDataFromRpc,
  BigInt: BigIntFromNumberOrStringOrSelf,
} satisfies BasePalette;

export const RestPalette = {
  Amount: AmountFromRest,
  Balance: BalanceFromRest,
  Nonce: NonceFromRest,
  Quorum: QuorumFromRest,
  NetworkId: NetworkIdFromRest,
  Address: AddressFromRest,
  Signature: SignatureFromRest,
  TokenId: TokenIdFromRest,
  StateKey: StateKeyFromRest,
  State: StateFromRest,
  ClaimData: ClaimDataFromRest,
  UserData: UserDataFromRest,
  BigInt: BigIntFromNumberOrStringOrSelf,
} satisfies BasePalette;

export const BcsPalette = {
  Amount: AmountFromBcs,
  Balance: BalanceFromBcs,
  Nonce: NonceFromBcs,
  Quorum: QuorumFromBcs,
  NetworkId: NetworkIdFromBcs,
  Address: AddressFromBcs,
  Signature: SignatureFromBcs,
  TokenId: TokenIdFromBcs,
  StateKey: StateKeyFromBcs,
  State: StateFromBcs,
  ClaimData: ClaimDataFromBcs,
  UserData: UserDataFromBcs,
  BigInt: BigIntFromNumberOrStringOrSelf,
} satisfies BasePalette;
