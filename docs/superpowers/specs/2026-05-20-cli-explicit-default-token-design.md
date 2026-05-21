# CLI explicit default-token resolution — design

**Status:** Draft (PR #87 follow-up)
**Date:** 2026-05-20
**Author:** Xiaohong

## Goal

Make the CLI's `--token` resolution **explicit and predictable** across `send` (all three routes) and `fund usdc crypto`. Eliminate the silent "first chain's first token" fallback that today picks an arbitrary asset when `--token` is omitted, and replace it with a single, configuration-driven default sourced from the SDK.

When the default doesn't apply to the requested route (e.g., `fastUSD` on an EVM chain) or when the network has no default at all, fail loudly with a tailored error that names the actual problem.

## Background

PR [#87](https://github.com/fastxyz/fast-sdk/pull/87) introduces a `fastTokens` map on `NetworkConfig`, a `fund` subtree restructure, and a `fastUSD`-as-mainnet-default policy implemented via `pickDefaultTokenName` / `resolveDefaultToken` / `selectSendTokenName`. The branch is mergeable and ready to land per `docs/superpowers/plans/2026-05-20-land-pr-87-fastusd.md`.

Independently, PR [#88](https://github.com/fastxyz/fast-sdk/pull/88) (already on `main` as commit `c01ec1e`) added `defaultToken: FastToken` to the SDK's `mainnet` and `testnet` network constants:

- `mainnet.defaultToken = { symbol: "fastUSD", tokenId: "0x125b60bb…", decimals: 6 }`
- `testnet.defaultToken = { symbol: "testUSDC", tokenId: "0xd73a0679…", decimals: 6 }`

The CLI imports `mainnet` and `testnet` from `@fastxyz/sdk/networks` (in [config/networks.ts](../../../app/cli/src/config/networks.ts)) but currently consumes only `url`, `explorerUrl`, and `networkId` — `defaultToken` is sitting in the dependency graph unused.

This spec replaces PR #87's CLI-side default-resolution machinery with a single resolution path that reads `network.defaultToken.symbol`. The PR-#87 helpers (`pickDefaultTokenName`, `resolveDefaultToken`, `selectSendTokenName`) and the CLI-only `fastTokens` map become dead code and are removed.

## Scope

### In scope

1. Plumb the SDK's `defaultToken` through the CLI's `NetworkConfig` schema.
2. Resolve `args.token ?? network.defaultToken?.symbol` in `send` and `fund usdc crypto`.
3. New error type for the "command does not support this token on this network" case (route × token incompatibility).
4. Tailored error message for the "no default token configured" case (custom network without `defaultToken`).
5. Remove PR-#87 default-resolution code paths now made redundant.
6. Fix the broken humanized-amount log line in [packages/x402-client/src/fast.ts:141](../../../packages/x402-client/src/fast.ts#L141).
7. Doc sync: `SPEC.md`, `app/cli/README.md`, root `README.md`, `skills/fast/SKILL.md`.

### Out of scope (separate PRs / issues)

- **`fund usdc crypto` semantic mismatch.** The command name implies "USDC," but with `fastUSD` as the mainnet default the user must type `--token USDC` for the bridge case. Filed as a separate GitHub issue; this PR only improves the error message for this case.
- **New CLI commands** for managing the default token. The user-controlled override path is the existing `fast network add <name> --config <path>` with `defaultToken` in the JSON.
- **Handler-level Effect-runtime test scaffolding.** Precedent from PR #87 manifest: smoke + pure-unit coverage only.

## Architecture

### Default-token resolution chain

```
SDK packages/fast-sdk/src/networks/{mainnet,testnet}.ts
    defaultToken: { tokenId, symbol, decimals }
        │
        ▼
CLI app/cli/src/config/networks.ts
    bundledNetworks.mainnet.defaultToken  = sdkMainnet.defaultToken
    bundledNetworks.testnet.defaultToken  = sdkTestnet.defaultToken
        │
        ▼
CLI app/cli/src/schemas/networks.ts
    NetworkConfigSchema  +  defaultToken: Schema.optional(FastTokenSchema)
        │
        ▼
CLI handlers (send, fund/usdc/crypto)
    const tokenName = args.token ?? network.defaultToken?.symbol;
    if (tokenName === undefined)  →  InvalidUsageError: "No default token found on <network>; please specify a token."
        │
        ▼
CLI services/token-resolver.ts
    resolveToken(tokenName, network, chain?)
        ├─ chain context: look in allset.chains[chain].tokens
        │     ├─ found → return ResolvedToken (with evmAddress)
        │     └─ not found → TokenNotFoundError  (rewrapped by handler as CommandUnsupportedForTokenError)
        └─ no chain context:
              ├─ network.defaultToken.symbol === tokenName → return ResolvedToken from defaultToken  (handles fastUSD)
              ├─ scan allset.chains[*].tokens for first match → return ResolvedToken
              └─ no match → TokenNotFoundError
```

The route compatibility check (resolver throwing for `fastUSD` × `arbitrum`) is enforced **by data**, not by new validation logic. The new error type only changes the message users see for an already-existing failure mode.

### Type discipline

Every `Effect` in a `Command<Args>` handler carries an error channel typed as `ClientError` (the union in [`app/cli/src/errors/index.ts`](../../../app/cli/src/errors/index.ts)). The handler must not leak `unknown` errors at the type level, and the runtime channel must only contain concrete `ClientError` variants.

This matters because `resolveToken` (and most other synchronous helpers) `throw` rather than returning typed failures. Wrapping a synchronous throw in `Effect.try` with the trivial `catch: (e) => e` widens the channel to `unknown` — the downstream `Effect.mapError` callback then receives `e: unknown` and any branch that returns `e` unchanged escapes the `ClientError` union and breaks type-check.

The convention used across the CLI (see [`commands/send.ts:127–136`](../../../app/cli/src/commands/send.ts#L127) and [`commands/fund/crypto.ts:75–81`](../../../app/cli/src/commands/fund/crypto.ts#L75)) is:

1. The `catch:` callback **narrows** to a union of known thrown types plus `Error` (e.g., `catch: (e) => e as TokenNotFoundError | UnsupportedChainError | Error`). This is a type assertion — it does not add runtime checks, but it documents the expected throw set and tightens the `Effect.try` error channel.
2. The trailing `Effect.mapError` handles each known variant explicitly (e.g., rewrap `TokenNotFoundError` as `CommandUnsupportedForTokenError`) and **funnels every other path through a concrete `ClientError` variant** — typically `TransactionFailedError({ message: String(e), cause: e })`. No branch may return a bare unmapped `Error`.

The two new code-change sections below (5 and 6) follow this pattern.

### What survives from PR #87

Survives:
- The 2-deep `fund` tree (`fund usdc {fiat, crypto}` + `fund fastusd`).
- `lookupTokenNameById` (used by `pay-asset-label.ts` for x402 dry-run labels), with a fallback that consults `network.defaultToken` when no chain-scoped match is found.
- The vitest test infrastructure under `app/cli/tests/`.

Removed:
- `pickDefaultTokenName` and `resolveDefaultToken` in `services/token-resolver.ts`.
- `selectSendTokenName` (whole file `commands/send-token-helper.ts`).
- `fastTokens: Schema.optional(...)` field on `NetworkConfigSchema`.
- `fastTokens.fastUSD` entry on the bundled `mainnet` network config (the same token id lives in `mainnet.defaultToken` via the SDK).

## Behavior changes

### `fast send <addr> <amount>` — Fast → Fast (no chain flags)

| Today (post-PR-87)                                                            | After this PR                                                                                            |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `--token` omitted → `selectSendTokenName` → `pickDefaultTokenName` → fastUSD  | `--token` omitted → `network.defaultToken.symbol` (= fastUSD on mainnet, testUSDC on testnet)            |
| Fastnetwork without any `fastTokens` entry → falls through to first EVM token | Network without `defaultToken` → `InvalidUsageError`: `"No default token found on <network>; please specify a token."` |

### `fast send <addr> <amount> --from-chain <chain>` — EVM → Fast (bridge-in)

| Today                                                            | After this PR                                                                                                                                 |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `--token` omitted → silent fallback to chain's first token       | `--token` omitted → `network.defaultToken.symbol`. If that token isn't in `allSet.chains[<chain>].tokens` → `CommandUnsupportedForTokenError` |
| `--token X` provided → resolves via chain-scoped tokens registry | Unchanged                                                                                                                                     |

### `fast send <addr> <amount> --to-chain <chain>` — Fast → EVM (bridge-out)

Same as `--from-chain`: default-resolves to `network.defaultToken.symbol`, errors via `CommandUnsupportedForTokenError` if it isn't on the chosen chain.

### `fast fund usdc crypto <amount> --chain <chain>`

| Today                                                                          | After this PR                                                                                                                          |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `--token` omitted → `args.token ?? Object.keys(chainCfg.tokens)[0] ?? "USDC"`  | `--token` omitted → `network.defaultToken.symbol` (fastUSD on mainnet). Bridge can't carry fastUSD → `CommandUnsupportedForTokenError` |

The error message names USDC explicitly (`"Try --token USDC. See 'fast info bridge-tokens'."`) to bridge users from "I want to fund my account with stablecoins via the bridge" to the correct invocation, until the separate semantic-mismatch issue resolves the deeper UX.

### `fast fund usdc fiat`

Unchanged. No `--token` flag.

### `fast fund fastusd`

Unchanged. No `--token` flag.

### `fast pay <url>`

Unchanged in behavior. The diagnostic log line at [packages/x402-client/src/fast.ts:141](../../../packages/x402-client/src/fast.ts#L141) is corrected — see below.

## New error type

```ts
// app/cli/src/errors/transaction.ts (alongside the existing token errors)

export class CommandUnsupportedForTokenError extends Data.TaggedError(
  "CommandUnsupportedForTokenError",
)<{
  readonly command: string;          // e.g. "send --from-chain arbitrum", "fund usdc crypto"
  readonly token: string;
  readonly network: string;
  readonly suggestion?: string;      // optional follow-up hint, e.g. "Try --token USDC."
}> {
  readonly exitCode = 2 as const;
  readonly errorCode = "COMMAND_UNSUPPORTED_FOR_TOKEN" as const;
  get message() {
    const base = `${this.command} is not supported for ${this.token} on ${this.network}.`;
    return this.suggestion ? `${base} ${this.suggestion}` : base;
  }
}
```

Added to the `ClientError` union in [errors/index.ts](../../../app/cli/src/errors/index.ts).

**Where it's raised.** Each handler catches `TokenNotFoundError` from `resolveToken` in the chain-context branch and rewraps it as `CommandUnsupportedForTokenError` with the command label, the resolved token name (defaulted or explicit), the current network name, and a route-appropriate suggestion. `TokenNotFoundError` remains the error for the Fast → Fast branch (where the token is simply not registered anywhere on the network).

### Suggested error messages

Each command has two branches: the **defaulted** case (user omitted `--token`, handler filled in `network.defaultToken.symbol`) and the **explicit-but-wrong-chain** case (user passed a `--token` that is known on the network but not on the chosen chain). The "Pass --token explicitly." hint only appears in the defaulted branch — when the user already passed `--token`, that advice is wrong.

- `send --from-chain <X>`
  - defaulted: `"send --from-chain <X> is not supported for fastUSD on mainnet. Pass --token explicitly. See 'fast info bridge-tokens' for tokens available on <X>."`
  - explicit: `"send --from-chain <X> is not supported for <TOKEN> on mainnet. See 'fast info bridge-tokens' for tokens available on <X>."`
- `send --to-chain <X>`
  - defaulted: `"send --to-chain <X> is not supported for fastUSD on mainnet. Pass --token explicitly. See 'fast info bridge-tokens' for tokens available on <X>."`
  - explicit: `"send --to-chain <X> is not supported for <TOKEN> on mainnet. See 'fast info bridge-tokens' for tokens available on <X>."`
- `fund usdc crypto --chain <X>`
  - defaulted: `"fund usdc crypto is not supported for fastUSD on mainnet. Try --token USDC. Pass --token explicitly. See 'fast info bridge-tokens' for tokens available on <X>."`
  - explicit: `"fund usdc crypto is not supported for <TOKEN> on mainnet. Try --token USDC. See 'fast info bridge-tokens' for tokens available on <X>."`

Typo / unknown-token inputs (e.g., `--token USDD` where `USDD` exists nowhere on the network) keep producing the existing `TokenNotFoundError` (`"Unknown token …; run 'fast info bridge-tokens'"`) instead of the misleading "Pass --token explicitly" wording — the user already did.

The "no default" branch uses the existing `InvalidUsageError`:

- `"No default token found on <network>; please specify a token."`

## Code changes (shape)

### 1. `packages/fast-sdk` — no changes

PR #88 already provides `defaultToken` on `mainnet` and `testnet`.

### 2. `app/cli/src/schemas/networks.ts`

Add:

```ts
export const FastTokenSchema = Schema.Struct({
  tokenId: Schema.String,
  symbol: Schema.String,
  decimals: Schema.Number,
});
export type FastTokenConfig = typeof FastTokenSchema.Type;
```

Extend `NetworkConfigSchema`:

```ts
export const NetworkConfigSchema = Schema.Struct({
  url: Schema.String,
  explorerUrl: Schema.String,
  networkId: NetworkId,
  defaultToken: Schema.optional(FastTokenSchema),
  allSet: Schema.optional(AllSetConfigSchema),
});
```

**Remove** the `fastTokens` field added by PR #87.

> **Note on field naming.** `FastTokenSchema.tokenId` mirrors the SDK's `FastToken.tokenId` (one of two ways the codebase names the Fast-side token identifier). The existing `AllSetChainTokenSchema.fastTokenId` keeps its name. The two coexist intentionally — they describe different config shapes — and `lookupTokenNameById` reads both.

### 3. `app/cli/src/config/networks.ts`

Populate `defaultToken` for the two bundled networks:

```ts
testnet: {
  url: sdkTestnet.url,
  explorerUrl: sdkTestnet.explorerUrl,
  networkId: sdkTestnet.networkId,
  defaultToken: sdkTestnet.defaultToken,
  allSet: { /* unchanged */ },
},
mainnet: {
  url: sdkMainnet.url,
  explorerUrl: sdkMainnet.explorerUrl,
  networkId: sdkMainnet.networkId,
  defaultToken: sdkMainnet.defaultToken,
  allSet: { /* unchanged */ },
},
```

Remove the PR-#87 `fastTokens.fastUSD` entry from mainnet.

### 4. `app/cli/src/services/token-resolver.ts`

Remove `pickDefaultTokenName` and `resolveDefaultToken`. Keep `resolveToken` and `lookupTokenNameById`.

**Update `resolveToken`** to consult `network.defaultToken` in the Fast → Fast branch before the chain scan. Without this, mainnet Fast → Fast with `--token fastUSD` (explicit or defaulted) would throw `TokenNotFoundError` because `fastUSD` has no entry in any `allset.chains[*].tokens` map:

```ts
export function resolveToken(
  tokenName: string,
  networkConfig: NetworkConfig,
  chain?: string,
): ResolvedToken {
  // Chain context (bridge route): only consult chain-scoped tokens.
  if (chain) {
    const allset = networkConfig.allSet;
    if (!allset) throw new TokenNotFoundError({ token: tokenName });
    const chainConfig = allset.chains[chain];
    if (!chainConfig) throw new UnsupportedChainError({ chain });
    const token = chainConfig.tokens[tokenName];
    if (!token) throw new TokenNotFoundError({ token: tokenName });
    return {
      fastTokenId: fromHex(token.fastTokenId),
      decimals: token.decimals,
      evmAddress: token.evmAddress,
    };
  }

  // No chain context (Fast → Fast):
  // 1) Match against network.defaultToken (handles fastUSD on mainnet).
  const def = networkConfig.defaultToken;
  if (def && def.symbol === tokenName) {
    return {
      fastTokenId: fromHex(def.tokenId),
      decimals: def.decimals,
    };
  }

  // 2) Fall back to scanning chain-scoped tokens (handles testUSDC, USDC, etc.).
  const allset = networkConfig.allSet;
  if (allset) {
    for (const chainConfig of Object.values(allset.chains)) {
      const token = chainConfig.tokens[tokenName];
      if (token) {
        return {
          fastTokenId: fromHex(token.fastTokenId),
          decimals: token.decimals,
        };
      }
    }
  }

  throw new TokenNotFoundError({ token: tokenName });
}
```

For tokens that exist in both `defaultToken` and `allset.chains[*].tokens` (e.g., testUSDC on testnet), the `defaultToken` short-circuit wins. Both sources must encode the same `fastTokenId`/`decimals` to remain consistent; if a config bug introduces divergence, the explicit `defaultToken` is the authoritative value.

**Update `lookupTokenNameById`** to consult `network.defaultToken` as a final fallback (replaces the `fastTokens` consultation):

```ts
export function lookupTokenNameById(
  networkConfig: NetworkConfig,
  fastTokenId: string,
): string | undefined {
  const target = norm(fastTokenId);

  const allset = networkConfig.allSet;
  if (allset) {
    for (const chain of Object.values(allset.chains)) {
      for (const [name, entry] of Object.entries(chain.tokens)) {
        if (norm(entry.fastTokenId) === target) return name;
      }
    }
  }

  const def = networkConfig.defaultToken;
  if (def && norm(def.tokenId) === target) return def.symbol;

  return undefined;
}
```

**Add `tokenIsKnownOnNetwork`** — a small predicate used by handlers to decide whether a chain-context `TokenNotFoundError` is a token-on-wrong-chain situation (rewrap as `CommandUnsupportedForTokenError`) or a typo / unknown token (keep as `TokenNotFoundError`):

```ts
/**
 * True when `tokenName` exists somewhere on the network — either as the
 * network's default token or in some chain's tokens map. Used by handlers
 * to decide whether a chain-context TokenNotFoundError should be rewrapped
 * as CommandUnsupportedForTokenError (token-on-wrong-chain) or kept as
 * TokenNotFoundError (typo / unknown token).
 */
export function tokenIsKnownOnNetwork(
  networkConfig: NetworkConfig,
  tokenName: string,
): boolean {
  if (networkConfig.defaultToken?.symbol === tokenName) return true;
  const allset = networkConfig.allSet;
  if (allset) {
    for (const chain of Object.values(allset.chains)) {
      if (chain.tokens[tokenName]) return true;
    }
  }
  return false;
}
```

### 5. `app/cli/src/commands/send.ts`

Replace lines 121–131 (the silent fallback):

```ts
const resolvedTokenName = args.token ?? network.defaultToken?.symbol;
if (resolvedTokenName === undefined) {
  return yield* Effect.fail(new InvalidUsageError({
    message: `No default token found on ${config.network}; please specify a token.`,
  }));
}
```

Wrap the existing `resolveToken` call: on `TokenNotFoundError` *with a chain context* (i.e., `tokenChain !== undefined`), map to `CommandUnsupportedForTokenError` — but only when the token was defaulted (user omitted `--token`) or the token is known to exist somewhere on the network. A typo / explicitly unknown token falls through as `TokenNotFoundError`:

```ts
const tokenWasDefaulted = args.token === undefined;
const tokenInfo = yield* Effect.try({
  try: () => resolveToken(resolvedTokenName, network, tokenChain),
  catch: (e) => e as TokenNotFoundError | UnsupportedChainError | Error,
}).pipe(
  Effect.mapError((e): ClientError => {
    if (
      e instanceof TokenNotFoundError &&
      tokenChain !== undefined &&
      (tokenWasDefaulted || tokenIsKnownOnNetwork(network, resolvedTokenName))
    ) {
      const commandLabel = fromChain
        ? `send --from-chain ${fromChain}`
        : `send --to-chain ${toChain}`;
      const suggestion = tokenWasDefaulted
        ? `Pass --token explicitly. See 'fast info bridge-tokens' for tokens available on ${tokenChain}.`
        : `See 'fast info bridge-tokens' for tokens available on ${tokenChain}.`;
      return new CommandUnsupportedForTokenError({
        command: commandLabel,
        token: resolvedTokenName,
        network: config.network,
        suggestion,
      });
    }
    if (e instanceof TokenNotFoundError || e instanceof UnsupportedChainError) {
      return e;
    }
    return new TransactionFailedError({ message: String(e), cause: e });
  }),
);
```

The guard `tokenWasDefaulted || tokenIsKnownOnNetwork(...)` ensures that an unrecognized symbol like `--token USDD` (which exists nowhere on the network) keeps surfacing as `TokenNotFoundError` with the existing `"Unknown token …; run 'fast info bridge-tokens'"` message — the rewrap only fires when the token is genuinely on the wrong chain.

The final fall-through (`new TransactionFailedError(...)`) is the safety net required by the "Type discipline" rule above: anything `resolveToken` throws that isn't a `TokenNotFoundError` or `UnsupportedChainError` is wrapped into a concrete `ClientError` variant before the handler's error channel leaves the `Effect`. The explicit `: ClientError` return annotation on the mapper enforces the rule at compile time.

### 6. `app/cli/src/commands/fund/usdc/crypto.ts` (post-PR-87)

Replace line 73 (`args.token ?? Object.keys(chainCfg.tokens)[0] ?? "USDC"`):

```ts
const tokenName = args.token ?? network.defaultToken?.symbol;
if (tokenName === undefined) {
  return yield* Effect.fail(new InvalidUsageError({
    message: `No default token found on ${config.network}; please specify a token.`,
  }));
}
```

Wrap `resolveToken` to rewrap `TokenNotFoundError` as `CommandUnsupportedForTokenError`, applying the same narrowing as `send.ts`: only rewrap when the token was defaulted or is known to exist somewhere on the network. The `"Try --token USDC."` hint always appears (the deeper UX mismatch is tracked separately), while `"Pass --token explicitly."` is only included when the user omitted `--token`:

```ts
const tokenWasDefaulted = args.token === undefined;
const tokenInfo = yield* Effect.try({
  try: () => resolveToken(tokenName, network, args.chain),
  catch: (e) => e as TokenNotFoundError | UnsupportedChainError | Error,
}).pipe(
  Effect.mapError((e): ClientError => {
    if (
      e instanceof TokenNotFoundError &&
      (tokenWasDefaulted || tokenIsKnownOnNetwork(network, tokenName))
    ) {
      const suggestion = tokenWasDefaulted
        ? `Try --token USDC. Pass --token explicitly. See 'fast info bridge-tokens' for tokens available on ${args.chain}.`
        : `Try --token USDC. See 'fast info bridge-tokens' for tokens available on ${args.chain}.`;
      return new CommandUnsupportedForTokenError({
        command: "fund usdc crypto",
        token: tokenName,
        network: config.network,
        suggestion,
      });
    }
    if (e instanceof TokenNotFoundError || e instanceof UnsupportedChainError) {
      return e;
    }
    return new TransactionFailedError({ message: String(e), cause: e });
  }),
);
```

As in `send.ts`, a typo like `--token USDD` (not present anywhere on the network) keeps surfacing as `TokenNotFoundError`. The final `TransactionFailedError` fall-through preserves the existing `fund/crypto.ts` behavior (which already wraps non-`Error` throws into `TransactionFailedError`) while keeping the handler's error channel inside the `ClientError` union — see "Type discipline" above.

### 7. `app/cli/src/commands/send-token-helper.ts` (post-PR-87)

Delete file.

### 8. `app/cli/src/errors/transaction.ts`

Add `CommandUnsupportedForTokenError` (see "New error type" above).

### 9. `app/cli/src/errors/index.ts`

Add `CommandUnsupportedForTokenError` to the `ClientError` union.

### 10. `packages/x402-client/src/fast.ts`

Remove the broken humanized log at lines 139–141:

```ts
// BEFORE:
const amountHuman = toHuman(fastReq.maxAmountRequired, 6);
log(`[Fast] Building transaction via TransactionBuilder...`);
log(`  Amount: ${fastReq.maxAmountRequired} raw → ${amountHuman} USDC`);

// AFTER:
log(`[Fast] Building transaction via TransactionBuilder...`);
```

Rationale: `PaymentRequirement` (defined in `packages/x402-types/src/payment.ts`) does not carry decimals on the wire; the server uses decimals to compute the raw amount but does not transmit them. The client cannot reconstruct the human-readable form without an external resolver, and the x402-client is intentionally framework-agnostic. The raw amount is already logged at line 98 (`Amount: ${maxAmountRequired} (raw)`) and the asset hex at line 132 (`Token: ${asset} (from payment requirement)`). Removing the broken line is the simplest correct fix.

If `toHuman` is no longer referenced elsewhere in the file, remove the helper too.

## Tests

All under `app/cli/tests/` (the suite PR #87 introduces, which groups by layer: `services/` for pure helpers, `commands/` for handler-level behavior). Pure-unit tests split across three files by the layer they exercise (resolver vs. handler default-selection vs. handler rewrap), plus an adjustment to the existing `app/cli/tests/commands/pay-asset-label.test.ts`.

### Fixtures

The resolver tests share three `NetworkConfig` fixtures:

- **`mainnetCfg`** — `defaultToken = { symbol: "fastUSD", tokenId: "0x125b…", decimals: 6 }`, `allSet.chains` populated with `arbitrum` / `ethereum` / `base`, each carrying a `USDC` token entry. Mirrors the bundled mainnet config.
- **`testnetCfg`** — `defaultToken = { symbol: "testUSDC", tokenId: "0xd73a…", decimals: 6 }`, `allSet.chains` populated with `arbitrum-sepolia` / `ethereum-sepolia`, each carrying a `testUSDC` token entry. The default-token symbol also appears in the chain tokens map, so this fixture verifies the `defaultToken` short-circuit wins when both sources match.
- **`customCfgWithoutDefaultToken`** — no `defaultToken`, `allSet.chains` populated with a single chain that carries a `USDC` entry. Represents a `fast network add`-uploaded custom network.

### `app/cli/tests/services/token-resolver.test.ts` (resolver-level, pure)

- `resolveToken("fastUSD", mainnetCfg)` (no chain) → returns a `ResolvedToken` with `fastTokenId` derived from `mainnetCfg.defaultToken.tokenId` and `decimals: 6`. Verifies the no-chain `defaultToken` short-circuit added in §4.
- `resolveToken("testUSDC", testnetCfg)` (no chain) → returns the `testUSDC` `ResolvedToken`. Verifies the short-circuit also wins when the same token additionally exists in chain configs.
- `resolveToken("USDC", mainnetCfg)` (no chain) → returns a `USDC` `ResolvedToken` sourced from one of the chain entries. Verifies the chain-scan fallback still runs when the token is not the `defaultToken`.
- `resolveToken("fastUSD", customCfgWithoutDefaultToken)` (no chain, no `defaultToken`, `fastUSD` not in any chain) → throws `TokenNotFoundError`.
- `resolveToken("USDD", mainnetCfg)` (typo, no chain) → throws `TokenNotFoundError`.
- `resolveToken("fastUSD", mainnetCfg, "arbitrum")` (chain context; `fastUSD` has no EVM entry) → throws `TokenNotFoundError`. The resolver itself stays narrow — rewrap is the handler's job.
- `resolveToken("USDC", mainnetCfg, "arbitrum")` → returns a `ResolvedToken` with `evmAddress` populated.
- `tokenIsKnownOnNetwork(mainnetCfg, "fastUSD")` → `true` (via `defaultToken`).
- `tokenIsKnownOnNetwork(mainnetCfg, "USDC")` → `true` (via chain tokens).
- `tokenIsKnownOnNetwork(mainnetCfg, "USDD")` → `false`.

### `app/cli/tests/commands/send-default-token.test.ts` (handler-level, default selection)

- `--token X` provided → resolves via `resolveToken("X", network, chain)`.
- `--token` omitted on mainnet (Fast → Fast) → resolves to `fastUSD` (from `network.defaultToken`).
- `--token` omitted on testnet (Fast → Fast) → resolves to `testUSDC`.
- `--token` omitted on custom network without `defaultToken` → `InvalidUsageError` with message starting `"No default token found on …"`.

### `app/cli/tests/commands/command-unsupported-for-token.test.ts` (handler-level, rewrap behavior)

Bridge-route rewrap distinguishes "token-on-wrong-chain" (defaulted or known elsewhere on the network — rewrap) from "typo / unknown token" (stays as `TokenNotFoundError`).

- `send --from-chain arbitrum` with `--token` omitted on mainnet → `CommandUnsupportedForTokenError` with `command = "send --from-chain arbitrum"`; suggestion includes both `"Pass --token explicitly."` and `"See 'fast info bridge-tokens' for tokens available on arbitrum."`.
- `send --from-chain arbitrum --token fastUSD` on mainnet (explicit, but `fastUSD` is on the network just not on `arbitrum`) → `CommandUnsupportedForTokenError`; suggestion is `"See 'fast info bridge-tokens' for tokens available on arbitrum."` *without* `"Pass --token explicitly."` (user already passed it).
- `send --from-chain arbitrum --token USDD` on mainnet (genuine typo, `USDD` exists nowhere on the network) → stays as `TokenNotFoundError` with the existing `"Unknown token …"` message; *not* rewrapped.
- `send --to-chain arbitrum` with `--token` omitted on mainnet → `CommandUnsupportedForTokenError` with `command = "send --to-chain arbitrum"`.
- `fund usdc crypto --chain arbitrum` with `--token` omitted on mainnet → `CommandUnsupportedForTokenError` with `command = "fund usdc crypto"`; suggestion includes both `"Try --token USDC."` and `"Pass --token explicitly."`.
- `fund usdc crypto --chain arbitrum --token fastUSD` on mainnet → `CommandUnsupportedForTokenError`; suggestion includes `"Try --token USDC."` but *not* `"Pass --token explicitly."`.
- `fund usdc crypto --chain arbitrum --token USDD` on mainnet → stays as `TokenNotFoundError`.
- Fast → Fast send with a non-existent token (e.g., `--token USDD` on mainnet, no chain context) → `TokenNotFoundError` (unchanged from existing behavior; verifies the no-chain branch doesn't accidentally rewrap).

### `app/cli/tests/commands/pay-asset-label.test.ts`

Adjust for the new fallback path in `lookupTokenNameById` (consults `network.defaultToken` when no chain-scoped match is found). Drop the now-redundant `fastTokens`-fallback assertion.

### x402-client

No new test. Manual smoke: `fast pay <url> --dry-run` against a Fast endpoint; verify logs no longer show `"… raw → … USDC"`.

## Documentation

### `SPEC.md`

- §6.18.2 (`fund usdc crypto`): update `--token` row — default is `network.defaultToken.symbol`; document the `CommandUnsupportedForTokenError` for chain × token mismatches.
- §6.19 (`send`): update `--token` row — same default source; document the same error.
- §6 command listing intro: mention that `--token` defaults to `network.defaultToken.symbol` (so mainnet → fastUSD, testnet → testUSDC).
- Errors table near §5: add `COMMAND_UNSUPPORTED_FOR_TOKEN` (exit code 2).

### `app/cli/README.md`

Quick Start: keep the "omitting `--token` defaults to fastUSD on mainnet" hint but reframe as "uses the network's default token." Mention the override path: `fast network add <name> --config <path>` with `defaultToken` in the JSON.

### Root `README.md`

If the example calls reference `--token` defaulting, sync wording.

### `skills/fast/SKILL.md`

- `send` table `--token` row: "Defaults to `network.defaultToken.symbol` (`fastUSD` on mainnet, `testUSDC` on testnet) when omitted; bridge routes require the default to be supported on the target chain."
- `fund usdc crypto` row: "Defaults to `network.defaultToken.symbol`, which is not on EVM chains by default — pass `--token USDC` for the bridge case."

## Risk register

1. **Custom-network UX regression.** Users who previously ran `fast network add my-net --config …` without `defaultToken` start seeing `InvalidUsageError` when they omit `--token`. Mitigation: error message names the missing field; docs (README, SKILL) describe how to add it. The old silent fallback was already broken; this is correctness, not regression.

2. **PR #87 not landed yet.** This spec assumes the post-PR-87 file layout (`fund/usdc/crypto.ts`, `send-token-helper.ts`, `fastTokens` schema). The landing plan `docs/superpowers/plans/2026-05-20-land-pr-87-fastusd.md` must complete first. The implementation plan that follows this spec will start with a pre-flight that confirms PR #87 is on `develop`.

3. **`CommandUnsupportedForTokenError` rewrap requires preserving the original cause.** If the resolver fails for a reason other than chain × token mismatch (malformed `fastTokenId` in config, for example), the rewrap must not swallow it. The `Effect.mapError` guard checks `e instanceof TokenNotFoundError && tokenChain !== undefined && (tokenWasDefaulted || tokenIsKnownOnNetwork(network, resolvedTokenName))`; otherwise the typed error is preserved, and any non-`TokenNotFoundError` is funneled through the `TransactionFailedError` fallback per the Type discipline note in §Architecture. Genuine typos (`--token USDD` where `USDD` exists nowhere on the network) fail the `tokenIsKnownOnNetwork` check and stay as `TokenNotFoundError`.

4. **`fund usdc crypto` "obvious" command becomes harder.** Users typing `fund usdc crypto 50 --chain arbitrum` get a confusing error on mainnet (the *command* says USDC, but the *default* is fastUSD). The error wording explicitly suggests `--token USDC` to bridge them. A separate GitHub issue tracks the deeper UX fix (e.g., command-local default override).

## Open follow-ups (tracked separately)

- **GitHub issue:** `fund usdc crypto` semantic mismatch — the command name implies USDC but the default token comes from the network, which on mainnet is fastUSD. Two possible directions: (a) command-local default override (`fund usdc crypto` defaults to USDC regardless of network default), (b) make the command's `--token` literally required at parser level so the error fires earlier with explicit "you must pass `--token`" wording.
- Round-1 Copilot inline #3 (the original `decimals=6` flag, now closed by the simplification in this PR).
- Smoke tests against live mainnet/testnet once landed (token default UX, error wording on real chains).
