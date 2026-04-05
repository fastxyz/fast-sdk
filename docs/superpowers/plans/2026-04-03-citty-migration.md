<!-- markdownlint-disable MD013 -->
# fast-cli: Migrate from @effect/cli to citty

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `@effect/cli` with `citty` in the `@fastxyz/fast-cli` package so that `--help` output is clean and argument declarations are simpler.

**Architecture:** Every command file keeps its Effect-based handler body verbatim. What changes is the wrapper: `Command.make(...)` becomes `defineCommand(...)`. Global flags (`--json`, `--debug`, `--non-interactive`, `--network`, `--account`, `--password`) live in one shared `globalArgs` object and are spread into every leaf command's `args`. A single `runHandler(args, program)` adapter in `src/cli-runner.ts` builds the Effect layer from the parsed args, runs the program, and handles `CliError`s with the existing exit-code mapping. `layers.ts`, services, schemas, and errors are untouched.

**Tech Stack:** TypeScript, Effect 3.x, citty (replacing @effect/cli), tsup (bundler), pnpm workspaces.

---

## File Structure

**Created:**

- `app/cli/src/cli-globals.ts` — the single source of truth for the six global flags, typed as a citty `ArgsDef` object.
- `app/cli/src/cli-runner.ts` — `runHandler(args, program)` helper that converts parsed global args → `CliConfig` layer, runs the Effect, and handles errors + exit codes.

**Modified (all 16 command files):**

- `app/cli/src/commands/account/{create,delete,export,import,info,list,set-default}.ts`
- `app/cli/src/commands/account/index.ts`
- `app/cli/src/commands/network/{add,list,remove,set-default}.ts`
- `app/cli/src/commands/network/index.ts`
- `app/cli/src/commands/info/{balance,history,status,tx}.ts`
- `app/cli/src/commands/info/index.ts`
- `app/cli/src/commands/send.ts`
- `app/cli/src/cli.ts` (root command)
- `app/cli/src/main.ts` (entrypoint)
- `app/cli/src/services/cli-config.ts` (remove `rootOptions` and `provideCliConfig` exports)
- `app/cli/package.json` (remove `@effect/cli`, add `citty`)

**Unchanged:** `app/cli/src/layers.ts`, everything under `services/` (except cli-config.ts), `schemas/`, `errors/`, `config/`.

---

## Patterns reused in every command

Each leaf command follows this template — memorize it:

```typescript
import { defineCommand } from 'citty';
import { Effect } from 'effect';
import { globalArgs } from '../../cli-globals.js';
import { runHandler } from '../../cli-runner.js';
// import services as needed

export const <commandName> = defineCommand({
  meta: { name: '<command>', description: '<description>' },
  args: {
    ...globalArgs,
    // local args here
  },
  run: ({ args }) => runHandler(args, Effect.gen(function* () {
    // existing Effect.gen body — unchanged
  })),
});
```

**Key conversions** when porting a handler body:

- `Option.isSome(args.foo) ? args.foo.value : <fallback>` → `args.foo ?? <fallback>`
- `Option.getOrUndefined(args.foo)` → `args.foo`
- `Option.getOrElse(args.foo, () => fn())` → `args.foo ?? fn()`
- `Args.text({ name: 'x' })` → `{ type: 'positional', description: '...', required: true }`
- `Args.text(...).pipe(Args.optional)` → `{ type: 'positional', required: false }`
- `Options.text('x').pipe(Options.optional)` → `{ type: 'string', description: '...' }` (no `required`, default is `undefined`)
- `Options.text('x').pipe(Options.withDefault(v))` → `{ type: 'string', default: v }`
- `Options.boolean('x').pipe(Options.withDefault(false))` → `{ type: 'boolean', default: false }`
- `Options.integer('x').pipe(Options.withDefault(20))` → `{ type: 'string', default: '20' }` (citty has no integer type — parse with `Number(args.x)` in the handler)
- `Options.file('x')` → `{ type: 'string', description: '...' }` + explicit `fs.existsSync` check in handler

---

## Task 1: Dependencies and scaffolding

**Files:**

- Modify: `app/cli/package.json`
- Create: `app/cli/src/cli-globals.ts`
- Create: `app/cli/src/cli-runner.ts`

- [ ] **Step 1.1: Add citty, remove @effect/cli**

Run from repo root:

```bash
pnpm -F @fastxyz/fast-cli add citty
pnpm -F @fastxyz/fast-cli remove @effect/cli
```

Expected: `package.json` shows `"citty": "^0.1.6"` (or newer) in `dependencies` and no `@effect/cli`.

- [ ] **Step 1.2: Create `app/cli/src/cli-globals.ts`**

```typescript
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const NETWORKS_FILE = join(homedir(), '.fast', 'networks.json');

const readDefaultNetwork = (): string => {
  try {
    const content = readFileSync(NETWORKS_FILE, 'utf-8');
    const data = JSON.parse(content);
    return typeof data.default === 'string' ? data.default : 'testnet';
  } catch {
    return 'testnet';
  }
};

/**
 * Global flags that are spread into every leaf command's `args`.
 * Citty doesn't inherit args from parent commands, so we duplicate these
 * on each leaf to keep a single source of truth.
 */
export const globalArgs = {
  json: {
    type: 'boolean',
    description: 'Emit machine-parseable JSON to stdout',
    default: false,
  },
  debug: {
    type: 'boolean',
    description: 'Enable verbose logging to stderr',
    default: false,
  },
  'non-interactive': {
    type: 'boolean',
    description: 'Auto-confirm dangerous operations; fail when input is missing',
    default: false,
  },
  network: {
    type: 'string',
    description: 'Override the network for this command',
    default: readDefaultNetwork(),
  },
  account: {
    type: 'string',
    description: 'Use the named account for signing operations',
  },
  password: {
    type: 'string',
    description: 'Keystore password for decrypting the account key',
  },
} as const;

/** Shape of `args` after citty parses globalArgs. */
export interface GlobalArgsParsed {
  json: boolean;
  debug: boolean;
  'non-interactive': boolean;
  network: string;
  account?: string;
  password?: string;
}
```

