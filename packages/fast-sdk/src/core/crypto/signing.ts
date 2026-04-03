import type { BcsType } from '@mysten/bcs';
import * as ed from '@noble/ed25519';
import { Effect } from 'effect';
import { PublicKeyError, SigningError, VerifyError } from '../error/crypto';
import { domainEncode } from './bcs';

/** Sign a raw message with an Ed25519 private key. */
export const signMessage = (privateKey: Uint8Array, message: Uint8Array) =>
  Effect.tryPromise({
    try: () => ed.signAsync(message, privateKey),
    catch: (cause) => new SigningError({ cause }),
  });

/** Sign BCS-encoded typed data with domain prefix. */
export const signTypedData = <T>(privateKey: Uint8Array, type: BcsType<T>, data: T) =>
  Effect.gen(function* () {
    const message = yield* domainEncode(type, data);
    return yield* signMessage(privateKey, message);
  });

/** Derive the Ed25519 public key from a private key. */
export const getPublicKey = (privateKey: Uint8Array) =>
  Effect.tryPromise({
    try: () => ed.getPublicKeyAsync(privateKey),
    catch: (cause) => new PublicKeyError({ cause }),
  });

/** Verify an Ed25519 signature against a raw message. */
export const verify = (signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array) =>
  Effect.tryPromise({
    try: () => ed.verifyAsync(signature, message, publicKey),
    catch: (cause) => new VerifyError({ cause }),
  });

/** Verify an Ed25519 signature against BCS-encoded typed data. */
export const verifyTypedData = <T>(signature: Uint8Array, type: BcsType<T>, data: T, publicKey: Uint8Array) =>
  Effect.gen(function* () {
    const message = yield* domainEncode(type, data);
    return yield* verify(signature, message, publicKey);
  });
