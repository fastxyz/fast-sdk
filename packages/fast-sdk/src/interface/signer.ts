import {
  type VersionedTransaction,
  PrivateKeyFromInput,
  type PrivateKeyInputParams,
} from "@fastxyz/schema";
import type { BcsType } from "@mysten/bcs";
import { Redacted, Schema } from "effect";
import { signVersionedTransaction } from "../core/crypto/envelope";
import * as signing from "../core/crypto/signing";
import { run } from "../core/run";
import { toFastAddress } from "./convert";

export interface FastSigner {
  getPublicKey(): Promise<Uint8Array>;
  signMessage(message: Uint8Array): Promise<Uint8Array>;
  signTransaction(transaction: VersionedTransaction): Promise<Uint8Array>;
}

/**
 * Ed25519 signer for Fast transactions.
 *
 * Accepts a private key as a hex string, `Uint8Array`, or `number[]`.
 * The key is stored using Effect's `Redacted` type to prevent
 * accidental logging or serialization.
 *
 * @example
 * ```ts
 * const signer = new Signer("abcdef0123456789...");
 * const pubKey = await signer.getPublicKey();
 * const sig = await signer.signMessage(new TextEncoder().encode("hello"));
 * ```
 */
export class Signer implements FastSigner {
  private readonly privateKey: Redacted.Redacted<Uint8Array>;
  private publicKey?: Uint8Array;

  /**
   * @param privateKey - 32-byte Ed25519 private key as hex string
   *   (with optional `0x` prefix), `Uint8Array`, or `number[]`.
   * @throws ParseError if the key is not exactly 32 bytes.
   */
  constructor(privateKey: PrivateKeyInputParams) {
    const key = Schema.decodeUnknownSync(PrivateKeyFromInput)(privateKey);
    this.privateKey = Redacted.make(key as Uint8Array);
  }

  /** Return the raw private key bytes. Handle with care. */
  async getPrivateKey(): Promise<Uint8Array> {
    return Redacted.value(this.privateKey);
  }

  /** Derive the Ed25519 public key. The result is cached after the first call. */
  async getPublicKey(): Promise<Uint8Array> {
    this.publicKey ??= await run(
      signing.getPublicKey(Redacted.value(this.privateKey)),
    );
    return this.publicKey;
  }

  /** Derive the bech32m `fast1...` address from the public key. */
  async getFastAddress(): Promise<string> {
    const pubKey = await this.getPublicKey();
    return toFastAddress(pubKey);
  }

  /** Sign a raw message and return the 64-byte Ed25519 signature. */
  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    return run(signing.signMessage(Redacted.value(this.privateKey), message));
  }

  /**
   * BCS-encode typed data with a domain prefix, then sign.
   * The domain prefix is `SchemaName::` followed by the serialized bytes.
   */
  async signTypedData<T>(type: BcsType<T>, data: T): Promise<Uint8Array> {
    return run(
      signing.signTypedData(Redacted.value(this.privateKey), type, data),
    );
  }

  /** Sign a Fast VersionedTransaction using the same domain-prefixed payload as the network. */
  async signTransaction(
    transaction: VersionedTransaction,
  ): Promise<Uint8Array> {
    return run(
      signVersionedTransaction(Redacted.value(this.privateKey), transaction),
    );
  }
}

/** Verify an Ed25519 signature against a raw message. Returns `false` on mismatch. */
export const verify = (
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
): Promise<boolean> => run(signing.verify(signature, message, publicKey));

/** Verify an Ed25519 signature against BCS-encoded typed data with domain prefix. */
export const verifyTypedData = <T>(
  signature: Uint8Array,
  type: BcsType<T>,
  data: T,
  publicKey: Uint8Array,
): Promise<boolean> =>
  run(signing.verifyTypedData(signature, type, data, publicKey));
