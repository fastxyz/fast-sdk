import {
  FixedUint8Array,
  FixedUint8ArrayFromHex,
  FixedUint8ArrayFromHexOptional0x,
  FixedUint8ArrayFromNumberArray,
} from "./array.ts";
import {
  DecimalIntBigInt,
  DecimalUintBigInt,
  HexIntBigInt,
  HexUintBigInt,
  IntBigInt,
  IntBigIntFromNumberOrSelf,
  IntNumber,
  UintBigInt,
  UintBigIntFromNumberOrSelf,
  UintNumber,
} from "./numeric.ts";

/** `Uint8Array` that must be exactly 32 bytes. */
export const Uint8Array32 = FixedUint8Array(32);

/** `Uint8Array` that must be exactly 64 bytes. */
export const Uint8Array64 = FixedUint8Array(64);

/** Decodes a `number[32]` into a `Uint8Array(32)` and encodes back. */
export const Uint8Array32FromNumberArray = FixedUint8ArrayFromNumberArray(32);

/** Decodes a hex string (64 chars) into a `Uint8Array(32)` and encodes back. */
export const Uint8Array32FromHex = FixedUint8ArrayFromHex(32);

/** Decodes a hex string (optional `0x` prefix) into a `Uint8Array(32)`. */
export const Uint8Array32FromHex0x = FixedUint8ArrayFromHexOptional0x(32);

/** Decodes a `number[64]` into a `Uint8Array(64)` and encodes back. */
export const Uint8Array64FromNumberArray = FixedUint8ArrayFromNumberArray(64);

/** Decodes a hex string (optional `0x` prefix) into a `Uint8Array(64)`. */
export const Uint8Array64FromHex0x = FixedUint8ArrayFromHexOptional0x(64);

/** Decodes a hex string (128 chars) into a `Uint8Array(64)` and encodes back. */
export const Uint8Array64FromHex = FixedUint8ArrayFromHex(64);

/** Unsigned 8-bit integer (0 .. 255). */
export const Uint8 = UintNumber(8);

/** Unsigned 16-bit integer (0 .. 65535). */
export const Uint16 = UintNumber(16);

/** Unsigned 32-bit integer (0 .. 4294967295). */
export const Uint32 = UintNumber(32);

/** Signed 32-bit integer (-2147483648 .. 2147483647). */
export const Int32 = IntNumber(32);

/** Unsigned 64-bit integer (0 .. 2^64 - 1) as `bigint`. */
export const Uint64 = UintBigInt(64);

/** Signed 64-bit integer (-2^63 .. 2^63 - 1) as `bigint`. */
export const Int64 = IntBigInt(64);

/** Unsigned 128-bit integer (0 .. 2^128 - 1) as `bigint`. */
export const Uint128 = UintBigInt(128);

/** Unsigned 256-bit integer (0 .. 2^256 - 1) as `bigint`. */
export const Uint256 = UintBigInt(256);

/** Signed 320-bit integer (-2^319 .. 2^319 - 1) as `bigint`. Matches Rust `BInt<5>`. */
export const Int320 = IntBigInt(320);

/** Hex string to branded Uint64. */
export const HexUint64 = HexUintBigInt(64);

/** Hex string to branded Uint256. */
export const HexUint256 = HexUintBigInt(256);

/** Hex string to branded Int320. */
export const HexInt320 = HexIntBigInt(320);

/** Decimal string to branded Uint64. */
export const DecimalUint64 = DecimalUintBigInt(64);

/** Decimal string to branded Uint256. */
export const DecimalUint256 = DecimalUintBigInt(256);

/** Decimal string to branded Int320. */
export const DecimalInt320 = DecimalIntBigInt(320);

/** number or bigint to branded Uint64. */
export const Uint64FromNumberOrSelf = UintBigIntFromNumberOrSelf(64);

/** number or bigint to branded Uint256. */
export const Uint256FromNumberOrSelf = UintBigIntFromNumberOrSelf(256);

/** number or bigint to branded Int320. */
export const Int320FromNumberOrSelf = IntBigIntFromNumberOrSelf(320);
