# Unencrypted Keystore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan
> task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Allow accounts to be stored without password
encryption, enabling agent and non-interactive workflows.

**Architecture:** An `encrypted` boolean column on the
accounts table controls storage mode. The crypto layer
routes between encrypt/decrypt and raw storage. The
prompt service gains a `required` option. Commands check
`accountInfo.encrypted` before prompting for passwords.

**Tech Stack:** Effect, Drizzle ORM, better-sqlite3,
@clack/core, @noble/hashes

---

## Tasks

### Task 1: Add encrypted column to DB schema

**Files:**

- Modify: `app/cli/src/db/schema.ts`
- Modify: `app/cli/drizzle/` (regenerate migration)

- [ ] **Step 1: Add encrypted column to accounts table**

In `app/cli/src/db/schema.ts`, add the `encrypted`
column to the accounts table after `encryptedKey`:

```typescript
encrypted: integer("encrypted", { mode: "boolean" })
  .notNull()
  .default(true),
```

- [ ] **Step 2: Delete old migration and regenerate**

```bash
rm -rf app/cli/drizzle/0000_rapid_black_bird.sql
rm -rf app/cli/drizzle/meta
cd app/cli && pnpm drizzle-kit generate
```

Expected: A new migration file in `app/cli/drizzle/`
with all four tables including the `encrypted` column.

- [ ] **Step 3: Type-check**

Run: `pnpm -F @fastxyz/fast-cli exec tsc --noEmit`
Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add app/cli/src/db/schema.ts app/cli/drizzle/
git commit -m "feat(fast-cli): add encrypted column to accounts schema"
```

---

### Task 2: Add storeSeed and loadSeed to crypto

**Files:**

- Modify: `app/cli/src/services/crypto.ts`

- [ ] **Step 1: Add storeSeed function**

Add after the existing `encryptSeed` function:

```typescript
/**
 * Store a seed — encrypt if password provided,
 * return raw bytes otherwise.
 */
export const storeSeed = async (
  seed: Uint8Array,
  password: string | null,
): Promise<Uint8Array> => {
  if (password === null) return seed;
  return encryptSeed(seed, password);
};
```

- [ ] **Step 2: Add loadSeed function**

Add after the existing `decryptSeed` function. Import
`PasswordRequiredError` (already imported):

```typescript
/**
 * Load a seed — decrypt if encrypted, return raw bytes
 * otherwise. Throws PasswordRequiredError if encrypted
 * but no password provided.
 */
export const loadSeed = async (
  blob: Uint8Array,
  password: string | null,
  encrypted: boolean,
): Promise<Uint8Array> => {
  if (!encrypted) return blob;
  if (password === null) {
    throw new PasswordRequiredError();
  }
  return decryptSeed(blob, password);
};
```

- [ ] **Step 3: Type-check**

Run: `pnpm -F @fastxyz/fast-cli exec tsc --noEmit`
Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add app/cli/src/services/crypto.ts
git commit -m "feat(fast-cli): add storeSeed/loadSeed routing functions"
```

---

### Task 3: Update AccountStore and AccountInfo

**Files:**

- Modify: `app/cli/src/services/storage/account.ts`

- [ ] **Step 1: Add encrypted to AccountInfo**

Update the `AccountInfo` interface:

```typescript
export interface AccountInfo {
  readonly name: string;
  readonly fastAddress: string;
  readonly evmAddress: string;
  readonly isDefault: boolean;
  readonly encrypted: boolean;
  readonly createdAt: string;
}
```

- [ ] **Step 2: Update rowToInfo**

Add the `encrypted` field:

```typescript
const rowToInfo = (
  row: typeof accounts.$inferSelect,
): AccountInfo => ({
  name: row.name,
  fastAddress: row.fastAddress,
  evmAddress: row.evmAddress,
  isDefault: row.isDefault,
  encrypted: row.encrypted,
  createdAt: row.createdAt,
});
```

- [ ] **Step 3: Update storeAccount**

Change the import to use `storeSeed` instead of
`encryptSeed`:

```typescript
import { loadSeed, storeSeed } from "../crypto.js";
```

Change `storeAccount` signature and body:

```typescript
const storeAccount = (
  handle: DatabaseShape,
  name: string,
  seed: Uint8Array,
  password: string | null,
) =>
  Effect.gen(function* () {
    const existing = yield* handle.query(
      (db) => getAccountByName(db, name),
      "Failed to check existing account",
    );
    if (existing) {
      return yield* Effect.fail(
        new AccountExistsError({ name }),
      );
    }

    const { fastAddress, evmAddress } =
      yield* deriveAddresses(seed);
    const keyBlob = yield* Effect.tryPromise({
      try: () => storeSeed(seed, password),
      catch: (cause) =>
        new DatabaseError({
          message: "Failed to store seed",
          cause,
        }),
    });

    const isFirst = yield* handle.query(
      (db) => countAccounts(db) === 0,
      "Failed to count accounts",
    );
    const isEncrypted = password !== null;
    const createdAt = new Date().toISOString();

    yield* handle.query(
      (db) =>
        db
          .insert(accounts)
          .values({
            name,
            fastAddress,
            evmAddress,
            encryptedKey: Buffer.from(keyBlob),
            encrypted: isEncrypted,
            isDefault: isFirst,
            createdAt,
          })
          .run(),
      "Failed to store account",
    );

    return {
      name,
      fastAddress,
      evmAddress,
      isDefault: isFirst,
      encrypted: isEncrypted,
      createdAt,
    };
  });
```

