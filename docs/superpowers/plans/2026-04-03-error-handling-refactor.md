<!-- markdownlint-disable MD013 -->
# Error handling refactor + migration tech debt

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the 4 tech debts logged during the citty migration, split the overgrown [app/cli/src/errors/index.ts](app/cli/src/errors/index.ts) by domain, and strip redundant `Effect.mapError` calls at the command layer so typed service errors propagate cleanly to `runHandler`.

**Architecture:** Services keep their typed error channels (`StorageError`, `NetworkError`, `AccountNotFoundError`, etc.). The per-operation `.pipe(Effect.mapError(e => new StorageError({message, cause: e})))` boilerplate becomes a `mapToStorageError(operation)` helper in `errors/helpers.ts`. Command handlers stop re-wrapping service errors into new types — `runHandler`'s `catchAll` already maps every `CliError` to the right exit code + JSON envelope uniformly, so intermediate remaps only destroy information.

**Tech Stack:** TypeScript, Effect 3.x, citty, tsup, pnpm workspaces.

---

## Context

Three things prompted this refactor:

1. **Four pieces of tech debt logged during the citty migration** (see end of migration plan). They range from a genuine `--json` regression introduced by switching away from `@effect/cli`, to pre-existing bugs that the migration simply preserved.

2. **`app/cli/src/errors/index.ts` is 243 lines** — 24 error classes, a `CliError` union, and two lookup maps. It's become awkward to navigate and review. Splitting by domain (account / network / transaction / io / usage) makes each file hold related errors and keeps related fields/messages near each other.

3. **`Effect.mapError` is used 27 times across the codebase.** Some uses are legitimate (converting `FileSystem` errors to `StorageError` at service boundaries, converting SDK errors to `NetworkError` at the RPC boundary). Others just re-wrap a typed error into another typed error at the command layer (e.g. [send.ts:122](app/cli/src/commands/send.ts) turns `StorageError | NetworkNotFoundError` into `TransactionFailedError`, losing the original type). And at the service layer the same ~10-line mapError block is copy-pasted across `account-store.ts`, `network-config.ts`, `history-store.ts`. The refactor keeps the service-boundary pattern (which is correct and load-bearing) but replaces the boilerplate with a helper, and strips the command-layer re-wrapping entirely.

---

## Design rationale

**Why keep typed service errors?** `runHandler` looks up the exit code via `err._tag` in `exitCodeMap`. Every error needs a distinct `_tag` to map to a distinct exit code. Removing typed errors would collapse exit-code behaviour. Keep the typing; just stop *over-mapping*.

**Why strip command-layer mapError?** There are no `Effect.catchTag` branches anywhere in the command handlers. The typed error channel is used only for terminal exit-code mapping in `runHandler`. Given that, extra mapError calls at the command layer provide zero information gain — they just rename a typed error to another typed error before it reaches the single point of handling.

**Why keep `mapNetworkError` in fast-rpc.ts?** It IS the boundary — it converts SDK promise-rejections (untyped) into typed `NetworkError` for the caller. That's where the conversion needs to happen. No change needed there.

**Why split errors/index.ts by domain (not by exit code)?** Exit codes form a flat numeric taxonomy (1-8) that doesn't match how developers reason about errors. Errors cluster naturally by the subsystem they describe: account-related errors are thought about together, network-related errors are thought about together. The `exitCodeMap` stays in `index.ts` where it already lives.

---

## File structure

**New files:**

- `app/cli/src/errors/account.ts` — `AccountExistsError`, `AccountNotFoundError`, `NoAccountsError`, `DefaultAccountError`, `PasswordRequiredError`, `WrongPasswordError`
- `app/cli/src/errors/network.ts` — `NetworkExistsError`, `NetworkNotFoundError`, `NetworkError`, `DefaultNetworkError`, `ReservedNameError`, `InvalidConfigError`, `UnsupportedChainError`
- `app/cli/src/errors/transaction.ts` — `TxNotFoundError`, `TransactionFailedError`, `InvalidAddressError`, `InvalidAmountError`, `InsufficientBalanceError`, `InsufficientGasError`, `TokenNotFoundError`
- `app/cli/src/errors/io.ts` — `StorageError`
- `app/cli/src/errors/usage.ts` — `InvalidUsageError`, `NotImplementedError`, `UserCancelledError`
- `app/cli/src/errors/helpers.ts` — `mapToStorageError(operation: string)` Effect pipe helper

**Rewritten:** `app/cli/src/errors/index.ts` — re-exports from the 5 domain files + `CliError` union + `exitCodeMap`/`errorCodeMap`/`toExitCode`/`toErrorCode` (unchanged logic, just no class definitions).

**Unchanged import paths:** All existing files import from `'../errors/index.js'` (or similar); the re-exports keep those imports working.

**Modified (tech debt + mapError cleanup):**

