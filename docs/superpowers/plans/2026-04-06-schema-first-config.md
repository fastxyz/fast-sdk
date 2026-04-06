<!-- markdownlint-disable MD013 -->
# Schema-first Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Derive all network config types from Effect Schemas, move bundled data to JSON manifests, introduce AppConfig service with pure function access, rename Config → ClientConfig.

**Architecture:** `schemas/networks.ts` is the single source of truth — schemas define both validation AND TypeScript types via `typeof Schema.Type`. Two JSON manifest files (`config/networks.json`, `config/app.json`) hold static data. `AppConfig` service loads them with pure functions callable before Effect layer (same pattern as `output.ts`). `ClientConfig` (renamed from `Config`) stays for per-invocation flags.

**Tech Stack:** TypeScript, Effect Schema, JSON import assertions.

**Spec:** [docs/superpowers/specs/2026-04-06-schema-first-config-design.md](../specs/2026-04-06-schema-first-config-design.md)

---

## File structure

**Created:**

- `app/cli/src/config/networks.json` — bundled network data
- `app/cli/src/config/app.json` — app metadata (name, version)
- `app/cli/src/services/config/app.ts` — AppConfig service + pure functions

**Modified:**

- `app/cli/src/schemas/networks.ts` — export schemas as named consts, derive types
- `app/cli/src/services/config/config.ts` → renamed to `client.ts`, Config → ClientConfig
- `app/cli/src/app.ts` — add AppConfigLive, rename Config → ClientConfig
- `app/cli/src/main.ts` — use getVersion/getAppName from app config
- `app/cli/src/services/storage/network.ts` — use AppConfig instead of bundledNetworks import
- `app/cli/src/services/token-resolver.ts` — import NetworkConfig type from schemas
- `app/cli/src/services/output.ts` — Config → ClientConfig
- `app/cli/src/services/prompt.ts` — Config → ClientConfig
- `app/cli/src/services/api/fast.ts` — Config → ClientConfig
- 5 command files that import Config — Config → ClientConfig

**Deleted:**

- `app/cli/src/config/bundled.ts` — data → networks.json, types → schemas
- `app/cli/src/config/constants.ts` — data → app.json

---

## Task 1: Create JSON manifests + derive types from schemas

**Files:**

- Create: `app/cli/src/config/networks.json`, `app/cli/src/config/app.json`
- Modify: `app/cli/src/schemas/networks.ts`

- [ ] **Step 1.1: Create `app/cli/src/config/app.json`**

```json
{
  "name": "fast",
  "version": "0.1.0"
}
```

- [ ] **Step 1.2: Create `app/cli/src/config/networks.json`**

Extract the data from `config/bundled.ts` lines 30-145 into a JSON file. The implementer should:

1. Read `app/cli/src/config/bundled.ts`
2. Copy the `bundledNetworks` object value (the `{ testnet: {...}, mainnet: {...} }` part)
3. Convert to valid JSON (double quotes, no trailing commas, no `as const`)
4. Write to `app/cli/src/config/networks.json`

The JSON structure must match `Record<string, NetworkConfig>` — each entry has `rpcUrl`, `explorerUrl`, `networkId`, and optional `allSet`.

- [ ] **Step 1.3: Update `app/cli/src/schemas/networks.ts` — export schemas + derive types**

The implementer should:

