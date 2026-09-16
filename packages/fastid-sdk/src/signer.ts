import * as ed from "@noble/ed25519";
import { toFastAddress } from "@fastxyz/sdk";

import { toHex } from "./address.js";
import { InvalidSignerError } from "./errors.js";
import { ensureEd25519Sync, hexToBytes } from "./verify.js";

/**
 * Signing seam for IdClient. It is intentionally small so an account managed
 * by another Fast SDK can adapt to it without changing the protocol pipeline.
 */
export interface Signer {
  readonly address: string;
  readonly signerHex: string;
  readonly publicKey: Uint8Array;
  sign(bytes: Uint8Array): Promise<string>;
}

/** Validate and snapshot the three public representations exposed by a signer adapter. */
export function validatedSigner(signer: Signer): Signer {
  const publicKey = signer.publicKey;
  if (!(publicKey instanceof Uint8Array) || publicKey.length !== 32) {
    throw new InvalidSignerError();
  }
  const snapshot = new Uint8Array(publicKey);
  const signerHex = signer.signerHex;
  const address = signer.address;
  if (
    !/^[0-9a-f]{64}$/.test(signerHex) ||
    toHex(snapshot) !== signerHex ||
    toFastAddress(snapshot) !== address
  ) {
    throw new InvalidSignerError();
  }
  return Object.freeze({
    address,
    signerHex,
    publicKey: snapshot,
    sign: async (bytes: Uint8Array) => {
      const raw = await signer.sign(new Uint8Array(bytes));
      if (typeof raw !== "string" || !/^(?:0x)?[0-9a-f]{128}$/i.test(raw)) {
        throw new InvalidSignerError();
      }
      return raw.replace(/^0x/i, "").toLowerCase();
    },
  });
}

function parsePrivateKey(input: Uint8Array | string): Uint8Array {
  if (typeof input === "string") {
    if (!/^[0-9a-f]{64}$/i.test(input)) {
      throw new Error("private key must be a bare 64-hex string");
    }
    return hexToBytes(input);
  }
  if (!(input instanceof Uint8Array) || input.length !== 32) {
    throw new Error("private key must be exactly 32 bytes");
  }
  return new Uint8Array(input);
}

export class KeySigner implements Signer {
  readonly address: string;
  readonly signerHex: string;
  readonly #privateKey: Uint8Array;
  readonly #publicKey: Uint8Array;

  private constructor(privateKey: Uint8Array, publicKey: Uint8Array) {
    this.#privateKey = privateKey;
    this.#publicKey = publicKey;
    this.signerHex = toHex(publicKey);
    this.address = toFastAddress(publicKey);
  }

  get publicKey(): Uint8Array {
    return new Uint8Array(this.#publicKey);
  }

  static async fromPrivateKey(input: Uint8Array | string): Promise<KeySigner> {
    const privateKey = parsePrivateKey(input);
    ensureEd25519Sync();
    const publicKey = ed.getPublicKey(privateKey);
    return new KeySigner(privateKey, publicKey);
  }

  static async generate(): Promise<KeySigner> {
    return KeySigner.fromPrivateKey(ed.utils.randomPrivateKey());
  }

  async sign(bytes: Uint8Array): Promise<string> {
    ensureEd25519Sync();
    return toHex(ed.sign(new Uint8Array(bytes), this.#privateKey));
  }
}
