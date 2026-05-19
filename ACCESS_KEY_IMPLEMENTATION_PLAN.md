# Access Key Implementation Plan

## Goal

Add CLI support for FAST access keys so a user can:

1. create a CLI-managed access key for an existing FAST owner account
2. list existing access keys for that owner account
3. revoke an access key
4. use a CLI-managed access key for transaction signing where appropriate

The resulting keys must be registered through the shared `fast-key-manager` lifecycle so they also appear in `app.fast.xyz`.

## Current state

- `origin/main` CLI commands currently cover `account`, `network`, `info`, `fund`, `send`, and `pay`.
- The CLI has local storage for owner accounts, but no storage for delegated access-key material.
- There is no access-key lifecycle command surface on `origin/main`.
- Access-key transaction authorization primitives exist in the broader FAST codebase, but the CLI does not yet expose create/list/revoke flows.

## Scope in this repo

This repo should own:

- CLI command design and UX
- local persistence for CLI-managed access-key signing material
- integration with `fast-key-manager` create/list/revoke endpoints
- transaction signing path for CLI-managed access keys

This repo should not own:

- the shared registry and audit model for access keys
- browser UI behavior in `app.fast.xyz`

## Proposed command surface

Add a new top-level group:

```text
fast access-key create
fast access-key list
fast access-key revoke
```

Optional later command:

```text
fast access-key use
```

That command is only needed if we want to set a default active delegated signer instead of selecting one per transaction.

## Data model changes

Add a local store for CLI-managed access keys.

Minimum fields:

- local id or alias
- owner account name
- owner account address
- access key id
- delegate public key
- encrypted delegated private key or equivalent local signer handle
- label
- client id
- created at
- revoked flag cache

Target areas:

- `app/cli/src/db/schema.ts`
- `app/cli/src/services/storage/*`

The delegated private key must stay local to the CLI runtime. The key manager only tracks metadata, policy, and capabilities.

## Command implementation

### 1. `fast access-key create`

Inputs:

- owner account
- label
- client id
- expiry
- allowed token set
- max spend cap

Flow:

1. resolve owner account and decrypt it if needed
2. generate delegated key material locally
3. build the access-key authorization transaction
4. start owner approval with `fast-key-manager`
5. obtain owner authorization using the selected signer flow
6. submit the authorization transaction
7. commit creation with `fast-key-manager`
8. persist delegated key material locally
9. print JSON and human output including `accessKeyId`

### 2. `fast access-key list`

Inputs:

- owner account or address

Flow:

1. query `fast-key-manager` for access keys on the owner account
2. join with local CLI store where possible
3. show whether each key is locally managed by this CLI instance

### 3. `fast access-key revoke`

Inputs:

- owner account
- access key id

Flow:

1. start revoke approval with `fast-key-manager`
2. obtain owner authorization
3. submit revoke transaction
4. commit revocation with `fast-key-manager`
5. mark local key record revoked or delete it, depending on desired UX

## Signing integration

There are two distinct signer roles:

- owner signer for access-key authorization and revocation
- delegated signer for later transaction execution

The CLI must keep these separate.

Recommended first milestone:

- support lifecycle commands first
- do not change `fast send` yet

Recommended second milestone:

- add an explicit `--access-key <id>` path to `fast send`
- use locally stored delegated key material when that flag is present

This keeps the initial rollout smaller and avoids silently changing current account behavior.

## File targets

Expected implementation areas:

- `app/cli/src/cli.ts`
- `app/cli/src/commands/index.ts`
- `app/cli/src/commands/access-key/create.ts`
- `app/cli/src/commands/access-key/list.ts`
- `app/cli/src/commands/access-key/revoke.ts`
- `app/cli/src/services/storage/`
- `app/cli/src/services/api/`
- `app/cli/src/db/schema.ts`
- `app/cli/README.md`

## Validation

Add tests for:

- schema persistence for local delegated keys
- create command happy path
- list command with local and remote-only keys
- revoke command happy path
- JSON output envelope
- failure modes for missing owner account, approval failure, network failure, and unknown access key

## Dependency order

1. finalize `fast-key-manager` metadata contract if any additions are needed
2. add CLI storage and command surface
3. wire CLI to shared key-manager endpoints
4. add CLI send-with-access-key support
5. update docs

## Open questions

1. Should CLI-managed access keys get a distinct `clientId`, or should they default to `app.fast.xyz` for compatibility?
2. Should revoked keys remain in local storage for audit/history, or be removed?
3. Should `fast send` accept both owner signer and access-key signer on the same command, or should access-key sends live under a separate subcommand?
