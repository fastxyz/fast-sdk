# fast-cli Design Spec

Date: 2026-04-01

## Context

The `fast-sdk` monorepo has a minimal CLI (`app/cli/`) using Commander.js with a
single `generate` command. The SPEC.md defines a comprehensive CLI surface for
account management, network configuration, querying, and token transfers.

This design covers rebuilding the CLI as `fast-cli` using the Effect ecosystem,
implementing the subset of commands that depend only on `@fastxyz/fast-sdk`
(no allset-sdk, no x402-sdk).

## Scope

**In scope:**

- `fast account create|import|list|set-default|info|export|delete`
- `fast network list|set-default|add|remove`
- `fast info status|balance|tx|history`
- `fast send` (Fast-to-Fast only, no bridge flags)

**Out of scope:** `fast fund`, `fast pay`, bridge operations,
`fast info bridge-tokens`, `fast info bridge-chains`.

## Architectural Approach: Thin CLI Shell

All CLI services live in `app/cli/`. The SDK (`packages/fast-sdk/`) is unchanged.
The CLI imports the SDK's effectful `core/` sub-export directly to avoid
double-wrapping (Effect -> Promise -> Effect).

## Dependencies

| Package | Purpose |
|---|---|
| `@effect/cli` | Command/option parsing, help generation |
| `@effect/platform` | FileSystem, Terminal, Path services |
| `@effect/platform-node` | Node.js implementations of platform services |
| `effect` | Core Effect runtime |
| `@noble/ciphers` | AES-256-CTR for keystore encryption |
| `@noble/hashes` | scrypt KDF, keccak256 for MAC + EVM address |
| `@noble/curves` | secp256k1 for EVM address derivation |
| `proper-lockfile` | File locking for concurrent CLI instances |
| `uuid` | V4 UUIDs for keyfile IDs |
| `@fastxyz/fast-sdk` | Signer, TransactionBuilder, core RPC functions |
| `@fastxyz/fast-schema` | Schema definitions for RPC codecs |

## Project Structure

```text
app/cli/
  package.json
  src/
    main.ts                  -- NodeRuntime.runMain entry point
    cli.ts                   -- root Command + global Options

    services/
      cli-config.ts          -- parsed global flags as Context.Tag
      account-store.ts       -- account CRUD + file locking
      keystore-v3.ts         -- AES-256-CTR + scrypt encrypt/decrypt
      network-config.ts      -- resolve/manage networks
      password-service.ts    -- flag > env > interactive prompt chain
      history-store.ts       -- local transaction history storage
      fast-rpc.ts            -- wrap SDK core effectful functions
      output.ts              -- human/JSON dual-mode rendering

    errors/
      index.ts               -- Data.TaggedError types + exit code mapping

    commands/
      account/
        create.ts
        import.ts
        list.ts
        set-default.ts
        info.ts
        export.ts
        delete.ts
        index.ts
      network/
        list.ts
        set-default.ts
        add.ts
        remove.ts
        index.ts
      info/
        status.ts
        balance.ts
        tx.ts
        history.ts
        index.ts
      send.ts

    schemas/
      accounts.ts            -- Effect Schema for accounts.json
      keyfile.ts              -- Effect Schema for V3 keyfile JSON
      networks.ts            -- Effect Schema for networks.json
      history.ts             -- Effect Schema for history.json
      output.ts              -- Effect Schema for JSON output envelope

    config/
      bundled.ts             -- hardcoded testnet/mainnet RPC URLs
```

## Service Layer

### Layer Composition

```text
NodeContext.layer (FileSystem, Terminal, Path)
  |
  +-- CliConfig.layer (from parsed global Options)
  |
  +-- KeystoreV3.Live (pure crypto, no deps)
  |
  +-- NetworkConfig.Live (<- FileSystem)
  |
  +-- PasswordService.Live (<- CliConfig, Terminal)
  |
  +-- AccountStore.Live (<- KeystoreV3, FileSystem, PasswordService)
  |
  +-- HistoryStore.Live (<- FileSystem)
  |
  +-- FastRpc.Live (<- NetworkConfig, CliConfig)
  |
  +-- Output.Live (<- CliConfig, Terminal)
```

