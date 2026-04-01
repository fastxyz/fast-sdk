import { bech32m } from 'bech32';
import type { Hex } from 'viem';

export function bytesToHex(bytes: Uint8Array): Hex {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return `0x${hex}` as Hex;
}

export function fastAddressToBytes(address: string): Uint8Array {
  let decoded: ReturnType<typeof bech32m.decode>;

  try {
    decoded = bech32m.decode(address, 90);
  } catch (error) {
    throw new Error(`Invalid Fast address "${address}": ${(error as Error).message}`);
  }

  const { prefix, words } = decoded;
  if (prefix !== 'fast') {
    throw new Error(`Fast address must use the "fast" prefix. Got: "${prefix}"`);
  }

  const bytes = new Uint8Array(bech32m.fromWords(words));
  if (bytes.length !== 32) {
    throw new Error(`Fast address must decode to 32 bytes. Got: ${bytes.length}`);
  }

  return bytes;
}

export function fastAddressToBytes32(address: string): Hex {
  return bytesToHex(fastAddressToBytes(address));
}
