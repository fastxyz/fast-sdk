/**
 * address.ts — Fast address encoding (bech32m)
 *
 * Fast addresses are bech32m-encoded with HRP 'fast' (e.g. fast1...).
 * Internally they map to raw 32-byte Ed25519 public keys.
 */

import { bech32m } from 'bech32';
import type { DecodedFastAddress } from './types.js';

const FAST_ADDRESS_HRP = 'fast';
const FAST_PUBLIC_KEY_LENGTH = 32;
const FAST_ADDRESS_LIMIT = 90;

function assertFastAddressLength(bytes: Uint8Array): void {
  if (bytes.length !== FAST_PUBLIC_KEY_LENGTH) {
    throw new Error(`Fast address bytes must be ${FAST_PUBLIC_KEY_LENGTH} bytes`);
  }
}

/** Encode raw 32-byte Fast address bytes to a canonical fast1... bech32m string. */
export function encodeFastAddress(bytes: Uint8Array): string {
  assertFastAddressLength(bytes);
  const words = bech32m.toWords(bytes);
  return bech32m.encode(FAST_ADDRESS_HRP, words, FAST_ADDRESS_LIMIT);
}

/** Decode, validate, and canonicalize a Fast address. */
export function decodeFastAddress(address: string): DecodedFastAddress {
  const normalizedAddress = address.toLowerCase();
  const { prefix, words } = bech32m.decode(normalizedAddress, FAST_ADDRESS_LIMIT);
  if (prefix !== FAST_ADDRESS_HRP) {
    throw new Error(`Invalid Fast address prefix: expected "${FAST_ADDRESS_HRP}"`);
  }

  const bytes = new Uint8Array(bech32m.fromWords(words));
  assertFastAddressLength(bytes);

  return {
    address: encodeFastAddress(bytes),
    bytes,
  };
}

/** Decode a Fast address to its raw 32-byte representation. */
export function fastAddressToBytes(address: string): Uint8Array {
  return decodeFastAddress(address).bytes;
}
