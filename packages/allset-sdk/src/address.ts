import { fromFastAddress, toHex } from '@fastxyz/fast-sdk';
import type { Hex } from 'viem';

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
