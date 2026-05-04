/**
 * Transport-tolerant wire primitives.
 *
 * Sibling to `base/rest.ts`. Identical shape on every primitive **except**
 * the bigint-typed ones (Nonce, Quorum), which additionally accept string
 * input. Use this palette wherever a REST-shaped payload has crossed a
 * JSON-string transport boundary that doesn't preserve bigint natively
 * (Chrome extension `port.postMessage` after a `JSON.stringify(bigint→String)`
 * mangling step is the canonical case).
 *
 * Encode direction is identical to REST. Only the decode acceptance is wider.
 */

import { Schema } from 'effect';
import { Uint64FromNumberOrStringOrSelf } from '../util/index.ts';
import {
  AddressFromRest,
  AmountFromRest,
  BalanceFromRest,
  ClaimDataFromRest,
  NetworkIdFromRest,
  SignatureFromRest,
  StateFromRest,
  StateKeyFromRest,
  TokenIdFromRest,
  UserDataFromRest,
} from './rest.ts';

export const NonceFromTransport = Uint64FromNumberOrStringOrSelf.pipe(Schema.brand('Nonce'));
export const QuorumFromTransport = Uint64FromNumberOrStringOrSelf.pipe(Schema.brand('Quorum'));

// Already string-typed on the wire — alias REST verbatim.
export const NetworkIdFromTransport = NetworkIdFromRest;
export const AddressFromTransport = AddressFromRest;
export const SignatureFromTransport = SignatureFromRest;
export const TokenIdFromTransport = TokenIdFromRest;
export const StateKeyFromTransport = StateKeyFromRest;
export const StateFromTransport = StateFromRest;
export const ClaimDataFromTransport = ClaimDataFromRest;
export const UserDataFromTransport = UserDataFromRest;
export const AmountFromTransport = AmountFromRest;
export const BalanceFromTransport = BalanceFromRest;
