import {
  bytesToHex as viemBytesToHex,
  concat as viemConcat,
  hexToBytes as viemHexToBytes,
  stringToBytes,
} from 'viem';

export function stripHexPrefix(hex: string): string {
  return hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
}

export function bytesToHex(bytes: Uint8Array | number[]): string {
  return stripHexPrefix(viemBytesToHex(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)));
}

export function bytesToPrefixedHex(bytes: Uint8Array | number[]): string {
  return viemBytesToHex(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
}

export function hexToBytes(hex: string): Uint8Array {
  const stripped = stripHexPrefix(hex);
  if (stripped.length === 0) {
    return new Uint8Array(0);
  }
  const normalized = stripped.length % 2 === 0 ? stripped : `0${stripped}`;
  return viemHexToBytes(`0x${normalized}`);
}

export function utf8ToBytes(value: string): Uint8Array {
  return stringToBytes(value);
}

export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  return viemConcat(arrays);
}