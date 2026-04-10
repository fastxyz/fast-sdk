import { Schema } from 'effect';
import { Uint8Array32, Uint8Array32FromHex0x, Uint8Array32FromNumberArray } from '../util/index.ts';

/** Accepts hex string (with optional 0x prefix), Uint8Array, or number[32] as a private key. */
export const PrivateKeyFromInput = Schema.Union(Uint8Array32, Uint8Array32FromHex0x, Uint8Array32FromNumberArray).pipe(Schema.brand('PrivateKey'));

export type PrivateKeyInputParams = typeof PrivateKeyFromInput.Encoded;