- [ ] **Step 4: Update exportAccount**

Change signature and body:

```typescript
const exportAccount = (
  handle: DatabaseShape,
  name: string,
  password: string | null,
) =>
  Effect.gen(function* () {
    const row = yield* handle.query(
      (db) => getAccountByName(db, name),
      "Failed to read account",
    );
    if (!row) {
      return yield* Effect.fail(
        new AccountNotFoundError({ name }),
      );
    }

    const seed = yield* Effect.tryPromise({
      try: () =>
        loadSeed(
          new Uint8Array(row.encryptedKey),
          password,
          row.encrypted,
        ),
      catch: (cause) => {
        if (cause instanceof WrongPasswordError)
          return cause;
        if (cause instanceof PasswordRequiredError)
          return cause;
        return new DatabaseError({
          message: "Failed to load seed",
          cause,
        });
      },
    });

    return { seed, entry: rowToInfo(row) };
  });
```

- [ ] **Step 5: Update service wiring**

Update the service effect to pass `string | null`:

```typescript
    create: (
      name: string,
      seed: Uint8Array,
      password: string | null,
    ) => storeAccount(handle, name, seed, password),
    import: (
      name: string,
      seed: Uint8Array,
      password: string | null,
    ) => storeAccount(handle, name, seed, password),
    // ...
    export: (name: string, password: string | null) =>
      exportAccount(handle, name, password),
```

- [ ] **Step 6: Add PasswordRequiredError import**

Add `PasswordRequiredError` to the error imports:

```typescript
import {
  AccountExistsError,
  AccountNotFoundError,
  DatabaseError,
  DefaultAccountError,
  NoDefaultAccountError,
  PasswordRequiredError,
  WrongPasswordError,
} from "../../errors/index.js";
```

- [ ] **Step 7: Type-check**

Run: `pnpm -F @fastxyz/fast-cli exec tsc --noEmit`
Expected: Errors in commands that call
`accounts.create`/`accounts.export` with wrong
types — these are fixed in subsequent tasks.

- [ ] **Step 8: Commit**

```bash
git add app/cli/src/services/storage/account.ts
git commit -m "feat(fast-cli): support unencrypted accounts in store"
```

---

### Task 4: Update prompt service

**Files:**

- Modify: `app/cli/src/services/prompt.ts`

- [ ] **Step 1: Update password function**

Change the `password` method to accept an options
parameter. The return type depends on `required`:
when `required: false`, returns `Option<string>`.

Update the `PromptShape` interface:

```typescript
type PasswordEffect = Effect.Effect<
  string,
  PasswordRequiredError | UserCancelledError
>;
type OptionalPasswordEffect = Effect.Effect<
  Option.Option<string>,
  UserCancelledError
>;

export interface PromptShape {
  readonly password: {
    (): PasswordEffect;
    (opts: { required: false }): OptionalPasswordEffect;
  };
  readonly confirm: (message: string) => ConfirmEffect;
}
```

- [ ] **Step 2: Implement the overloaded password**

Replace the existing `passwordPrompt` function and
update `PromptLive`:

```typescript
const passwordPrompt = (
  config: ClientConfigShape,
  label: string,
): PasswordEffect => {
  if (Option.isSome(config.password)) {
    return Effect.succeed(config.password.value);
  }
  if (config.nonInteractive) {
    return Effect.fail(new PasswordRequiredError());
  }
  const prompter = createPasswordPrompter(label);
  return Effect.promise(() => prompter.prompt()).pipe(
    Effect.flatMap((value) =>
      isCancel(value) || value === undefined
        ? Effect.fail(new UserCancelledError())
        : Effect.succeed(value),
    ),
  );
};

const optionalPasswordPrompt = (
  config: ClientConfigShape,
  label: string,
): OptionalPasswordEffect => {
  if (Option.isSome(config.password)) {
    return Effect.succeed(
      Option.some(config.password.value),
    );
  }
  if (config.nonInteractive) {
    return Effect.succeed(Option.none());
  }
  const prompter = createPasswordPrompter(label);
  return Effect.promise(() => prompter.prompt()).pipe(
    Effect.flatMap((value) => {
      if (isCancel(value) || value === undefined) {
        return Effect.fail(new UserCancelledError());
      }
      return Effect.succeed(
        value === "" ? Option.none() : Option.some(value),
      );
    }),
  );
};
```

Update `PromptLive` to wire the overload:

