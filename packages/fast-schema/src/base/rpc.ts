import { Schema } from 'effect';
import {
  HexLowerInt320,
  HexLowerUint256,
  Uint8Array32FromNumberArray,
  Uint8Array64FromNumberArray,
  Uint8ArrayFromNumberArray,
  Uint64FromNumberOrStringOrSelf,
} from '../util/index.ts';
import { NetworkId } from './internal.ts';

export const AmountFromRpc = HexLowerUint256.pipe(Schema.brand('Amount'));
export const BalanceFromRpc = HexLowerInt320.pipe(Schema.brand('Balance'));
export const NonceFromRpc = Uint64FromNumberOrStringOrSelf.pipe(Schema.brand('Nonce'));
export const QuorumFromRpc = Uint64FromNumberOrStringOrSelf.pipe(Schema.brand('Quorum'));

export const NetworkIdFromRpc = NetworkId;

export const AddressFromRpc = Uint8Array32FromNumberArray.pipe(Schema.brand('Address'));
export const SignatureFromRpc = Uint8Array64FromNumberArray.pipe(Schema.brand('Signature'));
export const TokenIdFromRpc = Uint8Array32FromNumberArray.pipe(Schema.brand('TokenId'));
export const StateKeyFromRpc = Uint8Array32FromNumberArray.pipe(Schema.brand('StateKey'));
export const StateFromRpc = Uint8Array32FromNumberArray.pipe(Schema.brand('State'));
export const ClaimDataFromRpc = Uint8ArrayFromNumberArray.pipe(Schema.brand('ClaimData'));
export const UserDataFromRpc = Schema.NullOr(Uint8Array32FromNumberArray.pipe(Schema.brand('UserData')));
