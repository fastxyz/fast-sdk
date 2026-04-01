import { bech32m } from "bech32";
import { Encoding } from "effect";

/** Convert a Uint8Array to a `0x`-prefixed hex string. */
export const toHex = (bytes: Uint8Array): string =>
  `0x${Encoding.encodeHex(bytes)}`;

/** Convert a `0x`-prefixed (or bare) hex string to a Uint8Array. */
export const fromHex = (hex: string): Uint8Array => {
  const stripped =
    hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  const result = Encoding.decodeHex(stripped);
  if (result._tag === "Left") throw new Error(`Invalid hex string: ${hex}`);
  return result.right;
};

/** Convert a Uint8Array to a bech32m `fast1...` address string. */
export const toFastAddress = (bytes: Uint8Array): string =>
  bech32m.encode("fast", bech32m.toWords(bytes));

/** Convert a bech32m `fast1...` address string to a Uint8Array. */
export const fromFastAddress = (address: string): Uint8Array => {
  const { prefix, words } = bech32m.decode(address);
  if (prefix !== "fast")
    throw new Error(`Expected "fast" prefix, got "${prefix}"`);
  return new Uint8Array(bech32m.fromWords(words));
};

/** Convert a bigint to a `0x`-prefixed hex string. */
export const bigintToHex = (n: bigint): string => `0x${n.toString(16)}`;

/** Convert a `0x`-prefixed (or bare) hex string to a bigint. */
export const bigintFromHex = (hex: string): bigint => {
  const stripped =
    hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  return BigInt(`0x${stripped}`);
};