### CliConfig

Parsed global flags stored as a Context.Tag. Built dynamically per invocation
from `@effect/cli`'s parsed options as a `Layer.succeed`.

Fields: `json`, `debug`, `nonInteractive`, `network`, `account` (Option),
`password` (Option).

### KeystoreV3

Pure crypto service. No dependencies.

- `encrypt(seed: Uint8Array, password: string)` -- generates random IV + salt,
  derives key via scrypt (n=262144, r=8, p=1, dklen=32), encrypts 32-byte seed
  with AES-256-CTR, computes MAC as keccak256(derivedKey[16:32] ++ ciphertext).
  Returns V3 keyfile JSON structure.
- `decrypt(keyfile: KeyfileJson, password: string)` -- re-derives scrypt key,
  verifies MAC, decrypts. Returns 32-byte seed. MAC mismatch produces
  `WrongPasswordError`.

Uses `@noble/hashes/scrypt` (async variant for non-blocking KDF) and
`@noble/ciphers/aes` for CTR mode.

### AccountStore

Account CRUD with file locking. Dependencies: KeystoreV3, FileSystem.

- `list()` -- read accounts.json, return entries
- `get(name)` -- find by name or fail with AccountNotFoundError
- `getDefault()` -- get default account or fail with NoAccountsError
- `create(name, seed, password)` -- encrypt seed, write keyfile, update registry
- `import_(name, seed, password)` -- same as create but with provided seed
- `setDefault(name)` -- update default in accounts.json
- `delete_(name)` -- remove keyfile + registry entry (with default account rules)
- `export_(name, password)` -- decrypt and return seed
- `resolveAccount(flag: Option<string>)` -- resolve --account flag or use default
- `nextAutoName()` -- compute next `account-N` name

File locking: acquires `proper-lockfile` lock on `~/.fast/accounts.json.lock`
via `Effect.acquireRelease` before any write operation. Reads don't need locks.

Storage path: `~/.fast/` (dir mode 0700), keyfiles at
`~/.fast/keys/<name>.json` (mode 0600), history at
`~/.fast/history.json` (mode 0600).

Both Fast and EVM addresses are derived at creation time and stored unencrypted
in the keyfile for quick lookup:

- Fast address: Ed25519 pubkey -> bech32m with `fast` prefix (via Signer)
- EVM address: secp256k1 pubkey from same seed -> keccak256 -> last 20 bytes

### NetworkConfig

Network resolution and management. Dependency: FileSystem.

- `resolve(name)` -- checks bundled configs (testnet/mainnet) first, then
  `~/.fast/networks/<name>.json`. Returns `{ rpcUrl, explorerUrl }`.
- `list()` -- returns bundled + custom network names
- `setDefault(name)` -- update default in networks.json
- `add(name, configPath)` -- copy config to ~/.fast/networks/, update registry
- `remove(name)` -- delete config file, update registry

Bundled configs are hardcoded in `config/bundled.ts`.

### PasswordService

Password resolution chain. Dependencies: CliConfig, Terminal.

1. Check `CliConfig.password` (from `--password` flag)
2. Check `process.env.FAST_PASSWORD`
3. If `CliConfig.nonInteractive` or `CliConfig.json`, fail with
   `PasswordRequiredError`
4. Otherwise, prompt via Node.js `readline` in raw mode (masked input),
   wrapped in `Effect.async`

### HistoryStore

Local transaction history. Dependency: FileSystem.

Stores completed transactions in `~/.fast/history.json`. The `send` command
calls `record()` after successful submission. The `info history` and `info tx`
commands read from this file.

- `record(entry)` -- append a transaction record (hash, from, to, amount,
  token, timestamp, network, status). File-locked via `proper-lockfile` since
  concurrent CLI instances may both be sending.
