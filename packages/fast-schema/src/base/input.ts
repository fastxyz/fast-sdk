import { Schema } from "effect";
import {
  DecimalInt320,
  DecimalUint256,
  HexInt320,
  HexUint256,
  Int320FromNumberOrSelf,
  Uint8Array32,
  Uint8Array32FromHex0x,
  Uint8Array32FromNumberArray,
  Uint8Array64,
  Uint8Array64FromHex0x,
  Uint8Array64FromNumberArray,
  Uint8ArrayFromBech32m,
  Uint8ArrayFromHexOptional0x,
  Uint8ArrayFromNumberArray,
  Uint64FromNumberOrSelf,
  Uint256FromNumberOrSelf,
} from "../util/index.ts";

export const AmountFromInput = Schema.Union(
  Uint256FromNumberOrSelf,
  HexUint256,
  DecimalUint256,
).pipe(Schema.brand("Amount"));

export const BalanceFromInput = Schema.Union(
  Int320FromNumberOrSelf,
  HexInt320,
  DecimalInt320,
).pipe(Schema.brand("Balance"));

export const NonceFromInput = Uint64FromNumberOrSelf.pipe(
  Schema.brand("Nonce"),
);
export const QuorumFromInput = Uint64FromNumberOrSelf.pipe(
  Schema.brand("Quorum"),
);

export const NetworkIdFromInput = Schema.Literal(
  "fast:localnet",
  "fast:devnet",
  "fast:testnet",
  "fast:mainnet",
);

export const AddressFromInput = Schema.Union(
  Uint8Array32,
  Uint8Array32FromNumberArray,
  Uint8Array32FromHex0x,
  Schema.compose(Uint8ArrayFromBech32m("fast"), Uint8Array32),
).pipe(Schema.brand("Address"));

export const SignatureFromInput = Schema.Union(
  Uint8Array64,
  Uint8Array64FromNumberArray,
  Uint8Array64FromHex0x,
).pipe(Schema.brand("Signature"));

export const TokenIdFromInput = Schema.Union(
  Uint8Array32,
  Uint8Array32FromNumberArray,
  Uint8Array32FromHex0x,
).pipe(Schema.brand("TokenId"));

export const StateKeyFromInput = Schema.Union(
  Uint8Array32,
  Uint8Array32FromNumberArray,
  Uint8Array32FromHex0x,
).pipe(Schema.brand("StateKey"));

export const StateFromInput = Schema.Union(
  Uint8Array32,
  Uint8Array32FromNumberArray,
  Uint8Array32FromHex0x,
).pipe(Schema.brand("State"));

export const ClaimDataFromInput = Schema.Union(
  Schema.Uint8ArrayFromSelf,
  Uint8ArrayFromNumberArray,
  Uint8ArrayFromHexOptional0x,
).pipe(Schema.brand("ClaimData"));

export const UserDataFromInput = Schema.NullOr(
  Schema.Union(
    Uint8Array32,
    Uint8Array32FromNumberArray,
    Uint8Array32FromHex0x,
  ).pipe(Schema.brand("UserData")),
);

export type AmountInput = typeof AmountFromInput.Encoded;
export type BalanceInput = typeof BalanceFromInput.Encoded;
export type NonceInput = typeof NonceFromInput.Encoded;
export type QuorumInput = typeof QuorumFromInput.Encoded;
export type AddressInput = typeof AddressFromInput.Encoded;
export type SignatureInput = typeof SignatureFromInput.Encoded;
export type TokenIdInput = typeof TokenIdFromInput.Encoded;
export type StateKeyInput = typeof StateKeyFromInput.Encoded;
export type StateInput = typeof StateFromInput.Encoded;
export type ClaimDataInput = typeof ClaimDataFromInput.Encoded;
export type UserDataInput = typeof UserDataFromInput.Encoded;