```typescript
return {
  password: ((opts?: { required: false }) => {
    if (opts?.required === false) {
      return optionalPasswordPrompt(
        config,
        "Password (Enter to skip):",
      );
    }
    return passwordPrompt(config, "Password:");
  }) as PromptShape["password"],
  confirm: (message) => confirmPrompt(config, message),
};
```

- [ ] **Step 3: Type-check**

Run: `pnpm -F @fastxyz/fast-cli exec tsc --noEmit`
Expected: No new errors from prompt.ts.

- [ ] **Step 4: Commit**

```bash
git add app/cli/src/services/prompt.ts
git commit -m "feat(fast-cli): add required option to password prompt"
```

---

### Task 5: Update create and import commands

**Files:**

- Modify: `app/cli/src/commands/account/create.ts`
- Modify: `app/cli/src/commands/account/import.ts`

- [ ] **Step 1: Update create command**

Add `Option` import and use optional password:

```typescript
import { Effect, Option } from "effect";
```

Replace the password and create lines:

```typescript
const pwd = yield* prompt.password({ required: false });
const seed = crypto.getRandomValues(
  new Uint8Array(32),
);
const entry = yield* accounts.create(
  name,
  seed,
  Option.getOrNull(pwd),
);

if (Option.isNone(pwd)) {
  yield* output.humanLine(
    "No password set. Key stored unencrypted.",
  );
}
```

- [ ] **Step 2: Update import command**

Add `Option` import:

```typescript
import { Effect, Option } from "effect";
```

Replace the password and import lines (near the
bottom, around line 87):

```typescript
const pwd = yield* prompt.password({ required: false });
const entry = yield* accounts.import(
  name,
  seed,
  Option.getOrNull(pwd),
);

if (Option.isNone(pwd)) {
  yield* output.humanLine(
    "No password set. Key stored unencrypted.",
  );
}
```

- [ ] **Step 3: Type-check**

Run: `pnpm -F @fastxyz/fast-cli exec tsc --noEmit`
Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add app/cli/src/commands/account/create.ts \
       app/cli/src/commands/account/import.ts
git commit -m "feat(fast-cli): use optional password in create/import"
```

---

### Task 6: Update signing commands

**Files:**

- Modify: `app/cli/src/commands/account/export.ts`
- Modify: `app/cli/src/commands/send.ts`
- Modify: `app/cli/src/commands/pay.ts`

- [ ] **Step 1: Update export command**

In `app/cli/src/commands/account/export.ts`, replace
the password and export lines:

```typescript
const accountInfo = yield* accounts.get(accountName);
const pwd = accountInfo.encrypted
  ? yield* prompt.password()
  : null;
const { seed, entry } = yield* accounts.export(
  accountName,
  pwd,
);
```

Note: need to resolve the account first to check
`encrypted`. The current code uses `accountName`
directly — add the `accounts.get()` call before
the password prompt.

- [ ] **Step 2: Update send command**

In `app/cli/src/commands/send.ts`, find the lines
(around line 148):

```typescript
const pwd = yield* prompt.password();
const { seed } = yield* accounts.export(
  accountInfo.name,
  pwd,
);
```

Replace with:

```typescript
const pwd = accountInfo.encrypted
  ? yield* prompt.password()
  : null;
const { seed } = yield* accounts.export(
  accountInfo.name,
  pwd,
);
```

The `accountInfo` is already resolved earlier via
`accounts.resolveAccount(config.account)`.

- [ ] **Step 3: Update pay command**

In `app/cli/src/commands/pay.ts`, find the lines
(around line 89):

```typescript
const pwd = yield* prompt.password();
const { seed } = yield* accounts.export(
  accountInfo.name,
  pwd,
);
```

Replace with:

```typescript
const pwd = accountInfo.encrypted
  ? yield* prompt.password()
  : null;
const { seed } = yield* accounts.export(
  accountInfo.name,
  pwd,
);
```

- [ ] **Step 4: Type-check**

Run: `pnpm -F @fastxyz/fast-cli exec tsc --noEmit`
Expected: No new errors.

- [ ] **Step 5: Commit**

```bash
git add app/cli/src/commands/account/export.ts \
       app/cli/src/commands/send.ts \
       app/cli/src/commands/pay.ts
git commit -m "feat(fast-cli): conditional password prompt for signing"
```

---

### Task 7: Build and verify

**Files:** None (verification only)

- [ ] **Step 1: Type-check**

Run: `pnpm -F @fastxyz/fast-cli exec tsc --noEmit`
Expected: Zero errors.

- [ ] **Step 2: Verify account create (non-interactive)**

Run:

```bash
npx tsx app/cli/src/main.ts account create \
  --name test-unenc --non-interactive --json
```

Expected: Account created with no password prompt.
JSON output includes the account info. The DB row
has `encrypted = 0`.

- [ ] **Step 3: Verify account export (unencrypted)**

Run:

```bash
npx tsx app/cli/src/main.ts account export \
  test-unenc --non-interactive --json
```

Expected: Exports private key with no password
prompt.

- [ ] **Step 4: Commit if fixes needed**

```bash
git add -A
git commit -m "fix(fast-cli): address verification issues"
```