- `app/cli/src/main.ts` — `--json` CLIError regression fix
- `app/cli/src/commands/account/import.ts` — wrap `readFileSync`/`JSON.parse` in `Effect.try`
- `app/cli/src/commands/network/add.ts` — remove redundant `existsSync` guard
- `app/cli/src/commands/info/status.ts` — fix try/catch + `sender`→`address` typo
- `app/cli/src/commands/send.ts` — remove `mapError` at line 122 (let service errors propagate)
- `app/cli/src/services/account-store.ts` — use `mapToStorageError` helper (8 sites)
- `app/cli/src/services/network-config.ts` — use `mapToStorageError` helper (8-10 sites)
- `app/cli/src/services/history-store.ts` — use `mapToStorageError` helper (5 sites)

---

## Task 1: Fix `--json` envelope for citty CLIError paths

**Files:** Modify `app/cli/src/main.ts`

**Problem:** When citty's argument parser fails (missing positional, unknown command), `runMain` prints to stderr + exits 1. `--json` callers get plain text instead of a structured envelope — a regression from the `@effect/cli`-based `main.ts`.

**Fix:** Replace `runMain` with lower-level `runCommand` + manual `--help`/`--version` handling, catching any error and writing a JSON envelope when `--json` is present.

- [ ] **Step 1.1: Rewrite `app/cli/src/main.ts`**

Overwrite the entire file with:

