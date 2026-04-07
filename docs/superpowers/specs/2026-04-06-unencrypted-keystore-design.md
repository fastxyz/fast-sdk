# Unencrypted Keystore Support

## Goal

Allow accounts to be stored without password encryption,
matching the SSH key model (file permissions only). This
enables agent and non-interactive workflows where no
human is available to enter a password.

## Architecture

An `encrypted` boolean column on the `accounts` table
controls whether the key blob is a password-encrypted
JSON payload or raw seed bytes. The crypto layer gains
two routing functions (`storeSeed`/`loadSeed`) that
branch on this flag. The prompt service gets a
`required` option on `password()` to allow empty input.
Commands check `accountInfo.encrypted` before prompting.

## DB Schema

Add `encrypted` boolean column to the `accounts` table,
default `true`. Since the CLI is still in dev,
regenerate the Drizzle migration from scratch rather
than writing an incremental migration.

## Crypto Layer

`services/crypto.ts` gains two routing functions:

- `storeSeed(seed, password: string | null)` — if
  password is null, returns the raw seed bytes. If
  password provided, delegates to existing
  `encryptSeed`.
- `loadSeed(blob, password, encrypted)` — if not
  encrypted, returns the
  blob directly as seed bytes. If encrypted, delegates
  to existing `decryptSeed`. Throws
  `PasswordRequiredError` if encrypted but password
  is null.

Existing `encryptSeed`/`decryptSeed` are unchanged.

## Account Store

### `storeAccount`

Takes `password: string | null`. When null:

- Stores raw seed bytes in `encryptedKey` column
- Sets `encrypted: false`

When non-null: current behavior (encrypt, store,
`encrypted: true`).

### `exportAccount`

Takes `password: string | null`. Reads `encrypted`
from the DB row:

- If `encrypted: false`: returns seed bytes directly,
  ignores password
- If `encrypted: true`: decrypts with password. Fails
  with `PasswordRequiredError` if password is null.

### `AccountInfo`

Add `readonly encrypted: boolean` field. Exposed to
commands so they can decide whether to prompt.

## Prompt Service

`password(options?: { required?: boolean })`:

When `required: true` (default, current behavior):

- Flag/env: return value
- Interactive: prompt, fail on empty/cancel
- Non-interactive without flag/env: fail with
  `PasswordRequiredError`

When `required: false`:

- Flag/env: return `Option.some(value)`
- Interactive: prompt with "Password (Enter to skip):"
  label, return `Option.none()` on empty
- Non-interactive without flag/env: return
  `Option.none()`

Return type changes to `Effect<Option<string>, ...>`
when `required: false`. This can be modeled with
overloads or a union return type.

## Command Changes

### create / import

Call `prompt.password({ required: false })`. Pass
`Option.getOrNull(pwd)` to `storeAccount`. If
unencrypted, show a warning:
`"No password set. Key stored unencrypted."`

### send / pay / export

Check `accountInfo.encrypted` before prompting:

```typescript
const pwd = accountInfo.encrypted
  ? yield* prompt.password()
  : null;
const { seed } = yield* accounts.export(name, pwd);
```

No prompt, no password required for unencrypted
accounts.

## Files

| File | Change |
| --- | --- |
| `db/schema.ts` | Add `encrypted` column |
| `drizzle/` | Regenerate migration |
| `services/crypto.ts` | Add `storeSeed`/`loadSeed` |
| `services/storage/account.ts` | Update store/export |
| `services/prompt.ts` | Add `required` option |
| `commands/account/create.ts` | Optional password |
| `commands/account/import.ts` | Optional password |
| `commands/account/export.ts` | Conditional prompt |
| `commands/send.ts` | Conditional prompt |
| `commands/pay.ts` | Conditional prompt |

## Decisions

- **Explicit `encrypted` column** over blob format
  detection — clear, queryable, no parsing ambiguity.
- **Regenerate migration** — still in dev, no prod data.
- **`required` parameter** over separate method — avoids
  extra if-branch at every call site.
- **Password null = unencrypted** — simple signal that
  flows through store and crypto without extra types.
- **Warning on unencrypted** — user should know, but it
  is not an error (matches SSH key UX).
