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

export const AmountFromRest = DecimalUint256.pipe(Schema.brand('Amount'));
export const BalanceFromRest = DecimalInt320.pipe(Schema.brand('Balance'));
export const NonceFromRest = Uint64FromNumberOrSelf.pipe(Schema.brand('Nonce'));
export const QuorumFromRest = Uint64FromNumberOrSelf.pipe(Schema.brand('Quorum'));

export const NetworkIdFromRest = Schema.Literal('fast:localnet', 'fast:devnet', 'fast:testnet', 'fast:mainnet');

export const AddressFromRest = Schema.compose(Uint8ArrayFromBech32m('fast'), Uint8Array32).pipe(Schema.brand('Address'));
export const SignatureFromRest = Uint8Array64FromHex.pipe(Schema.brand('Signature'));
export const TokenIdFromRest = Uint8Array32FromHex.pipe(Schema.brand('TokenId'));
export const StateKeyFromRest = Uint8Array32FromHex.pipe(Schema.brand('StateKey'));
export const StateFromRest = Uint8Array32FromHex.pipe(Schema.brand('State'));
export const ClaimDataFromRest = Schema.Uint8ArrayFromHex.pipe(Schema.brand('ClaimData'));
export const UserDataFromRest = Schema.NullOr(Uint8Array32FromHex.pipe(Schema.brand('UserData')));