Note: citty args are case-agnostic, so `non-interactive` and `nonInteractive` both work at parse time. We use kebab-case in the definition because citty's auto-generated `--help` shows the raw key name.

- [ ] **Step 1.3: Create `app/cli/src/cli-runner.ts`**

```typescript
import { Effect, Option } from 'effect';
import { type CliError, toErrorCode, toExitCode } from './errors/index.js';
import { makeAppLayer } from './layers.js';
import { Output } from './services/output.js';
import type { GlobalArgsParsed } from './cli-globals.js';

/**
 * Adapter that bridges citty handlers to Effect programs.
 *
 * - Builds the app layer from parsed global args
 * - Provides it to the program
 * - Catches CliErrors, prints via Output, and exits with the mapped code
 * - Unhandled throws propagate to citty's runMain (which prints usage)
 */
// biome-ignore lint/suspicious/noExplicitAny: layer-provided requirements are checked by Effect.provide
export const runHandler = <A, R>(
  args: GlobalArgsParsed,
  program: Effect.Effect<A, CliError, R>,
): Promise<void> => {
  const layer = makeAppLayer({
    json: args.json,
    debug: args.debug,
    nonInteractive: args['non-interactive'] || args.json,
    network: args.network,
    account: args.account ? Option.some(args.account) : Option.none(),
    password: args.password ? Option.some(args.password) : Option.none(),
  });

  const handled = program.pipe(
    Effect.catchAll((err: CliError) =>
      Effect.gen(function* () {
        const output = yield* Output;
        yield* output.error(err);
        // biome-ignore lint/suspicious/useIsNan: process.exit never returns
        process.exit(toExitCode(err));
      }),
    ),
    Effect.catchAllDefect((defect) =>
      Effect.sync(() => {
        // Fallback for non-CliError throws (bugs, assertion failures, etc.)
        const message = defect instanceof Error ? defect.message : String(defect);
        if (args.json) {
          process.stdout.write(`${JSON.stringify({ ok: false, error: { code: 'UNKNOWN_ERROR', message } }, null, 2)}\n`);
        } else {
          process.stderr.write(`Error: ${message}\n`);
        }
        process.exit(1);
      }),
    ),
    Effect.provide(layer),
    Effect.asVoid,
  );

  // The layer provides every service the program could need. Cast R → never
  // because Effect.provide's type-level requirement subtraction is too loose
  // for citty's generic handler signature.
  return Effect.runPromise(handled as Effect.Effect<void, never, never>);
};

// Re-export for use inside handlers that need to inspect the raw error code
export { toErrorCode };
```

- [ ] **Step 1.4: Verify scaffolding type-checks**

Run:

```bash
cd app/cli && npx --no-install tsc --noEmit src/cli-globals.ts src/cli-runner.ts
```

