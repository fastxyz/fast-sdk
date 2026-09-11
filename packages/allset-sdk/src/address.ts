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
  return toHex(fastAddressToBytes(address)) as Hex;
}

/** Inverse of fastAddressToBytes32. */
export function bytes32ToFastAddress(bytes32: Hex): string {
  return toFastAddress(hexToBytes(bytes32));
}
