import { Effect, Schema } from 'effect';
import { JSONParse } from 'json-with-bigint';

const U64_MAX = (1n << 64n) - 1n;

const validU64Decimal = (value: string): boolean => {
  if (!/^\d+$/.test(value)) return false;
  try {
    return BigInt(value) <= U64_MAX;
  } catch {
    return false;
  }
};

const MultiSigWalletConfigStruct = Schema.Struct({
  version: Schema.Literal(1),
  name: Schema.String.pipe(Schema.minLength(1)),
  signers: Schema.Array(Schema.String).pipe(Schema.minItems(2)),
  quorum: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(1)),
  configNonce: Schema.String, // u64 as decimal string
  fastAddress: Schema.String,
  network: Schema.String,
});

const RustMultiSigWalletConfigStruct = Schema.Struct({
  signers: Schema.Array(Schema.String).pipe(Schema.minItems(2)),
  quorum: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(1)),
  config_nonce: Schema.Union(Schema.String, Schema.Number, Schema.BigIntFromSelf),
  address: Schema.String,
  proxy_url: Schema.String,
  network_id: Schema.String,
});

export const MultiSigWalletConfigSchema = MultiSigWalletConfigStruct.pipe(
  Schema.filter((v) => {
    if (v.quorum > v.signers.length) {
      return `quorum ${v.quorum} exceeds signer count ${v.signers.length}`;
    }
    if (new Set(v.signers).size !== v.signers.length) {
      return 'duplicate signers';
    }
    if (!validU64Decimal(v.configNonce)) {
      return `configNonce is not a valid u64: "${v.configNonce}"`;
    }
    return true;
  }),
);

export type MultiSigWalletConfig = Schema.Schema.Type<typeof MultiSigWalletConfigSchema>;

export const parseMultiSigWalletConfig = (json: string) =>
  Effect.try({
    try: () => JSONParse(json) as unknown,
    catch: (cause) => new Error(`invalid wallet config JSON: ${cause}`),
  }).pipe(
    Effect.flatMap((value) => {
      const isRecord = typeof value === 'object' && value !== null && !Array.isArray(value);
      const isRust = isRecord && ('config_nonce' in value || 'network_id' in value || 'proxy_url' in value);
      if (!isRust) return Schema.decodeUnknown(MultiSigWalletConfigSchema)(value);
      return Schema.decodeUnknown(RustMultiSigWalletConfigStruct)(value).pipe(
        Effect.flatMap((rust) => {
          const network = rust.network_id.startsWith('fast:') ? rust.network_id.slice('fast:'.length) : rust.network_id;
          return Schema.decodeUnknown(MultiSigWalletConfigSchema)({
            version: 1,
            name: 'rust-wallet',
            signers: rust.signers,
            quorum: rust.quorum,
            configNonce: String(rust.config_nonce),
            fastAddress: rust.address,
            network,
          });
        }),
      );
    }),
  );

export const stringifyMultiSigWalletConfig = (config: MultiSigWalletConfig): string => JSON.stringify(config, null, 2);
