/**
 * address.ts — Fast chain address encoding (bech32m)
 *
 * Fast addresses are bech32m-encoded with HRP 'fast' (e.g. fast1...).
 * Internally they map to raw 32-byte Ed25519 public keys.
 */
/** Convert a hex-encoded public key to a fast1... bech32m address */
export declare function pubkeyToAddress(publicKeyHex: string): string;
/** Decode a fast1... bech32m address to raw 32-byte public key */
export declare function addressToPubkey(address: string): Uint8Array;
//# sourceMappingURL=address.d.ts.map