- `list(filters)` -- read history, filter by from/to/token, apply limit/offset,
  return sorted by timestamp descending.
- `getByHash(hash)` -- find a single transaction by hash, or fail with
  `TxNotFoundError`.

Each record stores: `hash`, `type` ("transfer"), `from` (fast address),
`to` (fast address), `amount` (raw units string), `formatted` (human string),
`tokenName`, `tokenId`, `network`, `status` ("confirmed"), `timestamp` (ISO),
`explorerUrl`.

The file is an append-friendly JSON array. On read, the schema validates the
full array. On write, the file is read-modify-written under lock.

### FastRpc

Effect wrapper around SDK's `core/proxy` functions. Dependencies: NetworkConfig,
CliConfig.

Constructs RPC URL from `NetworkConfig.resolve(cliConfig.network)`, then calls
SDK effectful functions directly (bypassing Promise-based `FastProvider`).

Methods: `getAccountInfo`, `submitTransaction`, `getTransactionCertificates`,
`getTokenInfo`.

### Output

Dual-mode rendering. Dependency: CliConfig, Terminal.

- `success(data)` -- JSON mode: `{ok: true, data}` to stdout. Human mode:
  delegates to formatters.
- `error(err)` -- JSON mode: `{ok: false, error: {code, message}}` to stdout.
  Human mode: message to stderr.
- `humanLine(text)` -- print line to stdout (no-op in JSON mode)
- `humanTable(headers, rows)` -- formatted table to stdout
- `confirm(message)` -- interactive prompt. Returns true in
  non-interactive/JSON mode.
- `debug(message)` -- to stderr when --debug is set

## Command Structure

### Global Options

Defined once in `cli.ts`, composed into the root command:

- `--version`, `--help` (built-in from @effect/cli)
- `--json` (boolean, default false)
- `--debug` (boolean, default false)
- `--non-interactive` (boolean, default false)
- `--network` (string, default "testnet")
- `--account` (optional string)
- `--password` (optional string)

### Command Tree

```text
fast (root, global options)
  +-- account
  |     +-- create [--name]
  |     +-- import [--name] [--private-key | --key-file]
  |     +-- list
  |     +-- set-default <name>
  |     +-- info [name]
  |     +-- export [name]
  |     +-- delete <name>
  +-- network
  |     +-- list
  |     +-- set-default <name>
  |     +-- add <name> --config <path>
  |     +-- remove <name>
  +-- info
  |     +-- status
  |     +-- balance [--address] [--token]
  |     +-- tx <hash> (looks up from local history)
  |     +-- history [--from] [--to] [--token] [--limit] [--offset] (local history, no remote API)
  +-- send <address> <amount> [--token]
```

### Command Pattern

Each command is an Effect.gen that yields services from context:

```typescript
export const accountCreate = Command.make("create", { name }, (args) =>
  Effect.gen(function* () {
    const accounts = yield* AccountStore
    const password = yield* PasswordService
    const output = yield* Output
    // ... business logic
    yield* output.success(data)
  })
)
```

Global options flow into CliConfig via the root command handler, which wraps
subcommand execution with `Effect.provide(CliConfig.layer(globalOpts))`.

## Error Handling

### Error Types

All extend `Data.TaggedError`:

| Error Tag | Exit Code | Triggers |
|---|---|---|
| `StorageError` | 1 | can't read/write ~/.fast/ |
| `InvalidUsageError` | 2 | bad flags, format, missing args |
| `AccountExistsError` | 2 | name already taken |
| `ReservedNameError` | 2 | testnet/mainnet can't be modified |
| `InvalidConfigError` | 2 | bad network config file |
| `AccountNotFoundError` | 3 | named account doesn't exist |
| `NoAccountsError` | 3 | no accounts and no name given |
| `InsufficientBalanceError` | 4 | not enough tokens |
| `NetworkError` | 5 | RPC unreachable/timeout |
| `TxNotFoundError` | 1 | hash not in local history |
| `TransactionFailedError` | 6 | rejected by network |
| `UserCancelledError` | 7 | declined interactive prompt |
| `PasswordRequiredError` | 8 | no password in non-interactive |
| `WrongPasswordError` | 8 | MAC mismatch on decrypt |

