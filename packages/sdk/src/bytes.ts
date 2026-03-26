import { bytesToHex as nobleBytesToHex, hexToBytes as nobleHexToBytes } from '@noble/hashes/utils';

export function stripHexPrefix(hex: string): string {
  return hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
}

export function bytesToHex(bytes: Uint8Array | number[]): string {
  return nobleBytesToHex(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
}

export function bytesToPrefixedHex(bytes: Uint8Array | number[]): string {
  return `0x${bytesToHex(bytes)}`;
}

export function hexToBytes(hex: string): Uint8Array {
  const stripped = stripHexPrefix(hex);
  if (stripped.length === 0) {
    return new Uint8Array(0);
  }
  const normalized = stripped.length % 2 === 0 ? stripped : `0${stripped}`;
  return nobleHexToBytes(normalized);
}

export function utf8ToBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, bytes) => sum + bytes.length, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const bytes of arrays) {
    merged.set(bytes, offset);
    offset += bytes.length;
  }
  return merged;
}

export function stringToBytes(str: string): Uint8Array {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    bytes[i] = str.charCodeAt(i);
  }
  return bytes;
}