```typescript
import { runCommand, showUsage } from 'citty';
import { rootCommand } from './cli.js';

const rawArgs = process.argv.slice(2);
const isJson = rawArgs.includes('--json');
const isHelp = rawArgs.includes('--help') || rawArgs.includes('-h');
const isVersion = rawArgs.includes('--version') || rawArgs.includes('-v');

const main = async (): Promise<void> => {
  if (isVersion) {
    process.stdout.write(`${rootCommand.meta?.version ?? ''}\n`);
    return;
  }
  if (rawArgs.length === 0 || isHelp) {
    await showUsage(rootCommand);
    return;
  }
  await runCommand(rootCommand, { rawArgs });
};

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  const code =
    err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : 'INVALID_USAGE';
  if (isJson) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, error: { code, message } }, null, 2)}\n`,
    );
  } else {
    showUsage(rootCommand).catch(() => {});
    process.stderr.write(`Error: ${message}\n`);
  }
  process.exit(1);
});
```

- [ ] **Step 1.2: Build and smoke-test**

```bash
cd /home/yuqing/Documents/Code/fast-sdk && pnpm -F @fastxyz/fast-cli build
node app/cli/dist/main.js --help | head -5
node app/cli/dist/main.js --version
node app/cli/dist/main.js send --json 2>&1 ; echo "EXIT=$?"
node app/cli/dist/main.js bogus 2>&1 ; echo "EXIT=$?"
```

Expected:

- Build success
- `--help` prints usage
- `--version` prints `0.1.0`
- `send --json` (missing positional) prints JSON envelope on stdout with `EXIT=1`
- `bogus` (unknown command) prints usage+error on stderr with `EXIT=1`

- [ ] **Step 1.3: Commit**

```bash
git add app/cli/src/main.ts
git commit -m "fix(fast-cli): restore --json envelope for citty arg-parsing errors"
```

---

## Task 2: Wrap filesystem reads in `account/import.ts` with `Effect.try`

**Files:** Modify `app/cli/src/commands/account/import.ts`

**Problem:** Bare `readFileSync` and `JSON.parse` inside `Effect.gen` escape Effect's typed error channel. Failures surface via `catchAllDefect` as generic `UNKNOWN_ERROR` instead of `InvalidUsageError`.

**Fix:** Wrap both calls in `Effect.try`.

- [ ] **Step 2.1: Edit `app/cli/src/commands/account/import.ts`**

Find this block (the `else if (args['key-file'])` branch):

```typescript
} else if (args['key-file']) {
  const content = readFileSync(args['key-file'], 'utf-8');
  const parsed = JSON.parse(content) as { privateKey?: string };
  if (!parsed.privateKey) {
    return yield* Effect.fail(new InvalidUsageError({ message: "Key file must contain a 'privateKey' field" }));
  }
  seed = fromHex(parsed.privateKey);
  if (seed.length !== 32) {
    return yield* Effect.fail(new InvalidUsageError({ message: 'Private key must be exactly 32 bytes (64 hex characters)' }));
  }
```

Replace with:

```typescript
} else if (args['key-file']) {
  const keyFilePath = args['key-file'];
  const content = yield* Effect.try({
    try: () => readFileSync(keyFilePath, 'utf-8'),
    catch: (e) =>
      new InvalidUsageError({
        message: `Cannot read key file: ${e instanceof Error ? e.message : String(e)}`,
      }),
  });
  const parsed = yield* Effect.try({
    try: () => JSON.parse(content) as { privateKey?: string },
    catch: () => new InvalidUsageError({ message: 'Key file is not valid JSON' }),
  });
  if (!parsed.privateKey) {
    return yield* Effect.fail(new InvalidUsageError({ message: "Key file must contain a 'privateKey' field" }));
  }
  seed = fromHex(parsed.privateKey);
  if (seed.length !== 32) {
    return yield* Effect.fail(new InvalidUsageError({ message: 'Private key must be exactly 32 bytes (64 hex characters)' }));
  }
```

(The `keyFilePath` alias avoids repeating the non-null assertion on `args['key-file']`.)

- [ ] **Step 2.2: Build and smoke-test**

```bash
cd /home/yuqing/Documents/Code/fast-sdk && pnpm -F @fastxyz/fast-cli build
node app/cli/dist/main.js account import --key-file /nonexistent.json --name test --password pw --non-interactive --json 2>&1
echo "EXIT=$?"
```

Expected: JSON envelope with `INVALID_USAGE` error code on stdout, `EXIT=2`.

- [ ] **Step 2.3: Commit**

```bash
git add app/cli/src/commands/account/import.ts
git commit -m "fix(fast-cli): wrap key-file IO in Effect.try for typed errors"
```

---

## Task 3: Remove redundant `existsSync` guard in `network/add.ts`

**Files:** Modify `app/cli/src/commands/network/add.ts`

**Problem:** The `existsSync` check produces `InvalidUsageError` only for file-not-found. `NetworkConfigService.add()` independently reads the file and produces `InvalidConfigError` for any file access failure. Two different error classes for adjacent failure modes.

**Fix:** Delete the guard. Let the service handle all file access failures uniformly with `InvalidConfigError`.

- [ ] **Step 3.1: Edit `app/cli/src/commands/network/add.ts`**

Remove these three lines from the handler body:

```typescript
if (!existsSync(args.config)) {
  return yield* Effect.fail(new InvalidUsageError({ message: `Config file not found: ${args.config}` }));
}
```

Remove these imports (now unused):

```typescript
import { existsSync } from 'node:fs';
import { InvalidUsageError } from '../../errors/index.js';
```

The final file should look like:

```typescript
import { defineCommand } from 'citty';
import { Effect } from 'effect';
import { globalArgs } from '../../cli-globals.js';
import { runHandler } from '../../cli-runner.js';
import { NetworkConfigService } from '../../services/network-config.js';
import { Output } from '../../services/output.js';

export const networkAdd = defineCommand({
  meta: { name: 'add', description: 'Add a custom network config' },
  args: {
    ...globalArgs,
    name: {
      type: 'positional',
      description: 'Name for the custom network',
      required: true,
    },
    config: {
      type: 'string',
      description: 'Path to network config JSON file',
      required: true,
    },
  },
  run: ({ args }) => runHandler(args, Effect.gen(function* () {
    const networkConfig = yield* NetworkConfigService;
    const output = yield* Output;

    yield* networkConfig.add(args.name, args.config);

    yield* output.humanLine(`Added network "${args.name}"`);
    yield* output.success({ name: args.name });
  })),
});
```

- [ ] **Step 3.2: Build and smoke-test**

```bash
cd /home/yuqing/Documents/Code/fast-sdk && pnpm -F @fastxyz/fast-cli build
node app/cli/dist/main.js network add testnet2 /nonexistent.json --json 2>&1
echo "EXIT=$?"
```

Expected: JSON envelope with `INVALID_CONFIG` error code, `EXIT=2`.

- [ ] **Step 3.3: Commit**

```bash
git add app/cli/src/commands/network/add.ts
git commit -m "refactor(fast-cli): defer file validation to NetworkConfig.add"
```

---

## Task 4: Fix `info/status.ts` try/catch and `sender`→`address` typo

**Files:** Modify `app/cli/src/commands/info/status.ts`

**Problem:** `try/catch` around `yield* rpc.getAccountInfo(...)` doesn't catch Effect failures (Effects short-circuit via the generator protocol, not JS exceptions). Any RPC error kills the handler instead of reporting "✗ unreachable". The call also uses `{ sender: ... }` but the schema expects `{ address: ... }` — the try/catch was masking this typo.

**Fix:** Replace try/catch with `Effect.catchAll`. Fix field name to `address`.

- [ ] **Step 4.1: Edit `app/cli/src/commands/info/status.ts`**

Find this block:

```typescript
const network = yield* networkConfig.resolve(config.network).pipe(Effect.mapError((e) => e));

let healthy = false;
try {
  yield* rpc.getAccountInfo({ sender: new Uint8Array(32) });
  healthy = true;
} catch {
  // unreachable, report in UI
}
```

Replace with:

```typescript
const network = yield* networkConfig.resolve(config.network);

const healthy = yield* rpc
  .getAccountInfo({
    address: new Uint8Array(32),
    tokenBalancesFilter: null,
    stateKeyFilter: null,
    certificateByNonce: null,
  } as never)
  .pipe(
    Effect.map(() => true),
    Effect.catchAll(() => Effect.succeed(false)),
  );
```

**Note on the `as never` cast:** `GetAccountInfoParams.address` expects a branded `Uint8Array32 & Address` type. `info/balance.ts` currently passes an unbranded `Uint8Array` to the same call and produces a pre-existing type error (per the migration baseline — 19 total errors). The `as never` cast here *silences* the type error at this one site because we know a zeroed 32-byte buffer is a valid dummy for the health check; we do NOT propagate the silencing to balance.ts (that's separate domain work). If the team later adds a proper constructor or brand-nominal helper, this cast becomes the natural upgrade site. The removal of the no-op `Effect.mapError((e) => e)` is safe — the error channel is `StorageError | NetworkNotFoundError` either way.

- [ ] **Step 4.2: Build and smoke-test**

```bash
cd /home/yuqing/Documents/Code/fast-sdk && pnpm -F @fastxyz/fast-cli build
node app/cli/dist/main.js info status --json 2>&1 | head -20
echo "EXIT=$?"
```

Expected: JSON with `"healthy": true` (if the RPC is reachable) or `"healthy": false` (if not), `EXIT=0` either way (the command itself succeeds regardless of network health).

- [ ] **Step 4.3: Commit**

```bash
git add app/cli/src/commands/info/status.ts
git commit -m "fix(fast-cli): catch RPC failures with Effect and fix address field"
```

---

## Task 5: Split `errors/index.ts` by domain + add `mapToStorageError` helper

**Files:**

- Create: `app/cli/src/errors/account.ts`, `network.ts`, `transaction.ts`, `io.ts`, `usage.ts`, `helpers.ts`
- Modify: `app/cli/src/errors/index.ts`

**Problem:** `errors/index.ts` is 243 lines with 24 error classes + lookup maps. Hard to scan. Storage-error mapping is also repeated 20+ times across services; a helper would cut boilerplate.

**Fix:** Split error classes into 5 domain files, add a `helpers.ts` module with `mapToStorageError`, rewrite `index.ts` as a re-export + union + mappings file.

- [ ] **Step 5.1: Create `app/cli/src/errors/io.ts`**

```typescript
import { Data } from 'effect';

/** File I/O, lock, or persistence failure. */
export class StorageError extends Data.TaggedError('StorageError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}
```

- [ ] **Step 5.2: Create `app/cli/src/errors/account.ts`**

```typescript
import { Data } from 'effect';

export class AccountExistsError extends Data.TaggedError('AccountExistsError')<{
  readonly name: string;
}> {
  get message() {
    return `Account "${this.name}" already exists`;
  }
}

export class AccountNotFoundError extends Data.TaggedError('AccountNotFoundError')<{
  readonly name: string;
}> {
  get message() {
    return `Account "${this.name}" not found`;
  }
}

export class NoAccountsError extends Data.TaggedError('NoAccountsError')<Record<string, never>> {
  get message() {
    return 'No accounts found. Create one with `fast account create`.';
  }
}

export class DefaultAccountError extends Data.TaggedError('DefaultAccountError')<{
  readonly name: string;
}> {
  get message() {
    return `Cannot delete "${this.name}" because it is the default account. Use \`fast account set-default\` first.`;
  }
}

export class PasswordRequiredError extends Data.TaggedError('PasswordRequiredError')<Record<string, never>> {
  get message() {
    return 'Password required. Use --password, FAST_PASSWORD env var, or run in interactive mode.';
  }
}

export class WrongPasswordError extends Data.TaggedError('WrongPasswordError')<Record<string, never>> {
  get message() {
    return 'Incorrect password';
  }
}
```

- [ ] **Step 5.3: Create `app/cli/src/errors/network.ts`**

```typescript
import { Data } from 'effect';

export class NetworkExistsError extends Data.TaggedError('NetworkExistsError')<{
  readonly name: string;
}> {
  get message() {
    return `Network "${this.name}" already exists`;
  }
}

export class NetworkNotFoundError extends Data.TaggedError('NetworkNotFoundError')<{
  readonly name: string;
}> {
  get message() {
    return `Network "${this.name}" not found`;
  }
}

export class NetworkError extends Data.TaggedError('NetworkError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class DefaultNetworkError extends Data.TaggedError('DefaultNetworkError')<{
  readonly name: string;
}> {
  get message() {
    return `Cannot remove "${this.name}" because it is the default network. Use \`fast network set-default\` first.`;
  }
}

export class ReservedNameError extends Data.TaggedError('ReservedNameError')<{
  readonly name: string;
}> {
  get message() {
    return `"${this.name}" is a reserved name and cannot be modified`;
  }
}

export class InvalidConfigError extends Data.TaggedError('InvalidConfigError')<{
  readonly message: string;
}> {}

export class UnsupportedChainError extends Data.TaggedError('UnsupportedChainError')<{
  readonly chain: string;
}> {
  get message() {
    return `Unsupported chain "${this.chain}". Run \`fast info bridge-chains\` to list supported chains.`;
  }
}
```

- [ ] **Step 5.4: Create `app/cli/src/errors/transaction.ts`**

```typescript
import { Data } from 'effect';

export class TxNotFoundError extends Data.TaggedError('TxNotFoundError')<{
  readonly hash: string;
}> {
  get message() {
    return `Transaction not found: ${this.hash}`;
  }
}

export class TransactionFailedError extends Data.TaggedError('TransactionFailedError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class InvalidAddressError extends Data.TaggedError('InvalidAddressError')<{
  readonly message: string;
}> {}

export class InvalidAmountError extends Data.TaggedError('InvalidAmountError')<{
  readonly message: string;
}> {}

export class InsufficientBalanceError extends Data.TaggedError('InsufficientBalanceError')<{
  readonly message: string;
}> {}

export class InsufficientGasError extends Data.TaggedError('InsufficientGasError')<{
  readonly message: string;
}> {}

export class TokenNotFoundError extends Data.TaggedError('TokenNotFoundError')<{
  readonly token: string;
}> {
  get message() {
    return `Unknown token "${this.token}". Run \`fast info bridge-tokens\` to list supported tokens.`;
  }
}
```

- [ ] **Step 5.5: Create `app/cli/src/errors/usage.ts`**

```typescript
import { Data } from 'effect';

export class InvalidUsageError extends Data.TaggedError('InvalidUsageError')<{
  readonly message: string;
}> {}

export class NotImplementedError extends Data.TaggedError('NotImplementedError')<{
  readonly message: string;
}> {}

export class UserCancelledError extends Data.TaggedError('UserCancelledError')<Record<string, never>> {
  get message() {
    return 'Operation cancelled by user';
  }
}
```

- [ ] **Step 5.6: Create `app/cli/src/errors/helpers.ts`**

```typescript
import { Effect } from 'effect';
import { StorageError } from './io.js';

/**
 * Pipe operator that maps any error from a file I/O / persistence operation
 * to a `StorageError` with a caller-supplied operation description.
 *
 * Usage:
 *   yield* fs.readFileString(path).pipe(mapToStorageError('read accounts.json'));
 */
export const mapToStorageError = (operation: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, StorageError, R> =>
    effect.pipe(
      Effect.mapError((cause) => new StorageError({ message: `Failed to ${operation}`, cause })),
    );
```

- [ ] **Step 5.7: Rewrite `app/cli/src/errors/index.ts`**

Overwrite the entire file with:

```typescript
export * from './account.js';
export * from './network.js';
export * from './transaction.js';
export * from './io.js';
export * from './usage.js';
export * from './helpers.js';

import type { AccountExistsError, AccountNotFoundError, DefaultAccountError, NoAccountsError, PasswordRequiredError, WrongPasswordError } from './account.js';
import type { DefaultNetworkError, InvalidConfigError, NetworkError, NetworkExistsError, NetworkNotFoundError, ReservedNameError, UnsupportedChainError } from './network.js';
import type { InsufficientBalanceError, InsufficientGasError, InvalidAddressError, InvalidAmountError, TokenNotFoundError, TransactionFailedError, TxNotFoundError } from './transaction.js';
import type { StorageError } from './io.js';
import type { InvalidUsageError, NotImplementedError, UserCancelledError } from './usage.js';

export type CliError =
  | StorageError
  | TxNotFoundError
  | InvalidUsageError
  | AccountExistsError
  | ReservedNameError
  | NetworkExistsError
  | InvalidConfigError
  | InvalidAddressError
  | InvalidAmountError
  | TokenNotFoundError
  | UnsupportedChainError
  | NotImplementedError
  | AccountNotFoundError
  | NoAccountsError
  | InsufficientBalanceError
  | InsufficientGasError
  | NetworkError
  | TransactionFailedError
  | UserCancelledError
  | PasswordRequiredError
  | WrongPasswordError
  | DefaultAccountError
  | DefaultNetworkError
  | NetworkNotFoundError;

const exitCodeMap: Record<string, number> = {
  StorageError: 1,
  TxNotFoundError: 1,
  InvalidUsageError: 2,
  AccountExistsError: 2,
  ReservedNameError: 2,
  NetworkExistsError: 2,
  InvalidConfigError: 2,
  InvalidAddressError: 2,
  InvalidAmountError: 2,
  TokenNotFoundError: 2,
  UnsupportedChainError: 2,
  NotImplementedError: 2,
  DefaultAccountError: 2,
  DefaultNetworkError: 2,
  AccountNotFoundError: 3,
  NoAccountsError: 3,
  InsufficientBalanceError: 4,
  InsufficientGasError: 4,
  NetworkError: 5,
  TransactionFailedError: 6,
  UserCancelledError: 7,
  PasswordRequiredError: 8,
  WrongPasswordError: 8,
  NetworkNotFoundError: 2,
};

export const toExitCode = (error: { readonly _tag: string }): number => exitCodeMap[error._tag] ?? 1;

const errorCodeMap: Record<string, string> = {
  StorageError: 'STORAGE_ERROR',
  TxNotFoundError: 'TX_NOT_FOUND',
  InvalidUsageError: 'INVALID_USAGE',
  AccountExistsError: 'ACCOUNT_EXISTS',
  ReservedNameError: 'RESERVED_NAME',
  NetworkExistsError: 'NETWORK_EXISTS',
  InvalidConfigError: 'INVALID_CONFIG',
  InvalidAddressError: 'INVALID_ADDRESS',
  InvalidAmountError: 'INVALID_AMOUNT',
  TokenNotFoundError: 'TOKEN_NOT_FOUND',
  UnsupportedChainError: 'UNSUPPORTED_CHAIN',
  NotImplementedError: 'NOT_IMPLEMENTED',
  DefaultAccountError: 'DEFAULT_ACCOUNT',
  DefaultNetworkError: 'DEFAULT_NETWORK',
  AccountNotFoundError: 'ACCOUNT_NOT_FOUND',
  NoAccountsError: 'NO_ACCOUNTS',
  InsufficientBalanceError: 'INSUFFICIENT_BALANCE',
  InsufficientGasError: 'INSUFFICIENT_GAS',
  NetworkError: 'NETWORK_ERROR',
  TransactionFailedError: 'TX_FAILED',
  UserCancelledError: 'USER_CANCELLED',
  PasswordRequiredError: 'PASSWORD_REQUIRED',
  WrongPasswordError: 'WRONG_PASSWORD',
  NetworkNotFoundError: 'NETWORK_NOT_FOUND',
};

export const toErrorCode = (error: { readonly _tag: string }): string => errorCodeMap[error._tag] ?? 'UNKNOWN_ERROR';
```

- [ ] **Step 5.8: Build + type-check**

```bash
cd /home/yuqing/Documents/Code/fast-sdk && pnpm -F @fastxyz/fast-cli build
npx --no-install tsc --noEmit -p app/cli/tsconfig.json 2>&1 | grep "error TS" | grep "errors/" || echo "no errors in errors/"
```

Expected: `Build success` and "no errors in errors/". All existing imports from `'../errors/index.js'` (or `'../../errors/index.js'`) continue to work via the re-exports.

- [ ] **Step 5.9: Commit**

```bash
git add app/cli/src/errors/
git commit -m "refactor(fast-cli): split errors by domain and add mapToStorageError helper"
```

---

## Task 6: Apply `mapToStorageError` across storage services

**Files:** Modify `app/cli/src/services/account-store.ts`, `app/cli/src/services/network-config.ts`, `app/cli/src/services/history-store.ts`

**Problem:** 20+ repetitions of the same 6-line `Effect.mapError(e => new StorageError({ message: '...', cause: e }))` block.

**Fix:** Replace each with `.pipe(mapToStorageError('<operation>'))`.

- [ ] **Step 6.1: Refactor `account-store.ts`**

Add the import (alongside other `../errors/index.js` imports):

```typescript
import { mapToStorageError } from '../errors/index.js';
```

Replace each `.pipe(Effect.mapError((e) => new StorageError({ message: '...', cause: e })))` with `.pipe(mapToStorageError('<operation>'))`. The `operation` string should match the existing message with the "Failed to " prefix removed. Specifically:

| Existing message | Helper call |
| --- | --- |
| "Failed to create directory: ${path}" | `mapToStorageError(\`create directory: ${path}\`)` |
| "Failed to read accounts.json" | `mapToStorageError('read accounts.json')` |
| "Failed to write accounts.json" | `mapToStorageError('write accounts.json')` |
| "Failed to read keyfile for \"${name}\"" | `` mapToStorageError(`read keyfile for "${name}"`) `` |
| "Failed to write keyfile for \"${name}\"" | `` mapToStorageError(`write keyfile for "${name}"`) `` |
| "Failed to check if keyfile exists" | `mapToStorageError('check if keyfile exists')` |
| (account-store.ts:280 KeystoreV3 wrap) | `mapToStorageError('encrypt seed')` |
| "Failed to delete keyfile" | `mapToStorageError('delete keyfile')` |

Example transformation — before:

```typescript
}).pipe(
  Effect.mapError(
    (e) =>
      new StorageError({
        message: "Failed to read accounts.json",
        cause: e,
      }),
  ),
);
```

After:

```typescript
}).pipe(mapToStorageError('read accounts.json'));
```

- [ ] **Step 6.2: Refactor `network-config.ts`**

Same pattern. The `add()` method has TWO mapError blocks that map to `InvalidConfigError` (lines 197-203, 205-213) — **leave those alone**, they're NOT storage errors. Only replace the `StorageError` mapErrors:

| Existing message | Helper call |
| --- | --- |
| "Failed to create directory: ${path}" | `mapToStorageError(\`create directory: ${path}\`)` |
| "Failed to read networks.json" | `mapToStorageError('read networks.json')` |
| "Failed to write networks.json" | `mapToStorageError('write networks.json')` |
| "Failed to check if network config exists" | `mapToStorageError('check if network config exists')` |
| "Failed to read network config" | `mapToStorageError('read network config')` |
| "Failed to decode network config" | `mapToStorageError('decode network config')` |
| "Failed to write network config" | `mapToStorageError('write network config')` |
| "Failed to remove network config" | `mapToStorageError('remove network config')` |

Add the import alongside existing error imports.

- [ ] **Step 6.3: Refactor `history-store.ts`**

Same pattern. Replace 5 sites:

| Existing message | Helper call |
| --- | --- |
| "Failed to create directory: ${path}" | `mapToStorageError(\`create directory: ${path}\`)` |
| "Failed to read history.json" | `mapToStorageError('read history.json')` |
| "Failed to write history.json" | `mapToStorageError('write history.json')` |
| "Failed to check if history file exists" | `mapToStorageError('check if history file exists')` (both occurrences) |

Add the import.

- [ ] **Step 6.4: Build + verify no type regressions**

```bash
cd /home/yuqing/Documents/Code/fast-sdk && pnpm -F @fastxyz/fast-cli build
npx --no-install tsc --noEmit -p app/cli/tsconfig.json 2>&1 | grep "error TS" | grep -E "account-store|network-config|history-store" || echo "no errors in storage services"
```

Expected: build success, no new errors in the three modified services.

- [ ] **Step 6.5: Smoke-test read/write paths**

```bash
# Read path
node app/cli/dist/main.js account list --json
node app/cli/dist/main.js network list --json

# Error path (invalid path → StorageError → exit 1)
node app/cli/dist/main.js account list --json | grep '"ok"'
```

Expected: `"ok": true` for the normal read paths. Errors should produce valid JSON with `STORAGE_ERROR` code if thrown.

- [ ] **Step 6.6: Commit**

```bash
git add app/cli/src/services/account-store.ts app/cli/src/services/network-config.ts app/cli/src/services/history-store.ts
git commit -m "refactor(fast-cli): use mapToStorageError helper in storage services"
```

---

## Task 7: Remove redundant command-layer mapError calls

**Files:** Modify `app/cli/src/commands/send.ts`

**Problem:** `send.ts` line 122 maps `StorageError | NetworkNotFoundError` to `TransactionFailedError`, losing the specific error type. Since `runHandler` routes both to distinct exit codes via `exitCodeMap`, the remap is pure information loss.

**Fix:** Remove the `.pipe(Effect.mapError(...))` from the `networkConfig.resolve(config.network)` call. The returned `StorageError | NetworkNotFoundError` flows naturally through `CliError` to `runHandler`.

- [ ] **Step 7.1: Edit `app/cli/src/commands/send.ts`**

Find:

```typescript
// Resolve network
const network = yield* networkConfig
  .resolve(config.network)
  .pipe(Effect.mapError((e) => new TransactionFailedError({ message: e.message, cause: e })));
```

Replace with:

```typescript
// Resolve network
const network = yield* networkConfig.resolve(config.network);
```

**Do NOT touch** the other two mapError calls in send.ts:

- The `Effect.try`-based one at ~lines 133-140 (token-resolver wrapping) — this is tied to `resolveToken` throwing sync exceptions; refactoring that is out of scope for this plan.
- The schema decode mapError at ~line 305 — schema failure during bridge execution IS a tx failure; the remap is semantically accurate.

- [ ] **Step 7.2: Remove `TransactionFailedError` from imports if no longer needed**

After the edit, check if `TransactionFailedError` is still used elsewhere in `send.ts`:

```bash
grep -n "TransactionFailedError" app/cli/src/commands/send.ts
```

If it appears only in the `import {...}` statement, remove it from the import. If it's still used (likely — the token-resolver wrapper and schema-decode mapError still reference it), leave the import.

- [ ] **Step 7.3: Build + type-check**

```bash
cd /home/yuqing/Documents/Code/fast-sdk && pnpm -F @fastxyz/fast-cli build
npx --no-install tsc --noEmit -p app/cli/tsconfig.json 2>&1 | grep "error TS" | grep "commands/send" || echo "no new errors in send.ts"
```

Expected: the pre-existing errors in send.ts (allset-sdk exports, bridgeResult unknown, Uint8Array brand) remain. No NEW errors from this edit. If there IS a new error, it likely means removing the mapError widened the error channel for the command's `Effect.gen`. That's expected — the wider union flows through `runHandler`'s `catchAll((err: CliError) => ...)`. If TypeScript complains that the command's Effect error channel is too wide, the fix is to make sure `runHandler`'s signature covers all the new types (it should already, via `CliError`).

- [ ] **Step 7.4: Smoke-test**

```bash
# This invokes the network-resolve path; the bad network name should produce a NetworkNotFoundError (exit 2)
node app/cli/dist/main.js --network nonexistent-network send fast1abc 1.0 --json 2>&1
echo "EXIT=$?"
```

Expected: JSON envelope with `NETWORK_NOT_FOUND` code on stdout, `EXIT=2`. Previously this would have been `TX_FAILED` with `EXIT=6` — this is an intentional, correct improvement.

- [ ] **Step 7.5: Commit**

```bash
git add app/cli/src/commands/send.ts
git commit -m "refactor(fast-cli): preserve service error types in send handler"
```

---

## Task 8: Final verification

**Files:** None modified.

- [ ] **Step 8.1: Full type-check baseline comparison**

Check that the total TypeScript error count hasn't increased from the pre-refactor baseline:

```bash
cd /home/yuqing/Documents/Code/fast-sdk
npx --no-install tsc --noEmit -p app/cli/tsconfig.json 2>&1 | grep -c "error TS"
```

Expected: the count should be less than or equal to the baseline (19 at migration-complete SHA `c4fe0b8`). Any new errors should be investigated. The Task 7 error-channel widening could ADD one type error if `runHandler`'s signature doesn't perfectly cover the new union; if so, add the broader types to `CliError` (they should already be there).

- [ ] **Step 8.2: Full smoke-test sweep**

```bash
node app/cli/dist/main.js --help | head -5
node app/cli/dist/main.js --version
node app/cli/dist/main.js account list --json
node app/cli/dist/main.js network list --json
node app/cli/dist/main.js info status --json
node app/cli/dist/main.js info tx 0xDEADBEEF --json ; echo "EXIT=$?"
node app/cli/dist/main.js send --json 2>&1 ; echo "EXIT=$?"
node app/cli/dist/main.js bogus 2>&1 ; echo "EXIT=$?"
```

Expected:

- All read-only commands produce valid JSON with `"ok": true` (or a structured error envelope with the correct code)
- `info tx 0xDEADBEEF --json` → `TX_NOT_FOUND`, exit 1
- `send --json` (missing positional) → structured JSON error envelope on stdout, exit 1
- `bogus` → usage on stderr + error on stderr, exit 1

- [ ] **Step 8.3: Confirm no `@effect/cli` or stale mapError patterns remain**

```bash
# No effect/cli
grep -rn "@effect/cli" app/cli/src/ app/cli/package.json || echo "no matches"

# No more "Failed to ..." inline mapError blocks
grep -rn "message: \"Failed to " app/cli/src/services/ || echo "no inline storage mapErrors remain"

# StorageError in services should only be imported where still needed
grep -rn "new StorageError" app/cli/src/services/
```

Expected:

- No `@effect/cli` matches
- No inline `"Failed to ..."` messages in services (they're all in the helper now)
- Zero `new StorageError` call sites in services (all replaced by the helper)

- [ ] **Step 8.4: Round-trip account creation**

```bash
# Clean slate
node app/cli/dist/main.js account delete refactor-test --non-interactive --password testpw --json 2>/dev/null
# Create
node app/cli/dist/main.js account create --name refactor-test --password testpw --non-interactive --json ; echo "CREATE=$?"
# Verify
node app/cli/dist/main.js account list --json | grep "refactor-test"
# Delete
node app/cli/dist/main.js account delete refactor-test --non-interactive --password testpw --json ; echo "DELETE=$?"
# Gone
node app/cli/dist/main.js account list --json | grep "refactor-test" && echo "FAIL" || echo "OK deleted"
```

Expected: `CREATE=0`, `DELETE=0`, `OK deleted`. Any failure indicates a storage error path regression.

---

## Verification summary

The refactor is complete when all of these hold:

1. **7 commits** on `fast-cli` after the migration HEAD (one per Task 1-7, no commit for Task 8).
2. **Total TS error count** ≤ baseline (19 errors at `c4fe0b8`).
3. **`grep -rn "new StorageError" app/cli/src/services/`** returns zero matches (helper adoption complete).
4. **`grep -rn "message: \"Failed to " app/cli/src/services/`** returns zero matches (boilerplate gone).
5. **`grep -rn "Effect.mapError.*TransactionFailedError" app/cli/src/commands/send.ts`** returns only the schema-decode mapError (line ~305), not the network-resolve one.
6. **`errors/index.ts`** is < 100 lines (re-exports + union + mappings only).
7. **`send --json`** with missing positional produces a JSON envelope on stdout (the Task 1 fix).
8. **`info status`** reports healthy/unreachable correctly without the handler dying on RPC failure (the Task 4 fix).
9. **Create → list → delete account round-trip** succeeds end-to-end with the helper-based storage error paths.
