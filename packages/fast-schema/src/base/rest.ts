/**
 * REST wire-form primitives.
 *
 * Wire-faithful — every primitive accepts only what the Fast proxy actually
 * emits over REST. NO defensive widening for downstream transports.
 *
 * If a payload has crossed a JSON-string transport boundary that doesn't
 * preserve bigint natively (e.g. Chrome extension `port.postMessage` after a
 * `JSON.stringify(bigint→String)` step), use `TransportPalette` /
 * `*FromTransport` instead. Transport is identical to REST except for
 * widened bigint primitives.
 */
import { Schema } from 'effect';
import {
  DecimalInt320,
  DecimalUint256,
  Uint8Array32,
  Uint8Array32FromHex,
  Uint8Array64FromHex,
  Uint8ArrayFromBech32m,
  Uint64FromNumberOrSelf,
} from '../util/index.ts';
import { NetworkId } from './internal.ts';

export const AmountFromRest = DecimalUint256.pipe(Schema.brand('Amount'));
export const BalanceFromRest = DecimalInt320.pipe(Schema.brand('Balance'));
export const NonceFromRest = Uint64FromNumberOrSelf.pipe(Schema.brand('Nonce'));
export const QuorumFromRest = Uint64FromNumberOrSelf.pipe(Schema.brand('Quorum'));

export const NetworkIdFromRest = NetworkId;

export const AddressFromRest = Schema.compose(Uint8ArrayFromBech32m('fast'), Uint8Array32).pipe(Schema.brand('Address'));
export const SignatureFromRest = Uint8Array64FromHex.pipe(Schema.brand('Signature'));
export const TokenIdFromRest = Uint8Array32FromHex.pipe(Schema.brand('TokenId'));
export const StateKeyFromRest = Uint8Array32FromHex.pipe(Schema.brand('StateKey'));
export const StateFromRest = Uint8Array32FromHex.pipe(Schema.brand('State'));
export const ClaimDataFromRest = Schema.Uint8ArrayFromHex.pipe(Schema.brand('ClaimData'));
export const UserDataFromRest = Schema.NullOr(Uint8Array32FromHex.pipe(Schema.brand('UserData')));
