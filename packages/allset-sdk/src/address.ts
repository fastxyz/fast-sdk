import { fromFastAddress, toFastAddress, toHex } from '@fastxyz/sdk';
import { hexToBytes, type Hex } from 'viem';

export function fastAddressToBytes(address: string): Uint8Array {
  try {
    return fromFastAddress(address);
  } catch (err) {
    throw new Error(`Invalid Fast address "${address}": ${(err as Error).message}`);
  }
}

export function fastAddressToBytes32(address: string): Hex {
  const bytes = fastAddressToBytes(address);
  if (bytes.byteLength !== 32) {
    throw new Error(`Invalid Fast address: expected 32 bytes, got ${bytes.byteLength}`);
  }
  return toHex(bytes) as Hex;
}

/** Inverse of fastAddressToBytes32. */
export function bytes32ToFastAddress(bytes32: Hex): string {
  const bytes = hexToBytes(bytes32);
  if (bytes.byteLength !== 32) {
    throw new Error(`Invalid bytes32 value: expected 32 bytes, got ${bytes.byteLength}`);
  }
  return toFastAddress(bytes);
}
