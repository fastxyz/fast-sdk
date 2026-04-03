import { ctr } from "@noble/ciphers/aes";
import { scryptAsync } from "@noble/hashes/scrypt.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { Context, Effect, Layer } from "effect";
import { v4 as uuidv4 } from "uuid";
import { WrongPasswordError } from "../errors/index.js";
import type { KeyfileV3 } from "../schemas/keyfile.js";

const SCRYPT_N = 262144;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const DKLEN = 32;

export interface KeystoreV3Shape {
  readonly encrypt: (
    seed: Uint8Array,
    password: string,
    fastAddress: string,
    evmAddress: string,
  ) => Effect.Effect<KeyfileV3>;
  readonly decrypt: (
    keyfile: KeyfileV3,
    password: string,
  ) => Effect.Effect<Uint8Array, WrongPasswordError>;
}

export class KeystoreV3 extends Context.Tag("KeystoreV3")<
  KeystoreV3,
  KeystoreV3Shape
>() {}

const hexToBytes = (hex: string): Uint8Array => {
  const stripped = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(stripped.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(stripped.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
};

const bytesToHex = (bytes: Uint8Array): string =>
  `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;

const computeMac = (
  derivedKey: Uint8Array,
  ciphertext: Uint8Array,
): Uint8Array =>
  keccak_256(new Uint8Array([...derivedKey.slice(16, 32), ...ciphertext]));

const constantTimeEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
};

export const KeystoreV3Live = Layer.succeed(KeystoreV3, {
  encrypt: (seed, password, fastAddress, evmAddress) =>
    Effect.tryPromise({
      try: async () => {
        const salt = randomBytes(32);
        const iv = randomBytes(16);
        const derivedKey = await scryptAsync(
          new TextEncoder().encode(password),
          salt,
          { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, dkLen: DKLEN },
        );
        const cipher = ctr(derivedKey.slice(0, 16), iv);
        const ciphertext = cipher.encrypt(seed);
        const mac = computeMac(derivedKey, ciphertext);

        return {
          version: 3 as const,
          id: uuidv4(),
          fastAddress,
          evmAddress,
          crypto: {
            cipher: "aes-256-ctr" as const,
            cipherparams: { iv: bytesToHex(iv) },
            ciphertext: bytesToHex(ciphertext),
            kdf: "scrypt" as const,
            kdfparams: {
              dklen: 32 as const,
              n: SCRYPT_N,
              r: SCRYPT_R,
              p: SCRYPT_P,
              salt: bytesToHex(salt),
            },
            mac: bytesToHex(mac),
          },
          createdAt: new Date().toISOString(),
        } satisfies KeyfileV3;
      },
      catch: (cause) => {
        throw cause;
      },
    }),

  decrypt: (keyfile, password) =>
    Effect.gen(function* () {
      const { crypto } = keyfile;
      const salt = hexToBytes(crypto.kdfparams.salt);
      const iv = hexToBytes(crypto.cipherparams.iv);
      const ciphertext = hexToBytes(crypto.ciphertext);
      const storedMac = hexToBytes(crypto.mac);

      const derivedKey = yield* Effect.tryPromise({
        try: () =>
          scryptAsync(new TextEncoder().encode(password), salt, {
            N: crypto.kdfparams.n,
            r: crypto.kdfparams.r,
            p: crypto.kdfparams.p,
            dkLen: crypto.kdfparams.dklen,
          }),
        catch: () => new WrongPasswordError(),
      });

      const computedMac = computeMac(derivedKey, ciphertext);
      if (!constantTimeEqual(computedMac, storedMac)) {
        return yield* Effect.fail(new WrongPasswordError());
      }

      const cipher = ctr(derivedKey.slice(0, 16), iv);
      return cipher.decrypt(ciphertext);
    }),
});