### Top-level Error Handler

In `main.ts`, the entire CLI effect is wrapped with `Effect.catchAll`:

1. Maps `error._tag` to exit code via lookup table (default: 1)
2. JSON mode: writes `{ok: false, error: {code, message}}` to stdout
3. Human mode: prints message to stderr
4. Exits with mapped code

## Schemas

### accounts.json

```typescript
Schema.Struct({
  default: Schema.NullOr(Schema.String),
  accounts: Schema.Array(Schema.Struct({
    name: Schema.String,
    createdAt: Schema.String,
  })),
})
```

### Keyfile V3 (`~/.fast/keys/<name>.json`)

```typescript
Schema.Struct({
  version: Schema.Literal(3),
  id: Schema.String,
  fastAddress: Schema.String,
  evmAddress: Schema.String,
  crypto: Schema.Struct({
    cipher: Schema.Literal("aes-256-ctr"),
    cipherparams: Schema.Struct({ iv: Schema.String }),
    ciphertext: Schema.String,
    kdf: Schema.Literal("scrypt"),
    kdfparams: Schema.Struct({
      dklen: Schema.Literal(32),
      n: Schema.Number, r: Schema.Number, p: Schema.Number,
      salt: Schema.String,
    }),
    mac: Schema.String,
  }),
  createdAt: Schema.String,
})
```

### networks.json

```typescript
Schema.Struct({
  default: Schema.String,
  networks: Schema.Array(Schema.String),
})
```

### history.json

```typescript
Schema.Array(Schema.Struct({
  hash: Schema.String,
  type: Schema.Literal("transfer"),
  from: Schema.String,
  to: Schema.String,
  amount: Schema.String,
  formatted: Schema.String,
  tokenName: Schema.String,
  tokenId: Schema.String,
  network: Schema.String,
  status: Schema.String,
  timestamp: Schema.String,
  explorerUrl: Schema.NullOr(Schema.String),
}))
```

### Output Envelope

```typescript
// Success: { ok: true, data: <per-command> }
// Error:   { ok: false, error: { code: string, message: string } }
```

## Key Decisions

1. **Single seed, dual addresses.** The 32-byte Ed25519 seed is reused as a
   secp256k1 private key. EVM address = keccak256(secp256k1_uncompressed_pubkey)
   last 20 bytes. Both addresses stored unencrypted in keyfile.

2. **SDK used via core/ sub-export.** The CLI imports `@fastxyz/fast-sdk/core`
   for effectful functions, avoiding the Promise-wrapping in the public API.

3. **File locking via proper-lockfile.** Protects concurrent CLI instance writes
   to accounts.json. Uses `Effect.acquireRelease` for scoped lock management.

4. **EVM address derivation uses @noble/curves.** secp256k1 from
   `@noble/curves/secp256k1`, keccak256 from `@noble/hashes/sha3`.

5. **Password masking** via Node.js readline in raw mode, wrapped in
   Effect.async. `@effect/platform` Terminal doesn't support masked input
   natively.

## Verification

1. `pnpm build` -- CLI builds to `app/cli/dist/index.js` with shebang
2. `./dist/index.js --help` -- shows command tree
3. `./dist/index.js account create --name test` -- prompts for password,
   creates `~/.fast/keys/test.json` and updates `~/.fast/accounts.json`
4. `./dist/index.js account list` -- shows created account
5. `./dist/index.js account list --json` -- outputs JSON envelope
6. `./dist/index.js account export test` -- prompts password, shows key
7. `./dist/index.js info balance --json` -- queries testnet RPC
8. `./dist/index.js send fast1... 1.0 --token USDC --json` -- Fast-to-Fast
9. Exit codes match SPEC (test wrong password -> 8, missing account -> 3, etc.)
10. Concurrent `account create` calls don't corrupt accounts.json (file lock)
