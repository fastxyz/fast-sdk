# @fastxyz/schema

Effect schema definitions for the Fast network protocol.
Provides type-safe, bidirectional codecs for BCS serialization,
JSON-RPC, and REST wire formats.

## What this package does

- Defines **branded primitive types**
  (Address, Amount, Nonce, Signature, TokenId, etc.)
- Provides **4 codec variants** for each type:
  - **BCS** — binary canonical serialization
  - **RPC** — JSON-RPC wire format (hex strings, number arrays)
  - **REST** — REST API format (decimal strings, bech32m)
  - **Input** — user-friendly (hex, Uint8Array, number[], bech32m)
- Defines **composite schemas** for transactions, operations,
  envelopes, and API responses
- Defines **error schemas** for structured error parsing (proxy, validator, JSON-RPC)
- Exports **BCS layout definitions** for `@mysten/bcs` serialization

## Architecture

```text
util/           Numeric codecs, array helpers, CamelCaseStruct, TypedVariant
  |
base/           Branded primitives + 4 codec variants (bcs, rpc, rest, input)
  |
composite/      Schema makers for operations, transactions, envelopes
  |
palette/        Instantiates composites with each codec palette
  |
interface/      User-input schemas for proxy API params
```

## Usage

```ts
import { Schema } from "effect";
import {
  TokenTransferFromRpc,
  TransactionEnvelopeFromRpc,
  type TransactionEnvelope,
  bcsSchema,
} from "@fastxyz/schema";

// Decode a JSON-RPC response into typed domain objects
const transfer = Schema.decodeUnknownSync(TokenTransferFromRpc)({
  token_id: [...],  // number[32]
  recipient: [...], // number[32]
  amount: "3e8",    // hex string
  user_data: null,
});
// { tokenId: Uint8Array, recipient: Uint8Array, amount: 1000n, userData: null }

// BCS serialization via @mysten/bcs layouts
const bytes = bcsSchema.VersionedTransaction.serialize(tx).toBytes();
```

## Transaction versioning

The Fast network supports multiple transaction formats simultaneously.
Each format is identified by a version tag (e.g. `Release20260319`,
`Release20260407`) and wrapped in a `VersionedTransaction` tagged union
for BCS serialization and signing.

### Discovering supported versions

```ts
import {
  SupportedTransactionVersions,
  LatestTransactionVersion,
  TransactionVersionRegistry,
  getTransactionVersionConfig,
} from "@fastxyz/schema";

// All versions this schema release supports
SupportedTransactionVersions;
// => readonly ['Release20260319', 'Release20260407']

// The default version used by the SDK
LatestTransactionVersion;
// => 'Release20260407'
```

### Building a VersionedTransaction

Each version has a different body shape. The `TransactionVersionRegistry`
maps version tags to a `TransactionVersionConfig` with helpers for
constructing and deconstructing operations:

```ts
import { Schema } from "effect";
import {
  getTransactionVersionConfig,
  type OperationInputParams,
} from "@fastxyz/schema";

const version = "Release20260407";
const config = getTransactionVersionConfig(version);

// Wrap operations into the version-specific body shape
const ops: OperationInputParams[] = [
  { type: "TokenTransfer", value: { tokenId, recipient, amount } },
];
const body = config.wrapOperations(ops);
// Release20260407 => { claims: [...] }
// Release20260319 => { claim: ... }  (single claim or Batch)

// Build a transaction with the input schema
const tx = Schema.decodeUnknownSync(config.inputSchema)({
  networkId: "fast:testnet",
  sender,
  nonce: 1n,
  timestampNanos: BigInt(Date.now()) * 1_000_000n,
  ...body,
  archival: false,
  feeToken: null,
});

// Wrap as VersionedTransaction for BCS serialization / signing
const versioned = { type: version, value: tx };
```

### Version format differences

| Version            | Operations field | Single op          | Multiple ops      |
| ------------------ | ---------------- | ------------------ | ----------------- |
| `Release20260319`  | `claim`          | Direct operation   | `Batch` variant   |
| `Release20260407`  | `claims`         | Array with 1 item  | Array of N items  |

### Decoding from wire formats

