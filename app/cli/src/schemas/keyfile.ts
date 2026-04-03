import { Schema } from 'effect';

export const KdfParams = Schema.Struct({
  dklen: Schema.Literal(32),
  n: Schema.Number,
  r: Schema.Number,
  p: Schema.Number,
  salt: Schema.String,
});

export const CryptoParams = Schema.Struct({
  cipher: Schema.Literal('aes-256-ctr'),
  cipherparams: Schema.Struct({ iv: Schema.String }),
  ciphertext: Schema.String,
  kdf: Schema.Literal('scrypt'),
  kdfparams: KdfParams,
  mac: Schema.String,
});

export class KeyfileV3 extends Schema.Class<KeyfileV3>('KeyfileV3')({
  version: Schema.Literal(3),
  id: Schema.String,
  fastAddress: Schema.String,
  evmAddress: Schema.String,
  crypto: CryptoParams,
  createdAt: Schema.String,
}) {}