Expected: no errors on these two files (the old cli-config.ts still references `Command` from `@effect/cli` which will now fail — that's fine, we fix it in Task 7).

- [ ] **Step 1.5: Commit**

```bash
cd /home/yuqing/Documents/Code/fast-sdk
git add app/cli/package.json app/cli/src/cli-globals.ts app/cli/src/cli-runner.ts pnpm-lock.yaml
git commit -m "feat(fast-cli): scaffold citty runner and global args"
```

---

## Task 2: Migrate account subcommands

**Files:** Modify all 7 leaf commands + `account/index.ts` under `app/cli/src/commands/account/`.

- [ ] **Step 2.1: Rewrite `account/list.ts`**

```typescript
import { defineCommand } from 'citty';
import { Effect } from 'effect';
import { globalArgs } from '../../cli-globals.js';
import { runHandler } from '../../cli-runner.js';
import { AccountStore } from '../../services/account-store.js';
import { Output } from '../../services/output.js';

export const accountList = defineCommand({
  meta: { name: 'list', description: 'List all accounts' },
  args: { ...globalArgs },
  run: ({ args }) => runHandler(args, Effect.gen(function* () {
    const accounts = yield* AccountStore;
    const output = yield* Output;

    const entries = yield* accounts.list();

    yield* output.humanTable(
      ['NAME', 'FAST ADDRESS', 'EVM ADDRESS', 'DEFAULT'],
      entries.map((e) => [e.name, e.fastAddress, e.evmAddress, e.isDefault ? '✓' : '']),
    );
    yield* output.success({
      accounts: entries.map((e) => ({
        name: e.name,
        fastAddress: e.fastAddress,
        evmAddress: e.evmAddress,
        isDefault: e.isDefault,
      })),
    });
  })),
});
```

- [ ] **Step 2.2: Rewrite `account/create.ts`**

```typescript
import { defineCommand } from 'citty';
import { Effect } from 'effect';
import { globalArgs } from '../../cli-globals.js';
import { runHandler } from '../../cli-runner.js';
import { AccountStore } from '../../services/account-store.js';
import { Output } from '../../services/output.js';
import { PasswordService } from '../../services/password-service.js';

export const accountCreate = defineCommand({
  meta: { name: 'create', description: 'Create a new account' },
  args: {
    ...globalArgs,
    name: {
      type: 'string',
      description: 'Human-readable alias for the account',
    },
  },
  run: ({ args }) => runHandler(args, Effect.gen(function* () {
    const accounts = yield* AccountStore;
    const password = yield* PasswordService;
    const output = yield* Output;

    const name = args.name ?? (yield* accounts.nextAutoName());

    const pwd = yield* password.resolve();
    const seed = crypto.getRandomValues(new Uint8Array(32));
    const entry = yield* accounts.create(name, seed, pwd);

    yield* output.humanLine(`Created account "${entry.name}"`);
    yield* output.humanLine(`  Fast address: ${entry.fastAddress}`);
    yield* output.humanLine(`  EVM address:  ${entry.evmAddress}`);
    yield* output.success({
      name: entry.name,
      fastAddress: entry.fastAddress,
      evmAddress: entry.evmAddress,
    });
  })),
});
```

- [ ] **Step 2.3: Rewrite `account/delete.ts`**

```typescript
import { defineCommand } from 'citty';
import { Effect } from 'effect';
import { globalArgs } from '../../cli-globals.js';
import { runHandler } from '../../cli-runner.js';
import { UserCancelledError } from '../../errors/index.js';
import { AccountStore } from '../../services/account-store.js';
import { CliConfig } from '../../services/cli-config.js';
import { Output } from '../../services/output.js';

export const accountDelete = defineCommand({
  meta: { name: 'delete', description: 'Delete an account' },
  args: {
    ...globalArgs,
    name: {
      type: 'positional',
      description: 'Account alias to delete',
      required: true,
    },
  },
  run: ({ args }) => runHandler(args, Effect.gen(function* () {
    const accounts = yield* AccountStore;
    const output = yield* Output;
    const config = yield* CliConfig;

    if (!config.nonInteractive && !config.json) {
      const confirmed = yield* output.confirm(`Delete account "${args.name}"?`);
      if (!confirmed) {
        return yield* Effect.fail(new UserCancelledError());
      }
    }

    yield* accounts.delete_(args.name);

    yield* output.humanLine(`Deleted account "${args.name}"`);
    yield* output.success({ name: args.name, deleted: true });
  })),
});
```

- [ ] **Step 2.4: Rewrite `account/info.ts`**

```typescript
import { defineCommand } from 'citty';
import { Effect } from 'effect';
import { globalArgs } from '../../cli-globals.js';
import { runHandler } from '../../cli-runner.js';
import { AccountStore } from '../../services/account-store.js';
import { CliConfig } from '../../services/cli-config.js';
import { Output } from '../../services/output.js';

export const accountInfo = defineCommand({
  meta: { name: 'info', description: 'Show account addresses' },
  args: {
    ...globalArgs,
    name: {
      type: 'positional',
      description: 'Account alias. Defaults to the default account.',
      required: false,
    },
  },
  run: ({ args }) => runHandler(args, Effect.gen(function* () {
    const accounts = yield* AccountStore;
    const output = yield* Output;
    const config = yield* CliConfig;

    const info = args.name ? yield* accounts.get(args.name) : yield* accounts.resolveAccount(config.account);

    const defaultLabel = info.isDefault ? ' (default)' : '';
    yield* output.humanLine(`Account: ${info.name}${defaultLabel}`);
    yield* output.humanLine(`  Fast address: ${info.fastAddress}`);
    yield* output.humanLine(`  EVM address:  ${info.evmAddress}`);
    yield* output.success({
      name: info.name,
      fastAddress: info.fastAddress,
      evmAddress: info.evmAddress,
      isDefault: info.isDefault,
    });
  })),
});
```

- [ ] **Step 2.5: Rewrite `account/export.ts`**

```typescript
import { defineCommand } from 'citty';
import { toHex } from '@fastxyz/fast-sdk';
import { Effect } from 'effect';
import { globalArgs } from '../../cli-globals.js';
import { runHandler } from '../../cli-runner.js';
import { UserCancelledError } from '../../errors/index.js';
import { AccountStore } from '../../services/account-store.js';
import { CliConfig } from '../../services/cli-config.js';
import { Output } from '../../services/output.js';
import { PasswordService } from '../../services/password-service.js';

export const accountExport = defineCommand({
  meta: { name: 'export', description: 'Export (decrypt) the private key' },
  args: {
    ...globalArgs,
    name: {
      type: 'positional',
      description: 'Account alias. Defaults to the default account.',
      required: false,
    },
  },
  run: ({ args }) => runHandler(args, Effect.gen(function* () {
    const accounts = yield* AccountStore;
    const passwordService = yield* PasswordService;
    const output = yield* Output;
    const config = yield* CliConfig;

    const accountName = args.name ?? (yield* accounts.resolveAccount(config.account)).name;

    if (!config.nonInteractive && !config.json) {
      const confirmed = yield* output.confirm('⚠ This will display the private key. Continue?');
      if (!confirmed) {
        return yield* Effect.fail(new UserCancelledError());
      }
    }

    const pwd = yield* passwordService.resolve();
    const { seed, entry } = yield* accounts.export_(accountName, pwd);
    const privateKeyHex = toHex(seed);

    yield* output.humanLine(`⚠ Private key for "${entry.name}":`);
    yield* output.humanLine(privateKeyHex);
    yield* output.success({
      name: entry.name,
      privateKey: privateKeyHex,
      fastAddress: entry.fastAddress,
      evmAddress: entry.evmAddress,
    });
  })),
});
```

- [ ] **Step 2.6: Rewrite `account/import.ts`**

```typescript
import { defineCommand } from 'citty';
import { fromHex } from '@fastxyz/fast-sdk';
import { readFileSync } from 'node:fs';
import { Effect } from 'effect';
import { globalArgs } from '../../cli-globals.js';
import { runHandler } from '../../cli-runner.js';
import { InvalidUsageError } from '../../errors/index.js';
import { AccountStore } from '../../services/account-store.js';
import { Output } from '../../services/output.js';
import { PasswordService } from '../../services/password-service.js';

export const accountImport = defineCommand({
  meta: { name: 'import', description: 'Import an existing private key' },
  args: {
    ...globalArgs,
    name: { type: 'string', description: 'Alias for the account' },
    'private-key': { type: 'string', description: 'Hex-encoded Ed25519 seed (0x-prefixed or raw)' },
    'key-file': { type: 'string', description: 'Path to a JSON file containing a privateKey field' },
  },
  run: ({ args }) => runHandler(args, Effect.gen(function* () {
    const accounts = yield* AccountStore;
    const password = yield* PasswordService;
    const output = yield* Output;

    if (args['private-key'] && args['key-file']) {
      return yield* Effect.fail(new InvalidUsageError({ message: '--private-key and --key-file are mutually exclusive' }));
    }

    let seed: Uint8Array;
    if (args['private-key']) {
      seed = fromHex(args['private-key']);
      if (seed.length !== 32) {
        return yield* Effect.fail(new InvalidUsageError({ message: 'Private key must be exactly 32 bytes (64 hex characters)' }));
      }
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
    } else {
      return yield* Effect.fail(new InvalidUsageError({ message: 'Provide --private-key or --key-file' }));
    }

    const name = args.name ?? (yield* accounts.nextAutoName());

    const pwd = yield* password.resolve();
    const entry = yield* accounts.import_(name, seed, pwd);

    yield* output.humanLine(`Imported account "${entry.name}"`);
    yield* output.humanLine(`  Fast address: ${entry.fastAddress}`);
    yield* output.humanLine(`  EVM address:  ${entry.evmAddress}`);
    yield* output.success({
      name: entry.name,
      fastAddress: entry.fastAddress,
      evmAddress: entry.evmAddress,
    });
  })),
});
```

- [ ] **Step 2.7: Rewrite `account/set-default.ts`**

```typescript
import { defineCommand } from 'citty';
import { Effect } from 'effect';
import { globalArgs } from '../../cli-globals.js';
import { runHandler } from '../../cli-runner.js';
import { AccountStore } from '../../services/account-store.js';
import { Output } from '../../services/output.js';

export const accountSetDefault = defineCommand({
  meta: { name: 'set-default', description: 'Set the default account' },
  args: {
    ...globalArgs,
    name: {
      type: 'positional',
      description: 'Alias of an existing account',
      required: true,
    },
  },
  run: ({ args }) => runHandler(args, Effect.gen(function* () {
    const accounts = yield* AccountStore;
    const output = yield* Output;

    yield* accounts.setDefault(args.name);
    const info = yield* accounts.get(args.name);

    yield* output.humanLine(`Default account set to "${args.name}"`);
    yield* output.success({
      name: info.name,
      fastAddress: info.fastAddress,
    });
  })),
});
```

- [ ] **Step 2.8: Rewrite `account/index.ts`**

```typescript
import { defineCommand } from 'citty';
import { accountCreate } from './create.js';
import { accountDelete } from './delete.js';
import { accountExport } from './export.js';
import { accountImport } from './import.js';
import { accountInfo } from './info.js';
import { accountList } from './list.js';
import { accountSetDefault } from './set-default.js';

export const accountCommand = defineCommand({
  meta: { name: 'account', description: 'Manage accounts' },
  subCommands: {
    create: accountCreate,
    import: accountImport,
    list: accountList,
    'set-default': accountSetDefault,
    info: accountInfo,
    export: accountExport,
    delete: accountDelete,
  },
});
```

- [ ] **Step 2.9: Commit account commands**

```bash
git add app/cli/src/commands/account/
git commit -m "refactor(fast-cli): migrate account commands to citty"
```

---

## Task 3: Migrate network subcommands

**Files:** Modify all 4 leaf commands + `network/index.ts` under `app/cli/src/commands/network/`.

- [ ] **Step 3.1: Rewrite `network/list.ts`**

```typescript
import { defineCommand } from 'citty';
import { Effect } from 'effect';
import { globalArgs } from '../../cli-globals.js';
import { runHandler } from '../../cli-runner.js';
import { NetworkConfigService } from '../../services/network-config.js';
import { Output } from '../../services/output.js';

export const networkList = defineCommand({
  meta: { name: 'list', description: 'List available networks' },
  args: { ...globalArgs },
  run: ({ args }) => runHandler(args, Effect.gen(function* () {
    const networkConfig = yield* NetworkConfigService;
    const output = yield* Output;

    const networks = yield* networkConfig.list();

    yield* output.humanTable(
      ['NAME', 'TYPE', 'DEFAULT'],
      networks.map((n) => [n.name, n.type, n.isDefault ? '✓' : '']),
    );
    yield* output.success({
      networks: networks.map((n) => ({
        name: n.name,
        type: n.type,
        isDefault: n.isDefault,
      })),
    });
  })),
});
```

- [ ] **Step 3.2: Rewrite `network/add.ts`**

Note: `Options.file('config')` becomes `type: 'string'` + explicit existence check, since citty has no file type.

```typescript
import { defineCommand } from 'citty';
import { existsSync } from 'node:fs';
import { Effect } from 'effect';
import { globalArgs } from '../../cli-globals.js';
import { runHandler } from '../../cli-runner.js';
import { InvalidUsageError } from '../../errors/index.js';
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
    if (!existsSync(args.config)) {
      return yield* Effect.fail(new InvalidUsageError({ message: `Config file not found: ${args.config}` }));
    }

    const networkConfig = yield* NetworkConfigService;
    const output = yield* Output;

    yield* networkConfig.add(args.name, args.config);

    yield* output.humanLine(`Added network "${args.name}"`);
    yield* output.success({ name: args.name });
  })),
});
```

- [ ] **Step 3.3: Rewrite `network/remove.ts`**

```typescript
import { defineCommand } from 'citty';
import { Effect } from 'effect';
import { globalArgs } from '../../cli-globals.js';
import { runHandler } from '../../cli-runner.js';
import { NetworkConfigService } from '../../services/network-config.js';
import { Output } from '../../services/output.js';

export const networkRemove = defineCommand({
  meta: { name: 'remove', description: 'Remove a custom network' },
  args: {
    ...globalArgs,
    name: {
      type: 'positional',
      description: 'Name of the custom network to remove',
      required: true,
    },
  },
  run: ({ args }) => runHandler(args, Effect.gen(function* () {
    const networkConfig = yield* NetworkConfigService;
    const output = yield* Output;

    yield* networkConfig.remove(args.name);

    yield* output.humanLine(`Removed network "${args.name}"`);
    yield* output.success({ name: args.name, removed: true });
  })),
});
```

- [ ] **Step 3.4: Rewrite `network/set-default.ts`**

```typescript
import { defineCommand } from 'citty';
import { Effect } from 'effect';
import { globalArgs } from '../../cli-globals.js';
import { runHandler } from '../../cli-runner.js';
import { NetworkConfigService } from '../../services/network-config.js';
import { Output } from '../../services/output.js';

export const networkSetDefault = defineCommand({
  meta: { name: 'set-default', description: 'Set the default network' },
  args: {
    ...globalArgs,
    name: {
      type: 'positional',
      description: 'Network name',
      required: true,
    },
  },
  run: ({ args }) => runHandler(args, Effect.gen(function* () {
    const networkConfig = yield* NetworkConfigService;
    const output = yield* Output;

    yield* networkConfig.setDefault(args.name);

    yield* output.humanLine(`Default network set to "${args.name}"`);
    yield* output.success({ name: args.name });
  })),
});
```

- [ ] **Step 3.5: Rewrite `network/index.ts`**

```typescript
import { defineCommand } from 'citty';
import { networkAdd } from './add.js';
import { networkList } from './list.js';
import { networkRemove } from './remove.js';
import { networkSetDefault } from './set-default.js';

export const networkCommand = defineCommand({
  meta: { name: 'network', description: 'Manage networks' },
  subCommands: {
    list: networkList,
    'set-default': networkSetDefault,
    add: networkAdd,
    remove: networkRemove,
  },
});
```

- [ ] **Step 3.6: Commit network commands**

```bash
git add app/cli/src/commands/network/
git commit -m "refactor(fast-cli): migrate network commands to citty"
```

---

## Task 4: Migrate info subcommands

**Files:** Modify all 4 leaf commands + `info/index.ts` under `app/cli/src/commands/info/`.

- [ ] **Step 4.1: Rewrite `info/status.ts`**

```typescript
import { defineCommand } from 'citty';
import { Effect } from 'effect';
import { globalArgs } from '../../cli-globals.js';
import { runHandler } from '../../cli-runner.js';
import { CliConfig } from '../../services/cli-config.js';
import { FastRpc } from '../../services/fast-rpc.js';
import { NetworkConfigService } from '../../services/network-config.js';
import { Output } from '../../services/output.js';

export const infoStatus = defineCommand({
  meta: { name: 'status', description: 'Health check for current network' },
  args: { ...globalArgs },
  run: ({ args }) => runHandler(args, Effect.gen(function* () {
    const rpc = yield* FastRpc;
    const output = yield* Output;
    const config = yield* CliConfig;
    const networkConfig = yield* NetworkConfigService;

    const network = yield* networkConfig.resolve(config.network).pipe(Effect.mapError((e) => e));

    let healthy = false;
    try {
      yield* rpc.getAccountInfo({ sender: new Uint8Array(32) });
      healthy = true;
    } catch {
      // unreachable, report in UI
    }

    const defaultNetwork = yield* networkConfig.getDefault();
    const isDefault = config.network === defaultNetwork;

    const defaultLabel = isDefault ? ' (default)' : '';
    yield* output.humanLine(`Network: ${config.network}${defaultLabel}`);
    yield* output.humanLine(`  Fast RPC:      ${network.rpcUrl}        ${healthy ? '✓ healthy' : '✗ unreachable'}`);
    yield* output.humanLine(`  Explorer:      ${network.explorerUrl}`);

    yield* output.success({
      network: config.network,
      fast: {
        rpcUrl: network.rpcUrl,
        explorerUrl: network.explorerUrl,
        healthy,
      },
    });
  })),
});
```

- [ ] **Step 4.2: Rewrite `info/balance.ts`**

```typescript
import { defineCommand } from 'citty';
import { bech32m } from 'bech32';
import { Effect } from 'effect';
import { globalArgs } from '../../cli-globals.js';
import { runHandler } from '../../cli-runner.js';
import { InvalidAddressError } from '../../errors/index.js';
import { AccountStore } from '../../services/account-store.js';
import { CliConfig } from '../../services/cli-config.js';
import { FastRpc } from '../../services/fast-rpc.js';
import { Output } from '../../services/output.js';

const fromFastAddress = (address: string): Uint8Array => {
  const { prefix, words } = bech32m.decode(address);
  if (prefix !== 'fast') throw new Error(`Expected "fast" prefix, got "${prefix}"`);
  return new Uint8Array(bech32m.fromWords(words));
};

const formatAmount = (amountStr: string, decimals: number): string => {
  if (decimals === 0) return amountStr;
  const padded = amountStr.padStart(decimals + 1, '0');
  const intPart = padded.slice(0, -decimals) || '0';
  const fracPart = padded.slice(-decimals).replace(/0+$/, '');
  return fracPart ? `${intPart}.${fracPart}` : intPart;
};

export const infoBalance = defineCommand({
  meta: { name: 'balance', description: 'Show token balances for an address' },
  args: {
    ...globalArgs,
    address: { type: 'string', description: 'Any Fast address (fast1...) to query' },
    token: { type: 'string', description: 'Filter by token' },
  },
  run: ({ args }) => runHandler(args, Effect.gen(function* () {
    const rpc = yield* FastRpc;
    const accounts = yield* AccountStore;
    const output = yield* Output;
    const config = yield* CliConfig;

    let fastAddress: string;
    let senderBytes: Uint8Array;

    if (args.address) {
      fastAddress = args.address;
      if (!fastAddress.startsWith('fast1')) {
        return yield* Effect.fail(new InvalidAddressError({ message: `Invalid Fast address: ${fastAddress}` }));
      }
      try {
        senderBytes = fromFastAddress(fastAddress);
      } catch {
        return yield* Effect.fail(new InvalidAddressError({ message: `Invalid Fast address: ${fastAddress}` }));
      }
    } else {
      const account = yield* accounts.resolveAccount(config.account);
      fastAddress = account.fastAddress;
      senderBytes = fromFastAddress(fastAddress);
    }

    const accountInfo = yield* rpc.getAccountInfo({
      address: senderBytes,
      tokenBalancesFilter: null,
      stateKeyFilter: null,
      certificateByNonce: null,
    });

    const balances: Array<{ tokenName: string; tokenId: string; amount: string; decimals: number; formatted: string }> = [];

    if (accountInfo && typeof accountInfo === 'object' && 'token_balance' in accountInfo) {
      const tokenBalances = accountInfo.token_balance as Record<string, bigint> | undefined;
      if (tokenBalances) {
        for (const [tokenId, amount] of Object.entries(tokenBalances)) {
          const decimals = 6;
          const amountStr = String(amount);
          const formatted = formatAmount(amountStr, decimals);

          if (args.token) {
            const filter = args.token.toLowerCase();
            if (tokenId !== args.token && !tokenId.toLowerCase().includes(filter)) {
              continue;
            }
          }

          balances.push({
            tokenName: `${tokenId.slice(0, 10)}...`,
            tokenId,
            amount: amountStr,
            decimals,
            formatted,
          });
        }
      }
    }

    yield* output.humanLine(`Balances for ${fastAddress}`);
    yield* output.humanLine('');
    yield* output.humanTable(
      ['TOKEN', 'BALANCE', 'TOKEN ID'],
      balances.map((b) => [b.tokenName, b.formatted, b.tokenId]),
    );
    yield* output.success({ address: fastAddress, balances });
  })),
});
```

- [ ] **Step 4.3: Rewrite `info/tx.ts`**

```typescript
import { defineCommand } from 'citty';
import { Effect } from 'effect';
import { globalArgs } from '../../cli-globals.js';
import { runHandler } from '../../cli-runner.js';
import { HistoryStore } from '../../services/history-store.js';
import { Output } from '../../services/output.js';

export const infoTx = defineCommand({
  meta: { name: 'tx', description: 'Look up a transaction by hash' },
  args: {
    ...globalArgs,
    hash: {
      type: 'positional',
      description: 'Transaction hash (hex)',
      required: true,
    },
  },
  run: ({ args }) => runHandler(args, Effect.gen(function* () {
    const history = yield* HistoryStore;
    const output = yield* Output;

    const entry = yield* history.getByHash(args.hash);

    yield* output.humanLine(`Transaction: ${entry.hash}`);
    yield* output.humanLine(`  Type:      ${entry.type}`);
    yield* output.humanLine(`  From:      ${entry.from}`);
    yield* output.humanLine(`  To:        ${entry.to}`);
    yield* output.humanLine(`  Amount:    ${entry.formatted} ${entry.tokenName}`);
    yield* output.humanLine(`  Status:    ${entry.status}`);
    yield* output.humanLine(`  Timestamp: ${entry.timestamp}`);
    if (entry.explorerUrl) {
      yield* output.humanLine(`  Explorer:  ${entry.explorerUrl}`);
    }
    yield* output.success(entry);
  })),
});
```

- [ ] **Step 4.4: Rewrite `info/history.ts`**

Note: `Options.integer('limit')` becomes `type: 'string'` in citty (no integer type); parse with `Number(args.limit)` in the handler.

```typescript
import { defineCommand } from 'citty';
import { Effect, Option } from 'effect';
import { globalArgs } from '../../cli-globals.js';
import { runHandler } from '../../cli-runner.js';
import { HistoryStore } from '../../services/history-store.js';
import { NetworkConfigService } from '../../services/network-config.js';
import { Output } from '../../services/output.js';

interface PortalActivityRecord {
  transferFastTxId?: string;
  externalTransactionHash?: string;
}

interface PortalActivityListResponse {
  status: 'success' | 'error';
  data: PortalActivityRecord[];
}

function inferRoute(entry: { route: 'fast' | 'evm-to-fast' | 'fast-to-evm'; from: string; to: string }): 'fast' | 'evm-to-fast' | 'fast-to-evm' {
  if (entry.route !== 'fast') return entry.route;
  if (entry.from.startsWith('0x') && entry.to.startsWith('fast1')) return 'evm-to-fast';
  if (entry.from.startsWith('fast1') && entry.to.startsWith('0x')) return 'fast-to-evm';
  return 'fast';
}

async function queryActivityList(portalApiUrl: string, params: string): Promise<PortalActivityRecord[]> {
  try {
    const res = await fetch(`${portalApiUrl}/activity?${params}&page_size=50`);
    if (!res.ok) return [];
    const json = (await res.json()) as PortalActivityListResponse;
    return json.status === 'success' ? json.data : [];
  } catch {
    return [];
  }
}

async function isDepositConfirmed(portalApiUrl: string, evmAddress: string, txHash: string): Promise<boolean> {
  const records = await queryActivityList(portalApiUrl, `externalAddress=${encodeURIComponent(evmAddress)}`);
  return records.some((r) => r.externalTransactionHash?.toLowerCase() === txHash.toLowerCase());
}

async function isWithdrawConfirmed(portalApiUrl: string, fastAddress: string, txHash: string): Promise<boolean> {
  const records = await queryActivityList(portalApiUrl, `fastSetAddress=${encodeURIComponent(fastAddress)}`);
  const normalized = txHash.replace(/^0x/, '').toLowerCase();
  return records.some((r) => r.transferFastTxId?.toLowerCase() === normalized);
}

export const infoHistory = defineCommand({
  meta: { name: 'history', description: 'Show transaction history' },
  args: {
    ...globalArgs,
    from: { type: 'string', description: 'Filter by sender account name or address' },
    to: { type: 'string', description: 'Filter by recipient address' },
    token: { type: 'string', description: 'Filter by token' },
    limit: { type: 'string', description: 'Max number of records to return', default: '20' },
    offset: { type: 'string', description: 'Number of records to skip', default: '0' },
  },
  run: ({ args }) => runHandler(args, Effect.gen(function* () {
    const history = yield* HistoryStore;
    const networkConfig = yield* NetworkConfigService;
    const output = yield* Output;

    const limit = Number(args.limit);
    const offset = Number(args.offset);

    let entries = yield* history.list({
      from: args.from,
      to: args.to,
      token: args.token,
      limit,
      offset,
    });

    const pendingBridge = entries.filter((e) => {
      if (e.status !== 'pending') return false;
      const route = inferRoute(e);
      return route === 'evm-to-fast' || route === 'fast-to-evm';
    });
    if (pendingBridge.length > 0) {
      yield* Effect.forEach(
        pendingBridge,
        (entry) =>
          Effect.gen(function* () {
            const networkCfg = yield* networkConfig.resolve(entry.network).pipe(Effect.option);
            if (Option.isNone(networkCfg) || !networkCfg.value.allset) return;
            const portalApiUrl = networkCfg.value.allset.portalApiUrl;
            const route = inferRoute(entry);

            const confirmed = yield* Effect.promise(() =>
              route === 'evm-to-fast'
                ? isDepositConfirmed(portalApiUrl, entry.from, entry.hash)
                : isWithdrawConfirmed(portalApiUrl, entry.from, entry.hash),
            );
            if (confirmed) {
              yield* history.updateStatus(entry.hash, 'confirmed');
            }
          }),
        { concurrency: 3 },
      );

      entries = yield* history.list({
        from: args.from,
        to: args.to,
        token: args.token,
        limit,
        offset,
      });
    }

    yield* output.humanTable(
      ['HASH', 'TYPE', 'FROM', 'TO', 'AMOUNT', 'TOKEN', 'STATUS', 'TIME'],
      entries.map((e) => [
        `${e.hash.slice(0, 10)}...`,
        e.type,
        `${e.from.slice(0, 10)}...`,
        `${e.to.slice(0, 10)}...`,
        e.formatted,
        e.tokenName,
        e.status,
        e.timestamp,
      ]),
    );
    yield* output.success({ transactions: entries });
  })),
});
```

- [ ] **Step 4.5: Rewrite `info/index.ts`**

```typescript
import { defineCommand } from 'citty';
import { infoBalance } from './balance.js';
import { infoHistory } from './history.js';
import { infoStatus } from './status.js';
import { infoTx } from './tx.js';

export const infoCommand = defineCommand({
  meta: { name: 'info', description: 'Query network and account information' },
  subCommands: {
    status: infoStatus,
    balance: infoBalance,
    tx: infoTx,
    history: infoHistory,
  },
});
```

- [ ] **Step 4.6: Commit info commands**

```bash
git add app/cli/src/commands/info/
git commit -m "refactor(fast-cli): migrate info commands to citty"
```

---

## Task 5: Migrate send command

**Files:** Modify `app/cli/src/commands/send.ts`.

This is the most complex command. The handler body is long; keep all existing logic, only convert `args` access and the wrapper.

- [ ] **Step 5.1: Rewrite the wrapper and the options in `send.ts`**

The top of the file (replace lines 1-55 in the current file) becomes:

```typescript
import { defineCommand } from 'citty';
import { bech32m } from 'bech32';
import { Effect } from 'effect';
import { Signer, TransactionBuilder, FastProvider, hashHex, toHex } from '@fastxyz/fast-sdk';
import { bcsSchema, VersionedTransactionFromBcs } from '@fastxyz/fast-schema';
import { executeDeposit, executeWithdraw, createEvmWallet, createEvmExecutor } from '@fastxyz/allset-sdk';
import { globalArgs } from '../cli-globals.js';
import { runHandler } from '../cli-runner.js';
import { AccountStore } from '../services/account-store.js';
import { PasswordService } from '../services/password-service.js';
import { FastRpc } from '../services/fast-rpc.js';
import { Output } from '../services/output.js';
import { CliConfig } from '../services/cli-config.js';
import { HistoryStore } from '../services/history-store.js';
import { NetworkConfigService } from '../services/network-config.js';
import { resolveToken } from '../services/token-resolver.js';
import {
  InvalidAddressError,
  InvalidAmountError,
  InvalidConfigError,
  UnsupportedChainError,
  UserCancelledError,
  TransactionFailedError,
} from '../errors/index.js';
import { HistoryEntry } from '../schemas/history.js';

export const sendCommand = defineCommand({
  meta: { name: 'send', description: 'Send tokens (Fast→Fast, EVM→Fast, or Fast→EVM)' },
  args: {
    ...globalArgs,
    address: {
      type: 'positional',
      description: 'Recipient address (fast1... for Fast, 0x... for EVM)',
      required: true,
    },
    amount: {
      type: 'positional',
      description: 'Human-readable amount (e.g., 10.5)',
      required: true,
    },
    token: {
      type: 'string',
      description: 'Token to send (e.g., testUSDC, USDC). Defaults to the first token available on the current network.',
    },
    'from-chain': {
      type: 'string',
      description: 'Source EVM chain for bridge-in (e.g., arbitrum-sepolia)',
    },
    'to-chain': {
      type: 'string',
      description: 'Destination EVM chain for bridge-out (e.g., arbitrum-sepolia)',
    },
  },
  run: ({ args }) => runHandler(args, Effect.gen(function* () {
    // handler body goes here — see Step 5.2
  })),
});
```

- [ ] **Step 5.2: Update the handler body arg access**

Inside the `Effect.gen` body (the existing logic from lines 55-365 of the original), replace these lines:

| Original | Replacement |
| --- | --- |
| `const fromChain = Option.getOrUndefined(args.fromChain);` | `const fromChain = args['from-chain'];` |
| `const toChain = Option.getOrUndefined(args.toChain);` | `const toChain = args['to-chain'];` |
| `Option.getOrElse(args.token, () => { ... })` | `args.token ?? (() => { ... })()` (wrap body as IIFE) |

Concretely, the token-resolution block becomes:

```typescript
const resolvedTokenName = args.token ?? (() => {
  const chains = network.allset?.chains ?? {};
  const firstChain = Object.values(chains)[0];
  return firstChain ? (Object.keys(firstChain.tokens)[0] ?? 'USDC') : 'USDC';
})();
```

All other references to `args.address`, `args.amount` already work as plain strings — no changes needed. Remove the `import { Option } from 'effect'` line if no other `Option` usages remain in this file. Keep `import { Effect } from 'effect'` (still used heavily).

- [ ] **Step 5.3: Sanity-check for leftover Option usage**

Run:

```bash
grep -n "Option\." app/cli/src/commands/send.ts
```

Expected: no matches. If any remain, convert them (`Option.isSome(x)` → `x !== undefined`, etc.).

- [ ] **Step 5.4: Commit send command**

```bash
git add app/cli/src/commands/send.ts
git commit -m "refactor(fast-cli): migrate send command to citty"
```

---

## Task 6: Rewrite root command and entrypoint

**Files:** Modify `app/cli/src/cli.ts` and `app/cli/src/main.ts`.

- [ ] **Step 6.1: Rewrite `cli.ts`**

```typescript
import { defineCommand } from 'citty';
import { accountCommand } from './commands/account/index.js';
import { infoCommand } from './commands/info/index.js';
import { networkCommand } from './commands/network/index.js';
import { sendCommand } from './commands/send.js';

export const rootCommand = defineCommand({
  meta: {
    name: 'fast',
    version: '0.1.0',
    description: 'Fast CLI - Account, network, and transaction management',
  },
  subCommands: {
    account: accountCommand,
    network: networkCommand,
    info: infoCommand,
    send: sendCommand,
  },
});
```

- [ ] **Step 6.2: Rewrite `main.ts`**

```typescript
import { runMain } from 'citty';
import { rootCommand } from './cli.js';

runMain(rootCommand);
```

That is the whole file. All error handling now lives inside `runHandler` (created in Task 1), so the top-level shim is trivial. Unhandled throws propagate to citty's `runMain`, which prints usage and exits non-zero.

- [ ] **Step 6.3: Build**

```bash
pnpm -F @fastxyz/fast-cli build
```

Expected: `ESM ⚡️ Build success`. If tsup prints TypeScript errors, fix them in the named files before moving on (most likely culprits: stale imports from `@effect/cli` or `effect`'s `Option`).

- [ ] **Step 6.4: Smoke-test help output**

```bash
node app/cli/dist/main.js --help
node app/cli/dist/main.js account --help
node app/cli/dist/main.js send --help
```

Expected: clean help output (no double separators), subcommand list shows all commands, every global flag (`--json`, `--debug`, `--non-interactive`, `--network`, `--account`, `--password`) appears under each leaf command.

- [ ] **Step 6.5: Commit root + entry**

```bash
git add app/cli/src/cli.ts app/cli/src/main.ts
git commit -m "refactor(fast-cli): wire citty root command and entrypoint"
```

---

## Task 7: Clean up obsolete exports

**Files:** Modify `app/cli/src/services/cli-config.ts`.

- [ ] **Step 7.1: Rewrite `cli-config.ts` to only keep the service pieces**

Delete everything except the Effect service definition. `readDefaultNetwork`, `rootOptions`, and `provideCliConfig` are all obsolete: `readDefaultNetwork` has been duplicated into `cli-globals.ts`; `rootOptions` was the `@effect/cli` option definition; `provideCliConfig` was an `@effect/cli`-specific layer binder.

The final file should look like:

```typescript
import { Context, Layer, type Option } from 'effect';

export interface CliConfigShape {
  readonly json: boolean;
  readonly debug: boolean;
  readonly nonInteractive: boolean;
  readonly network: string;
  readonly account: Option.Option<string>;
  readonly password: Option.Option<string>;
}

export class CliConfig extends Context.Tag('CliConfig')<CliConfig, CliConfigShape>() {}

export const makeCliConfigLayer = (config: CliConfigShape): Layer.Layer<CliConfig> =>
  Layer.succeed(CliConfig, config);
```

- [ ] **Step 7.2: Verify nothing else imports the deleted exports**

```bash
grep -rn "rootOptions\|provideCliConfig\|readDefaultNetwork" app/cli/src/
```

Expected: the only match is `readDefaultNetwork` in `app/cli/src/cli-globals.ts` (if that's the case, good — the old copy in `cli-config.ts` was deleted). If any file still imports `rootOptions` or `provideCliConfig`, delete those imports.

- [ ] **Step 7.3: Full type-check**

```bash
npx --no-install tsc --noEmit -p app/cli/tsconfig.json 2>&1 | grep "error TS"
```

Expected: the same pre-existing errors from before the migration (check count against git baseline). No NEW errors should be introduced by the migration.

- [ ] **Step 7.4: Build**

```bash
pnpm -F @fastxyz/fast-cli build
```

Expected: `ESM ⚡️ Build success`.

- [ ] **Step 7.5: Commit cleanup**

```bash
git add app/cli/src/services/cli-config.ts
git commit -m "refactor(fast-cli): remove @effect/cli-specific exports"
```

---

## Task 8: Final verification

- [ ] **Step 8.1: Verify no @effect/cli references remain**

```bash
grep -rn "@effect/cli" app/cli/
```

Expected: no matches. If any remain, fix them.

- [ ] **Step 8.2: End-to-end smoke tests**

Run these against a testnet — **do not run with real credentials**:

```bash
# Help output quality check
node app/cli/dist/main.js --help
node app/cli/dist/main.js account --help
node app/cli/dist/main.js account list --help

# Read-only commands
node app/cli/dist/main.js network list --json
node app/cli/dist/main.js account list --json

# Commands with positional args
node app/cli/dist/main.js info tx 0xDEADBEEF --json
# (expect: TX_NOT_FOUND error with JSON error envelope, exit code 1)

# Global flag propagation
node app/cli/dist/main.js account list --json --debug
node app/cli/dist/main.js account list --non-interactive

# Version flag
node app/cli/dist/main.js --version
# (expect: 0.1.0)
```

Expected results:

- `--help` is cleanly formatted with no double blank-line separators
- `--json` output is a single valid JSON object
- `--version` prints `0.1.0`
- Error exit codes match the original mapping (check with `echo $?` after an error)

- [ ] **Step 8.3: Run a write command (creates real state)**

```bash
# Create a test account (will be kept, delete later if desired)
node app/cli/dist/main.js account create --name citty-migration-test --password test123 --non-interactive --json
echo $?  # Expected: 0
node app/cli/dist/main.js account list --json
# (expect: citty-migration-test appears in the list)
node app/cli/dist/main.js account delete citty-migration-test --non-interactive --json
# (expect: deletion succeeds)
```

- [ ] **Step 8.4: Squash-merge or keep individual commits**

Either squash the migration into one commit or keep the per-task commits. Ask the user.

---

## Verification summary

The migration is complete when all of these hold:

1. `grep -rn "@effect/cli" app/cli/` returns zero matches.
2. `pnpm -F @fastxyz/fast-cli build` succeeds.
3. `tsc --noEmit` error count is not higher than the pre-migration baseline.
4. `node app/cli/dist/main.js --help` shows clean, single-spaced output with all four subcommand groups.
5. `node app/cli/dist/main.js account list --json` returns a valid JSON envelope.
6. Create → list → delete round-trip for a test account succeeds with correct exit codes.
