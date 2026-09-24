import { createDecipheriv } from 'node:crypto';
import { Signer } from '@fastxyz/sdk';
import { argon2idAsync } from '@noble/hashes/argon2.js';

const hexBytes = (value: unknown, bytes: number): Buffer => {
  if (typeof value !== 'string' || !new RegExp(`^[0-9a-fA-F]{${bytes * 2}}$`).test(value)) {
    throw new Error('Invalid legacy keystore');
  }
  return Buffer.from(value, 'hex');
};

/** Read the encrypted format emitted by the original Rust fastset-multisig CLI. */
export const decryptLegacyKeystore = async (input: unknown, password: string): Promise<Uint8Array> => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Invalid legacy keystore');
  }
  const { address, crypto } = input as Record<string, unknown>;
  if (typeof address !== 'string' || typeof crypto !== 'object' || crypto === null || Array.isArray(crypto)) {
    throw new Error('Invalid legacy keystore');
  }
  const fields = crypto as Record<string, unknown>;
  const params = fields.kdf_params;
  if (
    fields.cipher !== 'aes-256-gcm' ||
    fields.kdf !== 'argon2id' ||
    typeof params !== 'object' ||
    params === null ||
    Array.isArray(params) ||
    (params as Record<string, unknown>).m_cost !== 65536 ||
    (params as Record<string, unknown>).t_cost !== 3 ||
    (params as Record<string, unknown>).p_cost !== 1
  ) {
    throw new Error('Unsupported legacy keystore parameters');
  }

  const salt = hexBytes(fields.salt, 16);
  const nonce = hexBytes(fields.nonce, 12);
  if (typeof fields.ciphertext !== 'string' || !/^[0-9a-fA-F]{34,256}$/.test(fields.ciphertext) || fields.ciphertext.length % 2 !== 0) {
    throw new Error('Invalid legacy keystore');
  }
  const ciphertext = Buffer.from(fields.ciphertext, 'hex');
  const key = await argon2idAsync(new TextEncoder().encode(password), salt, {
    m: 65536,
    t: 3,
    p: 1,
    dkLen: 32,
    version: 0x13,
  });
  let plain: Buffer;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(ciphertext.subarray(-16));
    plain = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
  } catch {
    throw new Error('Invalid legacy keystore or password');
  } finally {
    key.fill(0);
  }

  let encoded: unknown;
  try {
    encoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain));
  } catch {
    throw new Error('Invalid legacy keystore payload');
  } finally {
    plain.fill(0);
  }
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) {
    throw new Error('Invalid legacy keystore payload');
  }
  const seed = Buffer.from(encoded, 'base64');
  if (seed.length !== 32 || seed.toString('base64') !== encoded) {
    throw new Error('Invalid legacy keystore payload');
  }
  try {
    if ((await new Signer(seed).getFastAddress()) !== address) {
      throw new Error('Legacy keystore address mismatch');
    }
    return new Uint8Array(seed);
  } finally {
    seed.fill(0);
  }
};