```ts
import { Schema } from "effect";
import {
  TransactionFromRpc,                  // Latest version (Release20260407)
  TransactionRelease20260319FromRpc,   // Explicit old version
  VersionedTransactionFromRpc,         // Tagged union (auto-detects version)
} from "@fastxyz/schema";

// Decode a specific version
const tx = Schema.decodeUnknownSync(TransactionFromRpc)(wireData);

// Decode any version via the tagged union
const versioned = Schema.decodeUnknownSync(VersionedTransactionFromRpc)(wireData);
// => { type: 'Release20260407', value: { ... } }
```

### BCS serialization

```ts
import { bcsSchema, serializeVersionedTransactionDomain } from "@fastxyz/schema";

// Low-level: use @mysten/bcs directly
const bytes = bcsSchema.VersionedTransaction.serialize(bcsData).toBytes();

// High-level: from domain-typed VersionedTransaction
const bytes = serializeVersionedTransactionDomain(versioned);
```

## Key exports

| Export                               | Description                                             |
| ------------------------------------ | ------------------------------------------------------- |
| `*FromRpc` schemas                   | Decode/encode JSON-RPC wire format                      |
| `*FromRest` schemas                  | Decode/encode REST API format                           |
| `*FromBcs` schemas                   | Decode/encode BCS binary format                         |
| `*FromInput` schemas                 | Accept flexible user input (hex, bytes, bech32m)        |
| `bcsSchema`                          | `@mysten/bcs` struct/enum definitions for serialization |
| `SupportedTransactionVersions`       | Readonly tuple of all supported version tags            |
| `LatestTransactionVersion`           | Default version used by the SDK                         |
| `TransactionVersionRegistry`         | Version → config map (wrapOperations, inputSchema)      |
| `getTransactionVersionConfig(v)`     | Get config for a version string (with runtime check)    |
| `serializeVersionedTransactionDomain`| Domain VersionedTransaction → BCS bytes                 |
| `TypedVariant`                       | Rust externally-tagged enum codec (serde/bcs modes)     |
| `CamelCaseStruct`                    | Automatic snake_case wire format to camelCase           |
| `ProxyErrorData`, `FastSetErrorData` | Structured error variant schemas                        |

## Development

```bash
pnpm build        # Build this package
pnpm turbo test   # Run the repo test pipeline
```

## Migrating to v2.0.0

### Breaking Changes

**Transaction format: `claim` → `claims` array**

In v1.x, transactions used a single `claim` field (Release20260319 format). In v2.0, the default transaction version is Release20260407, which uses a `claims` array.

**Before (v1.x):**
```ts
// Wire format had { claim: { Transfer: { ... } } }
const tx = Schema.decodeUnknownSync(TransactionFromRpc)(wireData);
console.log(tx.claim.type); // 'Transfer'
```

**After (v2.0):**
```ts
// Wire format now has { claims: [{ Transfer: { ... } }] }
const tx = Schema.decodeUnknownSync(TransactionFromRpc)(wireData);
console.log(tx.claims[0].type); // 'Transfer'
```

### New Exports

| Export | Description |
|--------|-------------|
| `TransactionVersionRegistry` | Map of version → config for building/parsing |
| `SupportedTransactionVersions` | `['Release20260319', 'Release20260407']` |
| `LatestTransactionVersion` | `'Release20260407'` |
| `getTransactionVersionConfig(v)` | Get version config with runtime validation |
| `*FromRest` schemas | REST API format codecs |
| `bcsSchema.EscrowJob`, `bcsSchema.EscrowAction` | Escrow BCS types |

### Using the Old Transaction Format

If you need to interact with Release20260319 transactions:

```ts
import {
  TransactionRelease20260319FromRpc,
  TransactionRelease20260319FromInput,
} from '@fastxyz/schema';

// Decode old-format transactions
const tx = Schema.decodeUnknownSync(TransactionRelease20260319FromRpc)(wireData);
console.log(tx.claim.type); // single claim
```

### Network Version Compatibility

| Network Version | Schema | SDK | Transaction Field |
|---|---|---|---|
| Release20260319 | `>=1.0.0` | `>=1.0.0` | `claim` (single) |
| Release20260407 | `>=2.0.0` | `>=2.0.0` | `claims` (array) |
