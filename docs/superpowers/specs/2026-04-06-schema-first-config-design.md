<!-- markdownlint-disable MD013 -->
# Schema-first Config: Derived Types, JSON Manifests, AppConfig Service

## Goal

Make the Effect Schema the single source of truth for network config types. Move bundled network data and app metadata to JSON manifest files. Introduce an `AppConfig` service with pure function access (same pattern as `output.ts`). Rename `CliConfig` → `ClientConfig`.

## Problems solved

1. **Duplicated type definitions.** `config/bundled.ts` defines 4 interfaces (`AllSetChainTokenConfig`, `AllSetChainConfig`, `AllSetConfig`, `NetworkConfig`) by hand — exact mirrors of the schemas in `schemas/networks.ts`. One source of truth eliminates drift.
2. **Hardcoded data in TypeScript.** ~120 lines of URLs, addresses, and chain IDs are baked into `bundled.ts` as TypeScript objects. A `networks.json` file makes updates easier (no TS knowledge needed, no rebuild for data-only changes in dev).
3. **Scattered constants.** `VERSION` and `PROGRAM_NAME` live in `config/constants.ts`. App metadata belongs in a manifest file alongside the network data.
4. **Naming confusion.** `CliConfig` / `Config` is a vague name. `ClientConfig` (per-invocation flags) vs `AppConfig` (static app metadata) is clearer.

## Architecture

### Single source of truth: `schemas/networks.ts`

The schema file defines both the Effect Schema AND the derived TypeScript types:

```typescript
export const AllSetChainTokenSchema = Schema.Struct({ ... });
export type AllSetChainTokenConfig = typeof AllSetChainTokenSchema.Type;

export const AllSetChainSchema = Schema.Struct({ ... });
export type AllSetChainConfig = typeof AllSetChainSchema.Type;

export const AllSetConfigSchema = Schema.Struct({ ... });
export type AllSetConfig = typeof AllSetConfigSchema.Type;

export const NetworkConfigSchema = Schema.Struct({ ... });
export type NetworkConfig = typeof NetworkConfigSchema.Type;
```

No hand-written interfaces anywhere. The schema IS the type definition.

### JSON manifest files

**`app/cli/src/config/networks.json`** — bundled network definitions:

```json
{
  "testnet": {
    "rpcUrl": "https://testnet.api.fast.xyz/proxy",
    "explorerUrl": "https://testnet.explorer.fast.xyz",
    "networkId": "fast:testnet",
    "allSet": { ... }
  },
  "mainnet": { ... }
}
```

**`app/cli/src/config/app.json`** — app metadata:

```json
{
  "name": "fast",
  "version": "0.1.0"
}
```

### Pure functions + AppConfig service

Same pattern as `output.ts` (`writeOk`/`writeFail` are pure, `OutputLive` delegates). Pure functions load and validate the JSON. The `AppConfig` service wraps them for Effect code. `main.ts` calls the pure functions directly (before the service layer exists).

**`app/cli/src/services/config/app.ts`:**

```typescript
// Pure functions — callable before Effect layer
export const getAppName = (): string => appManifest.name;
export const getVersion = (): string => appManifest.version;
export const getBundledNetworks = (): Record<string, NetworkConfig> => ...;
export const isBundledNetwork = (name: string): boolean => ...;

// Effect service — delegates to pure functions
export interface AppConfigShape {
  readonly name: string;
  readonly version: string;
  readonly bundledNetworks: Record<string, NetworkConfig>;
  readonly isBundledNetwork: (name: string) => boolean;
}
export class AppConfig extends Context.Tag("AppConfig")<AppConfig, AppConfigShape>() {}
export const AppConfigLive = Layer.sync(AppConfig, () => ({
  name: getAppName(),
  version: getVersion(),
  bundledNetworks: getBundledNetworks(),
  isBundledNetwork,
}));
```

### ClientConfig (renamed from CliConfig/Config)

Per-invocation CLI flags. Same logic, just renamed:

- `Config` tag → `ClientConfig`
- `ConfigShape` → `ClientConfigShape`
- File: `services/config/client.ts` (renamed from `services/config/config.ts`)

## File changes

| File | Change |
| --- | --- |
| `app/cli/src/config/networks.json` | **NEW** — bundled network data (extracted from bundled.ts) |
| `app/cli/src/config/app.json` | **NEW** — app name + version |
| `app/cli/src/schemas/networks.ts` | **MODIFY** — export schemas as named consts, derive types with `typeof Schema.Type` |
| `app/cli/src/services/config/app.ts` | **NEW** — AppConfig service + pure functions |
| `app/cli/src/services/config/client.ts` | **RENAME** from `config.ts` — rename Config → ClientConfig |
| `app/cli/src/config/bundled.ts` | **DELETE** — data moves to networks.json, types to schemas/networks.ts |
| `app/cli/src/config/constants.ts` | **DELETE** — version/name move to app.json |
| `app/cli/src/main.ts` | **MODIFY** — import getVersion/getAppName instead of constants |
| `app/cli/src/app.ts` | **MODIFY** — add AppConfigLive to layer, rename Config → ClientConfig |
| `app/cli/src/services/storage/network.ts` | **MODIFY** — use AppConfig instead of importing bundledNetworks directly |
| `app/cli/src/services/output.ts` | **MODIFY** — rename Config → ClientConfig |
| `app/cli/src/services/prompt.ts` | **MODIFY** — rename Config → ClientConfig |
| All command files using Config | **MODIFY** — rename Config → ClientConfig |

## One schema, three uses

After this refactor, `NetworkConfigSchema` validates:

1. **Bundled networks** — `networks.json` validated at module load via `Schema.decodeUnknownSync`
2. **User input** — config file during `network add` via `Schema.decodeUnknown`
3. **Database reads** — stored JSON during `network resolve` via `Schema.decodeUnknown`

## TypeScript config

`tsconfig.json` needs `"resolveJsonModule": true` to support `import ... from "./networks.json"`. Check if already enabled; add if not.
