/**
 * address.ts — Fast address encoding (bech32m)
 *
 * Fast addresses are bech32m-encoded with HRP 'fast' (e.g. fast1...).
 * Internally they map to raw 32-byte Ed25519 public keys.
 */

import { bech32m } from 'bech32';
import { hexToBytes, bytesToHex } from './bytes.js';

/** Convert a hex-encoded public key to a fast1... bech32m address */
export function pubkeyToAddress(publicKeyHex: string): string {
  const pubBytes = hexToBytes(publicKeyHex);
  const words = bech32m.toWords(pubBytes);
  return bech32m.encode('fast', words, 90);
}

/** Decode a fast1... bech32m address to raw 32-byte public key */
export function addressToPubkey(address: string): Uint8Array {
  const { words } = bech32m.decode(address, 90);
  return new Uint8Array(bech32m.fromWords(words));
}

/** Decode and re-encode an address to its canonical fast1... representation. */
export function normalizeFastAddress(address: string): string {
  return pubkeyToAddress(bytesToHex(addressToPubkey(address)));
}
