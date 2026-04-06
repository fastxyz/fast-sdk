import { timingSafeEqual } from "node:crypto";
import { fromHex, toHex } from "@fastxyz/fast-sdk";
import { ctr } from "@noble/ciphers/aes";
import { scryptAsync } from "@noble/hashes/scrypt.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { WrongPasswordError } from "../errors/index.js";

const SCRYPT_N = 262144;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const DKLEN = 32;

interface EncryptionJson {
  v: 1;
  salt: string;
  iv: string;
  mac: string;
  ct: string;
  kdf: { n: number; r: number; p: number };
}

const computeMac = (key: Uint8Array, text: Uint8Array): Uint8Array =>
  keccak_256(new Uint8Array([...key.slice(16, 32), ...text]));

const encryptJson = (blob: EncryptionJson): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(blob));

const decryptJson = (data: Uint8Array): EncryptionJson =>
  JSON.parse(new TextDecoder().decode(data));

const encodePassword = (password: string): Uint8Array =>
  new TextEncoder().encode(password);

/**
 * Encrypt a seed with a password. Returns an opaque blob (JSON bytes)
 * that can only be decrypted with the same password.
 */
export const encryptSeed = async (
  seed: Uint8Array,
  password: string,
): Promise<Uint8Array> => {
  const salt = randomBytes(32);
  const iv = randomBytes(16);
  const derivedKey = await scryptAsync(encodePassword(password), salt, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    dkLen: DKLEN,
  });
  const cipher = ctr(derivedKey.slice(0, 16), iv);
  const ciphertext = cipher.encrypt(seed);
  const mac = computeMac(derivedKey, ciphertext);

  const blob: EncryptionJson = {
    v: 1,
    salt: toHex(salt),
    iv: toHex(iv),
    mac: toHex(mac),
    ct: toHex(ciphertext),
    kdf: { n: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P },
  };
  return encryptJson(blob);
};

/**
 * Decrypt a seed from an encrypted blob. Throws WrongPasswordError if
 * the password is incorrect (MAC mismatch).
 */
export const decryptSeed = async (
  blob: Uint8Array,
  password: string,
): Promise<Uint8Array> => {
  const parsed: EncryptionJson = decryptJson(blob);
  const salt = fromHex(parsed.salt);
  const iv = fromHex(parsed.iv);
  const ciphertext = fromHex(parsed.ct);
  const storedMac = fromHex(parsed.mac);

  const derivedKey = await scryptAsync(encodePassword(password), salt, {
    N: parsed.kdf.n,
    r: parsed.kdf.r,
    p: parsed.kdf.p,
    dkLen: DKLEN,
  });

  const computedMac = computeMac(derivedKey, ciphertext);
  if (!timingSafeEqual(computedMac, storedMac)) {
    throw new WrongPasswordError();
  }

  const cipher = ctr(derivedKey.slice(0, 16), iv);
  return cipher.decrypt(ciphertext);
};