1. Read current `app/cli/src/schemas/networks.ts`
2. Export all intermediate schemas (currently they're `const`, not `export const`)
3. Add derived types using `typeof Schema.Type` for each schema
4. The `NetworkConfigSchema` class should remain for `Schema.decodeUnknown` usage

```typescript
import { Schema } from "effect";

export const AllSetChainTokenSchema = Schema.Struct({
  evmAddress: Schema.String,
  fastTokenId: Schema.String,
  decimals: Schema.Number,
});
export type AllSetChainTokenConfig = typeof AllSetChainTokenSchema.Type;

export const AllSetChainSchema = Schema.Struct({
  chainId: Schema.Number,
  bridgeContract: Schema.String,
  fastBridgeAddress: Schema.String,
  relayerUrl: Schema.String,
  evmRpcUrl: Schema.String,
  evmExplorerUrl: Schema.String,
  tokens: Schema.Record({ key: Schema.String, value: AllSetChainTokenSchema }),
});
export type AllSetChainConfig = typeof AllSetChainSchema.Type;

export const AllSetConfigSchema = Schema.Struct({
  crossSignUrl: Schema.String,
  portalApiUrl: Schema.String,
  chains: Schema.Record({ key: Schema.String, value: AllSetChainSchema }),
});
export type AllSetConfig = typeof AllSetConfigSchema.Type;

export const NetworkConfigSchema = Schema.Struct({
  rpcUrl: Schema.String,
  explorerUrl: Schema.String,
  networkId: Schema.String,
  allSet: Schema.optional(AllSetConfigSchema),
});
export type NetworkConfig = typeof NetworkConfigSchema.Type;

export const BundledNetworksSchema = Schema.Record({
  key: Schema.String,
  value: NetworkConfigSchema,
});
export type BundledNetworks = typeof BundledNetworksSchema.Type;
```

**IMPORTANT:** The `allSet` field uses `Schema.optional()` (not `Schema.optionalWith(..., { as: "Option" })`) because JSON data and the `NetworkConfig` type use plain `allSet?: ...` (not `Option<...>`). The Option wrapping was only needed when `CustomNetworkConfig` was a `Schema.Class` — with plain struct + derived types, `optional()` gives `allSet?: AllSetConfig`.

- [ ] **Step 1.4: Build to verify schemas compile**

```bash
pnpm -F @fastxyz/fast-cli build 2>&1 | tail -5
```

Build may have errors from other files still importing from `bundled.ts` — that's OK at this stage.

- [ ] **Step 1.5: Commit**

```bash
git add app/cli/src/config/app.json app/cli/src/config/networks.json app/cli/src/schemas/networks.ts
git commit -m "feat(fast-cli): add JSON manifests, derive types from schemas"
```

---

## Task 2: Create AppConfig service with pure functions

**Files:** Create `app/cli/src/services/config/app.ts`

- [ ] **Step 2.1: Create `app/cli/src/services/config/app.ts`**

```typescript
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Context, Layer, Schema } from "effect";
import {
  BundledNetworksSchema,
  type BundledNetworks,
  type NetworkConfig,
} from "../../schemas/networks.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const configDir = join(__dirname, "../../config");

// ---------------------------------------------------------------------------
// Load and validate JSON manifests at module load time
// ---------------------------------------------------------------------------

const appManifest: { name: string; version: string } = JSON.parse(
  readFileSync(join(configDir, "app.json"), "utf-8"),
);

const networksManifest: BundledNetworks = Schema.decodeUnknownSync(
  BundledNetworksSchema,
)(JSON.parse(readFileSync(join(configDir, "networks.json"), "utf-8")));

// ---------------------------------------------------------------------------
// Pure functions — callable before Effect layer exists
// ---------------------------------------------------------------------------

export const getAppName = (): string => appManifest.name;
export const getVersion = (): string => appManifest.version;
export const getBundledNetworks = (): BundledNetworks => networksManifest;
export const isBundledNetwork = (name: string): boolean =>
  name in networksManifest;
export const getBundledNetwork = (name: string): NetworkConfig | undefined =>
  networksManifest[name];

// ---------------------------------------------------------------------------
// Effect service — delegates to pure functions
// ---------------------------------------------------------------------------

export interface AppConfigShape {
  readonly name: string;
  readonly version: string;
  readonly bundledNetworks: BundledNetworks;
  readonly isBundledNetwork: (name: string) => boolean;
  readonly getBundledNetwork: (name: string) => NetworkConfig | undefined;
}

export class AppConfig extends Context.Tag("AppConfig")<
  AppConfig,
  AppConfigShape
>() {}

export const AppConfigLive = Layer.sync(AppConfig, () => ({
  name: getAppName(),
  version: getVersion(),
  bundledNetworks: getBundledNetworks(),
  isBundledNetwork,
  getBundledNetwork,
}));
```

**NOTE:** The file path resolution uses `import.meta.url` → `__dirname` → relative path to `config/` directory. After tsup bundles to `dist/main.js`, the `config/` directory needs to be accessible relative to the bundle output. The implementer should verify this works with the bundled output — they may need to adjust the path or copy the JSON files to `dist/config/` via `tsup.config.ts`.

- [ ] **Step 2.2: Commit**

```bash
git add app/cli/src/services/config/app.ts
git commit -m "feat(fast-cli): add AppConfig service with pure functions"
```

---

## Task 3: Rename Config → ClientConfig

**Files:** Rename `services/config/config.ts` → `services/config/client.ts`, update all importers

- [ ] **Step 3.1: Rename the file and update its exports**

1. Read `app/cli/src/services/config/config.ts`
2. Rename: `Config` → `ClientConfig`, `ConfigShape` → `ClientConfigShape`, `makeConfigLayer` → `makeClientConfigLayer`
3. Write to `app/cli/src/services/config/client.ts`
4. Delete `app/cli/src/services/config/config.ts`

New content of `client.ts`:

```typescript
import { Context, Layer, type Option } from "effect";

export interface ClientConfigShape {
  readonly json: boolean;
  readonly debug: boolean;
  readonly nonInteractive: boolean;
  readonly network: string;
  readonly account: Option.Option<string>;
  readonly password: Option.Option<string>;
}

export class ClientConfig extends Context.Tag("ClientConfig")<
  ClientConfig,
  ClientConfigShape
>() {}

export const makeClientConfigLayer = (
  config: ClientConfigShape,
): Layer.Layer<ClientConfig> => Layer.succeed(ClientConfig, config);
```

- [ ] **Step 3.2: Update ALL importers**

Find and replace across all files:

```bash
grep -rn "from.*config/config\|from.*config\.js" app/cli/src/ | grep -v node_modules | grep -v ".json"
```

For each file:

- Change import path from `config/config.js` → `config/client.js`
- Change `Config` → `ClientConfig`
- Change `ConfigShape` → `ClientConfigShape`
- Change `makeConfigLayer` → `makeClientConfigLayer`

Files to update (from our earlier grep):

- `app/cli/src/app.ts`
- `app/cli/src/services/output.ts`
- `app/cli/src/services/prompt.ts`
- `app/cli/src/services/api/fast.ts`
- `app/cli/src/commands/info/balance.ts`
- `app/cli/src/commands/info/status.ts`
- `app/cli/src/commands/send.ts`
- `app/cli/src/commands/account/info.ts`
- `app/cli/src/commands/account/export.ts`

- [ ] **Step 3.3: Build to verify rename didn't break anything**

```bash
pnpm -F @fastxyz/fast-cli build 2>&1 | tail -5
```

- [ ] **Step 3.4: Commit**

```bash
git add -A app/cli/src/
git commit -m "refactor(fast-cli): rename Config → ClientConfig"
```

---

## Task 4: Wire AppConfig into layers + update consumers

**Files:** Modify `app.ts`, `main.ts`, `network.ts`, `token-resolver.ts`

- [ ] **Step 4.1: Add AppConfigLive to `app/cli/src/app.ts` layer**

Add import:

```typescript
import { AppConfigLive } from "./services/config/app.js";
```

Add to foundation:

```typescript
const foundation = Layer.mergeAll(DatabaseLive, cliConfigLayer, AllSetLive, AppConfigLive);
```

Also update the `makeConfigLayer` → `makeClientConfigLayer` import if not done in Task 3.

- [ ] **Step 4.2: Update `app/cli/src/main.ts` — use pure functions**

Replace:

```typescript
import { PROGRAM_NAME, VERSION } from "./config/constants.js";
```

With:

```typescript
import { getAppName, getVersion } from "./services/config/app.js";
```

Replace all usages:

- `VERSION` → `getVersion()`
- `PROGRAM_NAME` → `getAppName()`

- [ ] **Step 4.3: Update `app/cli/src/services/storage/network.ts` — use AppConfig**

Replace:

```typescript
import {
  bundledNetworks,
  isBundledNetwork,
  type NetworkConfig,
} from "../../config/bundled.js";
```

With:

```typescript
import type { NetworkConfig } from "../../schemas/networks.js";
import { AppConfig } from "../config/app.js";
```

In `NetworkConfigLive`, add `yield* AppConfig` and replace all direct references:

- `bundledNetworks[name]` → `appConfig.getBundledNetwork(name)`
- `isBundledNetwork(name)` → `appConfig.isBundledNetwork(name)`
- `Object.keys(bundledNetworks)` → `Object.keys(appConfig.bundledNetworks)`

- [ ] **Step 4.4: Update `app/cli/src/services/token-resolver.ts` — import type from schemas**

Replace:

```typescript
import type { NetworkConfig } from "../config/bundled.js";
```

With:

```typescript
import type { NetworkConfig } from "../schemas/networks.js";
```

- [ ] **Step 4.5: Delete old files**

```bash
rm app/cli/src/config/bundled.ts
rm app/cli/src/config/constants.ts
```

- [ ] **Step 4.6: Build + smoke-test**

```bash
pnpm -F @fastxyz/fast-cli build 2>&1 | tail -5
rm -rf ~/.fast
node app/cli/dist/main.js --version
node app/cli/dist/main.js --help | head -5
node app/cli/dist/main.js network list --json
node app/cli/dist/main.js account create --name config-test --password testpw --non-interactive --json
node app/cli/dist/main.js account delete config-test --non-interactive --json
```

Expected: version shows `0.1.0`, help works, network list shows testnet + mainnet, account lifecycle works.

**If build fails on JSON import paths:** The bundled `dist/main.js` may not find `config/networks.json` relative to its location. Check that `tsup` copies the JSON files or adjust the path resolution in `services/config/app.ts`.

- [ ] **Step 4.7: Verify no stale imports**

```bash
grep -rn "config/bundled\|config/constants\|from.*config/config" app/cli/src/ || echo "all clean"
```

- [ ] **Step 4.8: Commit**

```bash
git add -A app/cli/src/
git rm app/cli/src/config/bundled.ts app/cli/src/config/constants.ts 2>/dev/null
git commit -m "refactor(fast-cli): wire AppConfig, update consumers, delete bundled.ts + constants.ts"
```

---

## Task 5: Verification

- [ ] **Step 5.1: No hand-written interfaces for network types**

```bash
grep -rn "interface AllSet\|interface Network" app/cli/src/ || echo "no hand-written interfaces"
```

Expected: "no hand-written interfaces" — all types derived from schemas.

- [ ] **Step 5.2: JSON manifests exist**

```bash
cat app/cli/src/config/app.json
wc -l app/cli/src/config/networks.json
```

- [ ] **Step 5.3: Old files deleted**

```bash
ls app/cli/src/config/bundled.ts app/cli/src/config/constants.ts 2>&1
```

Expected: both "No such file or directory".

- [ ] **Step 5.4: Full lifecycle smoke test**

```bash
rm -rf ~/.fast
pnpm -F @fastxyz/fast-cli build
node app/cli/dist/main.js --version
node app/cli/dist/main.js network list --json
node app/cli/dist/main.js account create --name verify --password pw --non-interactive --json
node app/cli/dist/main.js account list --json
node app/cli/dist/main.js account delete verify --non-interactive --json
node app/cli/dist/main.js info status --json
```

---

## Verification summary

Complete when:

1. `schemas/networks.ts` exports schemas AND derived types (no hand-written interfaces anywhere)
2. `config/app.json` and `config/networks.json` exist
3. `config/bundled.ts` and `config/constants.ts` deleted
4. `ClientConfig` (not `Config`) used everywhere
5. `AppConfig` service in the layer, pure functions for pre-layer access
6. Build succeeds, all commands work
