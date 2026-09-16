import { canonicalizeMultiSigSigners, fromFastAddress, toFastAddress } from '@fastxyz/sdk';

/** Canonicalize Fast addresses by decoded bytes, exactly like the Rust CLI. */
export function canonicalizeSignerAddresses(signers: readonly string[]): string[] {
  return canonicalizeMultiSigSigners(signers.map(fromFastAddress)).map(toFastAddress);
}
