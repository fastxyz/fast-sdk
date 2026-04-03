import { Schema } from 'effect';
import {
  Int320FromNumberOrSelf,
  Uint8Array32FromNumberArray,
  Uint8Array64FromNumberArray,
  Uint8ArrayFromNumberArray,
  Uint64FromNumberOrSelf,
  Uint256FromNumberOrSelf,
} from '../util/index.ts';

export const AmountFromBcs = Uint256FromNumberOrSelf.pipe(Schema.brand('Amount'));
export const BalanceFromBcs = Int320FromNumberOrSelf.pipe(Schema.brand('Balance'));
export const NonceFromBcs = Uint64FromNumberOrSelf.pipe(Schema.brand('Nonce'));
export const QuorumFromBcs = Uint64FromNumberOrSelf.pipe(Schema.brand('Quorum'));

export const NetworkIdFromBcs = Schema.Literal('fast:localnet', 'fast:devnet', 'fast:testnet', 'fast:mainnet');

export const AddressFromBcs = Uint8Array32FromNumberArray.pipe(Schema.brand('Address'));
export const SignatureFromBcs = Uint8Array64FromNumberArray.pipe(Schema.brand('Signature'));
export const TokenIdFromBcs = Uint8Array32FromNumberArray.pipe(Schema.brand('TokenId'));
export const StateKeyFromBcs = Uint8Array32FromNumberArray.pipe(Schema.brand('StateKey'));
export const StateFromBcs = Uint8Array32FromNumberArray.pipe(Schema.brand('State'));
export const ClaimDataFromBcs = Uint8ArrayFromNumberArray.pipe(Schema.brand('ClaimData'));
export const UserDataFromBcs = Schema.NullOr(Uint8Array32FromNumberArray.pipe(Schema.brand('UserData')));
