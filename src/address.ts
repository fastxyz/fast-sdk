/**
 * address.ts — Fast address encoding (bech32m)
 *
 * Fast addresses are bech32m-encoded with HRP 'fast' (e.g. fast1...).
 * Internally they map to raw 32-byte Ed25519 public keys.
 */

import { bech32m } from 'bech32';
import { hexToBytes, bytesToHex } from './bytes.js';

const FAST_ADDRESS_HRP = 'fast';
const FAST_PUBLIC_KEY_LENGTH = 32;

function assertFastPublicKeyLength(publicKey: Uint8Array): void {
  if (publicKey.length !== FAST_PUBLIC_KEY_LENGTH) {
    throw new Error(`Fast public keys must be ${FAST_PUBLIC_KEY_LENGTH} bytes`);
  }
}

/** Convert a hex-encoded public key to a fast1... bech32m address */
export function pubkeyToAddress(publicKeyHex: string): string {
  const pubBytes = hexToBytes(publicKeyHex);
  assertFastPublicKeyLength(pubBytes);
  const words = bech32m.toWords(pubBytes);
  return bech32m.encode(FAST_ADDRESS_HRP, words, 90);
}

/** Decode a fast1... bech32m address to raw 32-byte public key */
export function addressToPubkey(address: string): Uint8Array {
  const { prefix, words } = bech32m.decode(address, 90);
  if (prefix.toLowerCase() !== FAST_ADDRESS_HRP) {
    throw new Error(`Invalid Fast address prefix: expected "${FAST_ADDRESS_HRP}"`);
  }

  const pubkey = new Uint8Array(bech32m.fromWords(words));
  assertFastPublicKeyLength(pubkey);
  return pubkey;
}

/** Decode and re-encode an address to its canonical fast1... representation. */
export function normalizeFastAddress(address: string): string {
  return pubkeyToAddress(bytesToHex(addressToPubkey(address)));
}
