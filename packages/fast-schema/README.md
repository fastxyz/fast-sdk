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

## Key exports

| Export                               | Description                                             |
| ------------------------------------ | ------------------------------------------------------- |
| `*FromRpc` schemas                   | Decode/encode JSON-RPC wire format                      |
| `*FromRest` schemas                  | Decode/encode REST API format                           |
| `*FromBcs` schemas                   | Decode/encode BCS binary format                         |
| `*FromInput` schemas                 | Accept flexible user input (hex, bytes, bech32m)        |
| `bcsSchema`                          | `@mysten/bcs` struct/enum definitions for serialization |
| `TypedVariant`                       | Rust externally-tagged enum codec (serde/bcs modes)     |
| `CamelCaseStruct`                    | Automatic snake_case wire format to camelCase           |
| `ProxyErrorData`, `FastSetErrorData` | Structured error variant schemas                        |

## Development

```bash
pnpm build        # Build this package
pnpm turbo test   # Run the repo test pipeline
```
