# CLI explicit default-token resolution — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the CLI's silent "first chain's first token" fallback with an explicit, configuration-driven default sourced from `network.defaultToken` (SDK), introduce a `CommandUnsupportedForTokenError` for chain × token mismatches, and clean up the now-dead PR #87 default-resolution machinery. Also fix the broken `decimals=6` log line in x402-client.

**Architecture:** The SDK already ships `network.defaultToken` (PR #88, on `main`). This plan plumbs it through the CLI's `NetworkConfig` schema, wires it into `send` and `fund usdc crypto`, narrows error rewrapping with a `tokenIsKnownOnNetwork` helper to distinguish typos from cross-chain mismatches, and removes the PR-#87 helpers (`pickDefaultTokenName`, `resolveDefaultToken`, `selectSendTokenName`, the CLI-only `fastTokens` map) once nothing depends on them.

**Tech Stack:** TypeScript, Effect (Effect.Effect, Data.TaggedError, Schema), Optique parser, Vitest, pnpm + Turbo monorepo. CLI lives at `app/cli/`; x402 client at `packages/x402-client/`.

**Spec:** [`docs/superpowers/specs/2026-05-20-cli-explicit-default-token-design.md`](../specs/2026-05-20-cli-explicit-default-token-design.md).

**Order rationale:** Add → wire → swap callers → delete. Each commit leaves the build and tests green. Schema gains `defaultToken` first (additive). Resolver learns the new path (additive). Handlers switch to the new path (replaces existing calls, drops dependency on the soon-to-be-deleted helper). Only after no caller remains do we delete `send-token-helper.ts`, `pickDefaultTokenName`, `resolveDefaultToken`, and the `fastTokens` schema/config.

---

## Task 0: Pre-flight and branch

**Files:**
- No code changes; environment check only.

- [ ] **Step 1: Verify PR #87 is on `develop`**

Run:
```bash
git fetch origin develop
git log origin/develop --oneline | grep -E "Merge pull request #87" | head -1
```

Expected: one line referencing the PR #87 merge commit (e.g., `Merge pull request #87 from fastxyz/feat/cli-fund-fastusd`). If the grep is empty, STOP — the landing plan `docs/superpowers/plans/2026-05-20-land-pr-87-fastusd.md` has not completed, and this plan's assumptions (post-PR-87 file layout) are not yet true.

- [ ] **Step 2: Verify the post-PR-87 files exist**

Run:
```bash
git show origin/develop:app/cli/src/commands/send-token-helper.ts > /dev/null && echo "send-token-helper.ts present"
git show origin/develop:app/cli/src/commands/fund/usdc/crypto.ts > /dev/null && echo "fund/usdc/crypto.ts present"
git show origin/develop:app/cli/src/commands/fund/fastusd.ts > /dev/null && echo "fund/fastusd.ts present"
git show origin/develop:app/cli/tests/services/token-resolver.test.ts > /dev/null && echo "token-resolver.test.ts present"
```

Expected: all four lines print. If any is missing, STOP — develop drifted from the spec's assumed layout.

- [ ] **Step 3: Create working branch**

Run:
```bash
git switch -c feat/cli-explicit-default-token origin/develop
git status
```

Expected: clean working tree on the new branch.

- [ ] **Step 4: Baseline regression**

Run:
```bash
pnpm install --frozen-lockfile
pnpm --filter @fastxyz/cli exec vitest run
pnpm --filter @fastxyz/x402-client exec vitest run
pnpm --filter @fastxyz/cli exec tsc --noEmit
pnpm --filter @fastxyz/x402-client exec tsc --noEmit
```

Expected: CLI 31 pass (4 files), x402-client 20 pass, both `tsc` clean. If anything fails on a fresh `develop`, STOP and report — the baseline is wrong.

- [ ] **Step 5: No commit yet — verification only.**

---

## Task 1: Add `CommandUnsupportedForTokenError`

**Files:**
- Modify: `app/cli/src/errors/transaction.ts`
- Modify: `app/cli/src/errors/index.ts`
- Create: `app/cli/tests/errors/command-unsupported-for-token.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/cli/tests/errors/command-unsupported-for-token.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CommandUnsupportedForTokenError } from "../../src/errors/transaction.js";

describe("CommandUnsupportedForTokenError", () => {
  it("includes command, token, and network in the message", () => {
    const err = new CommandUnsupportedForTokenError({
      command: "send --from-chain arbitrum",
      token: "fastUSD",
      network: "mainnet",
    });
    expect(err.message).toBe(
      "send --from-chain arbitrum is not supported for fastUSD on mainnet.",
    );
    expect(err.exitCode).toBe(2);
    expect(err.errorCode).toBe("COMMAND_UNSUPPORTED_FOR_TOKEN");
  });

  it("appends the suggestion when provided", () => {
    const err = new CommandUnsupportedForTokenError({
      command: "fund usdc crypto",
      token: "fastUSD",
      network: "mainnet",
      suggestion: "Try --token USDC.",
    });
    expect(err.message).toBe(
      "fund usdc crypto is not supported for fastUSD on mainnet. Try --token USDC.",
    );
  });
});
```

- [ ] **Step 2: Run the test — confirm it fails**

Run: `pnpm --filter @fastxyz/cli exec vitest run tests/errors/command-unsupported-for-token.test.ts`

Expected: FAIL (`CommandUnsupportedForTokenError` is not exported).

- [ ] **Step 3: Add the error class**

Append to `app/cli/src/errors/transaction.ts`:

```ts
export class CommandUnsupportedForTokenError extends Data.TaggedError(
  "CommandUnsupportedForTokenError",
)<{
  readonly command: string;
  readonly token: string;
  readonly network: string;
  readonly suggestion?: string;
}> {
  readonly exitCode = 2 as const;
  readonly errorCode = "COMMAND_UNSUPPORTED_FOR_TOKEN" as const;
  get message() {
    const base = `${this.command} is not supported for ${this.token} on ${this.network}.`;
    return this.suggestion ? `${base} ${this.suggestion}` : base;
  }
}
```

- [ ] **Step 4: Add to the `ClientError` union**

In `app/cli/src/errors/index.ts`, add `CommandUnsupportedForTokenError` to the `import type` block from `./transaction.js`:

```ts
import type {
  CommandUnsupportedForTokenError,
  FundingRequiredError,
  InsufficientBalanceError,
  InsufficientGasError,
  InvalidAddressError,
  InvalidAmountError,
  TokenNotFoundError,
  TransactionFailedError,
  TxNotFoundError,
} from "./transaction.js";
```

And add `| CommandUnsupportedForTokenError` to the `ClientError` union (alphabetically near `TokenNotFoundError`).

- [ ] **Step 5: Run the test — confirm it passes**

Run: `pnpm --filter @fastxyz/cli exec vitest run tests/errors/command-unsupported-for-token.test.ts`

Expected: PASS (2 tests).

- [ ] **Step 6: Verify the broader suite still passes**

Run: `pnpm --filter @fastxyz/cli exec vitest run && pnpm --filter @fastxyz/cli exec tsc --noEmit`

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add app/cli/src/errors/transaction.ts app/cli/src/errors/index.ts app/cli/tests/errors/command-unsupported-for-token.test.ts
git commit -m "feat(cli): add CommandUnsupportedForTokenError for route×token mismatches"
```

---

## Task 2: Schema — add `defaultToken` field

**Files:**
- Modify: `app/cli/src/schemas/networks.ts`
- Modify: `app/cli/tests/services/token-resolver.test.ts` (or a new schema test if no test exists)

Adds the new `FastTokenSchema` and the optional `defaultToken` field on `NetworkConfigSchema`. Does NOT remove `fastTokens` yet — that happens in Task 7 once nothing reads it.

- [ ] **Step 1: Write the failing test**

Create `app/cli/tests/schemas/networks.test.ts`:

```ts
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { NetworkConfigSchema } from "../../src/schemas/networks.js";

describe("NetworkConfigSchema", () => {
  it("accepts a config with defaultToken", () => {
    const config = {
      url: "https://example",
      explorerUrl: "https://explorer",
      networkId: "fast:mainnet",
      defaultToken: {
        tokenId: "0xabc",
        symbol: "fastUSD",
        decimals: 6,
      },
    };
    const parsed = Schema.decodeUnknownSync(NetworkConfigSchema)(config);
    expect(parsed.defaultToken?.symbol).toBe("fastUSD");
    expect(parsed.defaultToken?.tokenId).toBe("0xabc");
    expect(parsed.defaultToken?.decimals).toBe(6);
  });

  it("accepts a config without defaultToken (optional field)", () => {
    const config = {
      url: "https://example",
      explorerUrl: "https://explorer",
      networkId: "fast:mainnet",
    };
    const parsed = Schema.decodeUnknownSync(NetworkConfigSchema)(config);
    expect(parsed.defaultToken).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test — confirm it fails**

Run: `pnpm --filter @fastxyz/cli exec vitest run tests/schemas/networks.test.ts`

Expected: FAIL (parsing of `defaultToken` is unknown to the current schema, OR `parsed.defaultToken` is `undefined` for the first test).

- [ ] **Step 3: Add the schema**

Edit `app/cli/src/schemas/networks.ts`. Add after the existing `AllSet*Schema` declarations and before `NetworkConfigSchema`:

```ts
export const FastTokenSchema = Schema.Struct({
  tokenId: Schema.String,
  symbol: Schema.String,
  decimals: Schema.Number,
});
export type FastTokenConfig = typeof FastTokenSchema.Type;
```

Extend `NetworkConfigSchema` — add the `defaultToken` line between `networkId` and the existing `fastTokens`/`allSet`:

```ts
export const NetworkConfigSchema = Schema.Struct({
  url: Schema.String,
  explorerUrl: Schema.String,
  networkId: NetworkId,
  defaultToken: Schema.optional(FastTokenSchema),
  fastTokens: Schema.optional(Schema.Record({ key: Schema.String, value: FastTokenSchema })), // PR #87 — to be removed in Task 7
  allSet: Schema.optional(AllSetConfigSchema),
});
```

> Note: If PR #87 defined `FastTokenConfig` under a different name (e.g., `FastTokenConfig` already exists from PR #87), reuse it — don't create a duplicate. Verify by reading the current file before editing.

- [ ] **Step 4: Run the test — confirm it passes**

Run: `pnpm --filter @fastxyz/cli exec vitest run tests/schemas/networks.test.ts`

Expected: PASS (2 tests).

- [ ] **Step 5: Run full CLI tests and typecheck**

Run: `pnpm --filter @fastxyz/cli exec vitest run && pnpm --filter @fastxyz/cli exec tsc --noEmit`

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add app/cli/src/schemas/networks.ts app/cli/tests/schemas/networks.test.ts
git commit -m "feat(cli): add FastTokenSchema and NetworkConfig.defaultToken (additive)"
```

---

## Task 3: Bundled networks — populate `defaultToken` from SDK

**Files:**
- Modify: `app/cli/src/config/networks.ts`
- Modify: `app/cli/tests/services/token-resolver.test.ts` (verify bundled networks expose defaultToken)

- [ ] **Step 1: Write the failing test**

Append to `app/cli/tests/schemas/networks.test.ts`:

```ts
import { bundledNetworks } from "../../src/config/networks.js";

describe("bundledNetworks", () => {
  it("mainnet.defaultToken matches the SDK fastUSD", () => {
    const mainnet = bundledNetworks.mainnet;
    expect(mainnet.defaultToken?.symbol).toBe("fastUSD");
    expect(mainnet.defaultToken?.decimals).toBe(6);
    expect(mainnet.defaultToken?.tokenId).toMatch(/^0x125b60bb/);
  });

  it("testnet.defaultToken matches the SDK testUSDC", () => {
    const testnet = bundledNetworks.testnet;
    expect(testnet.defaultToken?.symbol).toBe("testUSDC");
    expect(testnet.defaultToken?.decimals).toBe(6);
    expect(testnet.defaultToken?.tokenId).toMatch(/^0xd73a0679/);
  });
});
```

- [ ] **Step 2: Run the test — confirm it fails**

Run: `pnpm --filter @fastxyz/cli exec vitest run tests/schemas/networks.test.ts`

Expected: FAIL — `defaultToken` is undefined on the bundled networks.

- [ ] **Step 3: Populate `defaultToken` in bundled networks**

Edit `app/cli/src/config/networks.ts`. For both `testnet` and `mainnet` entries in the `bundledNetworks` map, insert a `defaultToken` line between `networkId` and `allSet`. The SDK already imports as `sdkMainnet` / `sdkTestnet`:

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
  // PR #87 fastTokens.fastUSD removed in Task 7
  allSet: { /* unchanged */ },
},
```

Leave the PR-#87 `fastTokens.fastUSD` entry in place for now — Task 7 removes it after Task 4 stops reading it.

- [ ] **Step 4: Run the test — confirm it passes**

Run: `pnpm --filter @fastxyz/cli exec vitest run tests/schemas/networks.test.ts`

Expected: PASS (4 tests now).

- [ ] **Step 5: Full suite green**

Run: `pnpm --filter @fastxyz/cli exec vitest run && pnpm --filter @fastxyz/cli exec tsc --noEmit`

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add app/cli/src/config/networks.ts app/cli/tests/schemas/networks.test.ts
git commit -m "feat(cli): populate bundled networks with SDK defaultToken"
```

---

## Task 4: Token resolver — `defaultToken` consultation + `tokenIsKnownOnNetwork`

**Files:**
- Modify: `app/cli/src/services/token-resolver.ts`
- Modify: `app/cli/tests/services/token-resolver.test.ts`

Adds the new `defaultToken` short-circuit to `resolveToken`, the `defaultToken` fallback to `lookupTokenNameById`, and the new `tokenIsKnownOnNetwork` predicate. Keeps `pickDefaultTokenName` and `resolveDefaultToken` for now (they still have callers in `send-token-helper.ts` and possibly elsewhere); Task 7 removes them.

- [ ] **Step 1: Write the failing tests**

Read the existing `app/cli/tests/services/token-resolver.test.ts` first to understand its fixture style. Append new test cases (use the existing fixture builders if any; otherwise define inline configs):

```ts
import { describe, expect, it } from "vitest";
import {
  resolveToken,
  lookupTokenNameById,
  tokenIsKnownOnNetwork,
} from "../../src/services/token-resolver.js";
import type { NetworkConfig } from "../../src/schemas/networks.js";

const mainnetCfg: NetworkConfig = {
  url: "https://api.fast.xyz/proxy-rest",
  explorerUrl: "https://explorer.fast.xyz",
  networkId: "fast:mainnet" as const,
  defaultToken: {
    tokenId: "0x125b60bb2e805336f0934077d4f9fdb36f45bec9ded8d7b0e637516cc43a86eb",
    symbol: "fastUSD",
    decimals: 6,
  },
  allSet: {
    crossSignUrl: "https://cross-sign.allset.fast.xyz",
    portalApiUrl: "https://allset.fast.xyz/api",
    chains: {
      arbitrum: {
        chainId: 42161,
        bridgeContract: "0xBRIDGE",
        fastBridgeAddress: "fast1bridge",
        relayerUrl: "https://relayer",
        evmRpcUrl: "https://rpc",
        evmExplorerUrl: "https://arbiscan.io",
        tokens: {
          USDC: {
            evmAddress: "0xUSDC_ARB",
            fastTokenId:
              "0xc655a12330da6af361d281b197996d2bc135aaed3b66278e729c2222291e9130",
            decimals: 6,
          },
        },
      },
    },
  },
};

const customCfgWithoutDefaultToken: NetworkConfig = {
  url: "https://x", explorerUrl: "https://y", networkId: "fast:mainnet" as const,
  allSet: {
    crossSignUrl: "https://x", portalApiUrl: "https://y",
    chains: {
      base: {
        chainId: 8453, bridgeContract: "0xB", fastBridgeAddress: "fast1b",
        relayerUrl: "https://r", evmRpcUrl: "https://rpc", evmExplorerUrl: "https://e",
        tokens: { USDC: { evmAddress: "0xU", fastTokenId: "0xc655a123", decimals: 6 } },
      },
    },
  },
};

describe("resolveToken — defaultToken consultation", () => {
  it("returns fastUSD via defaultToken short-circuit (no chain)", () => {
    const r = resolveToken("fastUSD", mainnetCfg);
    expect(r.decimals).toBe(6);
    expect(r.evmAddress).toBeUndefined();
    // fastTokenId is a Uint8Array decoded from defaultToken.tokenId
    expect(r.fastTokenId.length).toBeGreaterThan(0);
  });

  it("falls through to chain scan for non-default tokens (no chain)", () => {
    const r = resolveToken("USDC", mainnetCfg);
    expect(r.decimals).toBe(6);
    expect(r.evmAddress).toBeUndefined(); // no chain context → no evmAddress
  });

  it("throws TokenNotFoundError when token is not in defaultToken and not in any chain", () => {
    expect(() => resolveToken("USDD", mainnetCfg)).toThrow(/Unknown token/);
  });

  it("throws TokenNotFoundError when network has no defaultToken and token is unknown", () => {
    expect(() => resolveToken("fastUSD", customCfgWithoutDefaultToken)).toThrow(/Unknown token/);
  });

  it("chain context — fastUSD on arbitrum throws TokenNotFoundError (resolver stays narrow)", () => {
    expect(() => resolveToken("fastUSD", mainnetCfg, "arbitrum")).toThrow(/Unknown token/);
  });

  it("chain context — USDC on arbitrum returns ResolvedToken with evmAddress", () => {
    const r = resolveToken("USDC", mainnetCfg, "arbitrum");
    expect(r.evmAddress).toBe("0xUSDC_ARB");
    expect(r.decimals).toBe(6);
  });
});

describe("tokenIsKnownOnNetwork", () => {
  it("true for the network's defaultToken symbol", () => {
    expect(tokenIsKnownOnNetwork(mainnetCfg, "fastUSD")).toBe(true);
  });

  it("true for a token in any chain", () => {
    expect(tokenIsKnownOnNetwork(mainnetCfg, "USDC")).toBe(true);
  });

  it("false for an unknown token", () => {
    expect(tokenIsKnownOnNetwork(mainnetCfg, "USDD")).toBe(false);
  });

  it("false when network has no defaultToken and token only appears as unknown", () => {
    expect(tokenIsKnownOnNetwork(customCfgWithoutDefaultToken, "fastUSD")).toBe(false);
  });
});

describe("lookupTokenNameById — defaultToken fallback", () => {
  it("returns the defaultToken symbol when id matches", () => {
    const name = lookupTokenNameById(
      mainnetCfg,
      "0x125b60bb2e805336f0934077d4f9fdb36f45bec9ded8d7b0e637516cc43a86eb",
    );
    expect(name).toBe("fastUSD");
  });

  it("prefers a chain match over defaultToken when both exist", () => {
    // USDC's id lives in arbitrum chain entry; should return "USDC", not crash
    const name = lookupTokenNameById(
      mainnetCfg,
      "0xc655a12330da6af361d281b197996d2bc135aaed3b66278e729c2222291e9130",
    );
    expect(name).toBe("USDC");
  });

  it("returns undefined when neither chain nor defaultToken matches", () => {
    expect(lookupTokenNameById(mainnetCfg, "0xdeadbeef")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests — confirm they fail**

Run: `pnpm --filter @fastxyz/cli exec vitest run tests/services/token-resolver.test.ts`

Expected: FAIL — at least the `tokenIsKnownOnNetwork` and `defaultToken` short-circuit cases fail (helper doesn't exist; resolver doesn't consult defaultToken).

- [ ] **Step 3: Update `resolveToken`**

Edit `app/cli/src/services/token-resolver.ts`. Replace the existing `resolveToken` function body's no-chain-context branch — insert the `defaultToken` short-circuit **before** the chain scan. Final function:

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

  // 2) PR #87 fastTokens map — KEEP until Task 7 to preserve behavior during migration.
  const fast = networkConfig.fastTokens;
  if (fast) {
    const entry = fast[tokenName];
    if (entry) {
      return { fastTokenId: fromHex(entry.fastTokenId), decimals: entry.decimals };
    }
  }

  // 3) Fall back to scanning chain-scoped tokens.
  const allset = networkConfig.allSet;
  if (allset) {
    for (const chainConfig of Object.values(allset.chains)) {
      const token = chainConfig.tokens[tokenName];
      if (token) {
        return { fastTokenId: fromHex(token.fastTokenId), decimals: token.decimals };
      }
    }
  }

  throw new TokenNotFoundError({ token: tokenName });
}
```

> Note: step 2 (the `fastTokens` block) is a transitional bridge — Task 7 removes it after `pickDefaultTokenName` and the `fastTokens` schema field are deleted.

- [ ] **Step 4: Update `lookupTokenNameById`**

Replace the existing function with this version (drops the `fastTokens` consultation in favor of `defaultToken`):

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

(The `fastTokens` consultation that PR #87 added is removed here, since `defaultToken` carries the same id with a more authoritative source.)

- [ ] **Step 5: Add `tokenIsKnownOnNetwork`**

Append to `app/cli/src/services/token-resolver.ts`:

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

- [ ] **Step 6: Run the tests — confirm they pass**

Run: `pnpm --filter @fastxyz/cli exec vitest run tests/services/token-resolver.test.ts`

Expected: PASS — both the new and the pre-existing PR #87 resolver tests are green.

- [ ] **Step 6.5: Migrate `pay-asset-label.test.ts` fixtures if needed**

PR #87 added `app/cli/tests/commands/pay-asset-label.test.ts`, which exercises `labelAssetForPayment` (which delegates to `lookupTokenNameById`). PR #87's `lookupTokenNameById` consulted `networkConfig.fastTokens`; Task 4 step 4 above changed it to consult `networkConfig.defaultToken` instead.

Read `app/cli/tests/commands/pay-asset-label.test.ts`. Look for fixtures with a `fastTokens: { ... }` block. For each, replace with a `defaultToken: { tokenId: "...", symbol: "fastUSD", decimals: 6 }` field (same id + decimals, restructured into the new shape).

Run: `pnpm --filter @fastxyz/cli exec vitest run tests/commands/pay-asset-label.test.ts`

Expected: PASS. If the test was already passing (because the fixture used chain-scoped tokens and not `fastTokens`), no change needed — just confirm.

- [ ] **Step 7: Full suite + typecheck**

Run: `pnpm --filter @fastxyz/cli exec vitest run && pnpm --filter @fastxyz/cli exec tsc --noEmit`

Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add app/cli/src/services/token-resolver.ts app/cli/tests/services/token-resolver.test.ts
git commit -m "feat(cli): resolveToken consults network.defaultToken; add tokenIsKnownOnNetwork"
```

---

## Task 5: `send` handler — explicit default + narrowed rewrap

**Files:**
- Modify: `app/cli/src/commands/send.ts`
- Create: `app/cli/tests/commands/command-unsupported-for-token.test.ts` (or extend if it already exists)

Switches `send.ts` from `selectSendTokenName` (helper, to be deleted in Task 7) to the new `args.token ?? network.defaultToken?.symbol` pattern, and adds the narrowed rewrap that distinguishes "token-on-wrong-chain" (rewrap) from "typo / unknown" (don't rewrap).

- [ ] **Step 1: Update `app/cli/tests/commands/send-default-token.test.ts`**

PR #87's test asserts that the old `selectSendTokenName` helper picked fastUSD as the mainnet default. Update to reflect the new behavior — same outcome, different code path. Read the existing test first, then replace its core assertions with:

```ts
import { describe, expect, it } from "vitest";
import { InvalidUsageError } from "../../src/errors/usage.js";
import type { NetworkConfig } from "../../src/schemas/networks.js";

// Re-use mainnetCfg / testnetCfg / customCfgWithoutDefaultToken from token-resolver.test.ts
// or duplicate inline. Below assumes a shared `fixtures.ts` — if not present, duplicate
// the configs inline.

// Helper exercised: the inline "args.token ?? network.defaultToken?.symbol" pattern in send.ts.
// Test surface: pure default-name selection, without invoking the full Effect handler.

function pickName(
  argToken: string | undefined,
  network: NetworkConfig,
): string | undefined {
  return argToken ?? network.defaultToken?.symbol;
}

describe("send default-token selection", () => {
  it("explicit --token wins", () => {
    expect(pickName("USDC", mainnetCfg)).toBe("USDC");
  });

  it("omitted on mainnet defaults to fastUSD", () => {
    expect(pickName(undefined, mainnetCfg)).toBe("fastUSD");
  });

  it("omitted on testnet defaults to testUSDC", () => {
    expect(pickName(undefined, testnetCfg)).toBe("testUSDC");
  });

  it("omitted on custom network without defaultToken returns undefined", () => {
    expect(pickName(undefined, customCfgWithoutDefaultToken)).toBeUndefined();
  });
});
```

(If a `fixtures.ts` shared file makes sense, create `app/cli/tests/fixtures/networks.ts` exporting `mainnetCfg`, `testnetCfg`, `customCfgWithoutDefaultToken` and import from both this test and the resolver test. Optional — inline duplication is fine for a 3-fixture spread.)

- [ ] **Step 2: Write the failing `command-unsupported-for-token` tests**

Create `app/cli/tests/commands/command-unsupported-for-token.test.ts` exercising the **rewrap logic in isolation** via a small helper that mirrors what the handler does. The full Effect-runtime handler test is out of scope per the spec ("no handler-level Effect-runtime scaffolding"). Test the logic the handler runs:

```ts
import { describe, expect, it } from "vitest";
import {
  resolveToken,
  tokenIsKnownOnNetwork,
} from "../../src/services/token-resolver.js";
import {
  CommandUnsupportedForTokenError,
  TokenNotFoundError,
} from "../../src/errors/transaction.js";
// import fixtures (mainnetCfg etc.) as above

// Mirrors the rewrap predicate used in send.ts and fund/usdc/crypto.ts.
function classify(
  argToken: string | undefined,
  network: { defaultToken?: { symbol: string } } & Parameters<typeof resolveToken>[1],
  chain: string,
  commandLabel: string,
  extraHint = "",
):
  | { kind: "ok"; token: string }
  | { kind: "command-unsupported"; err: CommandUnsupportedForTokenError }
  | { kind: "token-not-found"; err: TokenNotFoundError } {
  const tokenWasDefaulted = argToken === undefined;
  const resolvedName = argToken ?? network.defaultToken?.symbol;
  if (resolvedName === undefined) throw new Error("test setup: no default");
  try {
    resolveToken(resolvedName, network as any, chain);
    return { kind: "ok", token: resolvedName };
  } catch (e) {
    if (
      e instanceof TokenNotFoundError &&
      (tokenWasDefaulted || tokenIsKnownOnNetwork(network as any, resolvedName))
    ) {
      const suggestion = tokenWasDefaulted
        ? `${extraHint}Pass --token explicitly. See 'fast info bridge-tokens' for tokens available on ${chain}.`
        : `${extraHint}See 'fast info bridge-tokens' for tokens available on ${chain}.`;
      return {
        kind: "command-unsupported",
        err: new CommandUnsupportedForTokenError({
          command: commandLabel,
          token: resolvedName,
          network: "mainnet",
          suggestion,
        }),
      };
    }
    if (e instanceof TokenNotFoundError) return { kind: "token-not-found", err: e };
    throw e;
  }
}

describe("send --from-chain rewrap", () => {
  it("defaulted fastUSD on arbitrum → CommandUnsupportedForTokenError with 'Pass --token explicitly.'", () => {
    const r = classify(undefined, mainnetCfg, "arbitrum", "send --from-chain arbitrum");
    expect(r.kind).toBe("command-unsupported");
    if (r.kind !== "command-unsupported") return;
    expect(r.err.message).toContain("send --from-chain arbitrum is not supported for fastUSD on mainnet");
    expect(r.err.message).toContain("Pass --token explicitly.");
  });

  it("explicit --token fastUSD on arbitrum → CommandUnsupportedForTokenError WITHOUT 'Pass --token explicitly.'", () => {
    const r = classify("fastUSD", mainnetCfg, "arbitrum", "send --from-chain arbitrum");
    expect(r.kind).toBe("command-unsupported");
    if (r.kind !== "command-unsupported") return;
    expect(r.err.message).not.toContain("Pass --token explicitly.");
  });

  it("typo --token USDD on arbitrum → TokenNotFoundError (no rewrap)", () => {
    const r = classify("USDD", mainnetCfg, "arbitrum", "send --from-chain arbitrum");
    expect(r.kind).toBe("token-not-found");
  });

  it("explicit --token USDC on arbitrum → ok", () => {
    const r = classify("USDC", mainnetCfg, "arbitrum", "send --from-chain arbitrum");
    expect(r.kind).toBe("ok");
  });
});

describe("send --to-chain rewrap", () => {
  it("defaulted fastUSD on arbitrum → CommandUnsupportedForTokenError", () => {
    const r = classify(undefined, mainnetCfg, "arbitrum", "send --to-chain arbitrum");
    expect(r.kind).toBe("command-unsupported");
    if (r.kind !== "command-unsupported") return;
    expect(r.err.message).toContain("send --to-chain arbitrum is not supported for fastUSD on mainnet");
  });
});

describe("fund usdc crypto rewrap", () => {
  it("defaulted fastUSD on arbitrum → 'Try --token USDC.' AND 'Pass --token explicitly.'", () => {
    const r = classify(undefined, mainnetCfg, "arbitrum", "fund usdc crypto", "Try --token USDC. ");
    expect(r.kind).toBe("command-unsupported");
    if (r.kind !== "command-unsupported") return;
    expect(r.err.message).toContain("Try --token USDC.");
    expect(r.err.message).toContain("Pass --token explicitly.");
  });

  it("explicit --token fastUSD on arbitrum → 'Try --token USDC.' but NOT 'Pass --token explicitly.'", () => {
    const r = classify("fastUSD", mainnetCfg, "arbitrum", "fund usdc crypto", "Try --token USDC. ");
    expect(r.kind).toBe("command-unsupported");
    if (r.kind !== "command-unsupported") return;
    expect(r.err.message).toContain("Try --token USDC.");
    expect(r.err.message).not.toContain("Pass --token explicitly.");
  });

  it("typo --token USDD → TokenNotFoundError (no rewrap)", () => {
    const r = classify("USDD", mainnetCfg, "arbitrum", "fund usdc crypto", "Try --token USDC. ");
    expect(r.kind).toBe("token-not-found");
  });
});
```

- [ ] **Step 3: Run both test files — confirm they fail**

Run: `pnpm --filter @fastxyz/cli exec vitest run tests/commands/send-default-token.test.ts tests/commands/command-unsupported-for-token.test.ts`

Expected: FAIL — the existing `send-default-token.test.ts` expects the old `selectSendTokenName` behavior, and `command-unsupported-for-token.test.ts` is new logic.

- [ ] **Step 4: Update `send.ts`**

Edit `app/cli/src/commands/send.ts`. Find the line:

```ts
import { selectSendTokenName } from "./send-token-helper.js";
```

Remove it (Task 7 deletes the file). Add to existing imports:

```ts
import {
  CommandUnsupportedForTokenError,
  TokenNotFoundError,
  TransactionFailedError,
  // existing imports stay
} from "../errors/index.js";
import { resolveToken, tokenIsKnownOnNetwork } from "../services/token-resolver.js";
import { InvalidUsageError } from "../errors/usage.js";
import type { ClientError } from "../errors/index.js";
```

(Match the existing import style; the above is illustrative.)

Replace the block that today reads (post-PR-87):

```ts
// Resolve token name: use provided value or default to first token on the network
const tokenChain = fromChain ?? toChain;
const resolvedTokenName = selectSendTokenName(args.token, network, tokenChain);

// Resolve token using the appropriate chain context
const tokenInfo = yield* Effect.try({
  try: () => resolveToken(resolvedTokenName, network, tokenChain),
  catch: (e) => e as InvalidNetworkConfigError | Error,
}).pipe(
  Effect.mapError((e) =>
    "message" in (e as object)
      ? (e as TransactionFailedError)
      : new TransactionFailedError({ message: String(e), cause: e }),
  ),
);
```

with:

```ts
// Resolve token name: explicit --token wins; otherwise use the network's default.
const tokenChain = fromChain ?? toChain;
const tokenWasDefaulted = args.token === undefined;
const resolvedTokenName = args.token ?? network.defaultToken?.symbol;
if (resolvedTokenName === undefined) {
  return yield* Effect.fail(new InvalidUsageError({
    message: `No default token found on ${config.network}; please specify a token.`,
  }));
}

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

- [ ] **Step 5: Run the tests — confirm they pass**

Run: `pnpm --filter @fastxyz/cli exec vitest run tests/commands/send-default-token.test.ts tests/commands/command-unsupported-for-token.test.ts`

Expected: PASS — every case above.

- [ ] **Step 6: Full suite + typecheck**

Run: `pnpm --filter @fastxyz/cli exec vitest run && pnpm --filter @fastxyz/cli exec tsc --noEmit`

Expected: all green. If `send-token-helper.ts` complains about being unused, that's fine — Task 7 deletes it. If `selectSendTokenName` is still imported anywhere, the typecheck will fail; grep and fix any other caller.

- [ ] **Step 7: Commit**

```bash
git add app/cli/src/commands/send.ts \
  app/cli/tests/commands/send-default-token.test.ts \
  app/cli/tests/commands/command-unsupported-for-token.test.ts
git commit -m "feat(cli): send uses network.defaultToken; rewrap chain mismatches as CommandUnsupportedForTokenError"
```

---

## Task 6: `fund usdc crypto` handler — same pattern

**Files:**
- Modify: `app/cli/src/commands/fund/usdc/crypto.ts`
- Extend: `app/cli/tests/commands/command-unsupported-for-token.test.ts` (already covers the cases from Task 5)

The `fund usdc crypto` rewrap was already exercised by tests added in Task 5. This task wires the handler to match.

- [ ] **Step 1: Verify the relevant tests are already failing for the handler in isolation**

The Task 5 tests exercise the rewrap logic abstractly via the `classify` helper. The handler itself doesn't have direct test coverage in this plan (no Effect-runtime handler scaffolding per spec). The validation here is the typecheck + full suite passing.

Run: `pnpm --filter @fastxyz/cli exec vitest run` — should still pass (Task 5 work is independent).

- [ ] **Step 2: Update `fund/usdc/crypto.ts`**

Edit `app/cli/src/commands/fund/usdc/crypto.ts`. Replace the token-resolution block (today):

```ts
// Resolve token
const tokenName =
  args.token ?? Object.keys(chainCfg.tokens)[0] ?? "USDC";
const tokenInfo = yield* Effect.try({
  try: () => resolveToken(tokenName, network, args.chain),
  catch: (e) =>
    e instanceof Error
      ? (e as unknown as TransactionFailedError)
      : new TransactionFailedError({ message: String(e), cause: e }),
});
```

with:

```ts
// Resolve token name: explicit --token wins; otherwise use the network's default.
const tokenWasDefaulted = args.token === undefined;
const tokenName = args.token ?? network.defaultToken?.symbol;
if (tokenName === undefined) {
  return yield* Effect.fail(new InvalidUsageError({
    message: `No default token found on ${config.network}; please specify a token.`,
  }));
}

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

Add the necessary imports at the top of the file:

```ts
import {
  CommandUnsupportedForTokenError,
  TokenNotFoundError,
  // existing token errors kept
} from "../../../errors/index.js";
import { InvalidUsageError } from "../../../errors/usage.js";
import { resolveToken, tokenIsKnownOnNetwork } from "../../../services/token-resolver.js";
import type { ClientError } from "../../../errors/index.js";
```

(Match existing import-grouping style. The path depth is three levels from `commands/fund/usdc/crypto.ts`.)

- [ ] **Step 3: Full suite + typecheck**

Run: `pnpm --filter @fastxyz/cli exec vitest run && pnpm --filter @fastxyz/cli exec tsc --noEmit`

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add app/cli/src/commands/fund/usdc/crypto.ts
git commit -m "feat(cli): fund usdc crypto uses network.defaultToken; rewrap as CommandUnsupportedForTokenError"
```

---

## Task 7: Delete dead default-resolution code

**Files:**
- Delete: `app/cli/src/commands/send-token-helper.ts`
- Modify: `app/cli/src/services/token-resolver.ts` — remove `pickDefaultTokenName`, `resolveDefaultToken`, and the transitional `fastTokens` block in `resolveToken`
- Modify: `app/cli/src/schemas/networks.ts` — remove the `fastTokens` field
- Modify: `app/cli/src/config/networks.ts` — remove the PR-#87 `fastTokens.fastUSD` entry on mainnet

After Tasks 5 and 6, nothing reads `selectSendTokenName`, `pickDefaultTokenName`, `resolveDefaultToken`, or `networkConfig.fastTokens`. They become dead code.

- [ ] **Step 1: Confirm nothing imports `send-token-helper.ts`**

Run:
```bash
grep -rln "send-token-helper\|selectSendTokenName" app/ packages/ 2>/dev/null | grep -v node_modules | grep -v dist
```

Expected: empty output (or only the file itself). If any other file imports it, STOP and update that caller before deleting.

- [ ] **Step 2: Confirm nothing imports `pickDefaultTokenName` / `resolveDefaultToken`**

Run:
```bash
grep -rln "pickDefaultTokenName\|resolveDefaultToken" app/ packages/ 2>/dev/null | grep -v node_modules | grep -v dist
```

Expected: only `app/cli/src/services/token-resolver.ts` (definitions) and possibly its test file. If anything else, STOP.

- [ ] **Step 3: Confirm nothing reads `networkConfig.fastTokens`**

Run:
```bash
grep -rn "\.fastTokens\|fastTokens:" app/ packages/ 2>/dev/null | grep -v node_modules | grep -v dist | grep -v "\.test\.ts"
```

Expected: only the schema declaration and the bundled mainnet config entry. If a non-test caller still reads `fastTokens`, STOP.

- [ ] **Step 4: Delete `send-token-helper.ts`**

Run:
```bash
git rm app/cli/src/commands/send-token-helper.ts
```

- [ ] **Step 5: Strip `pickDefaultTokenName`, `resolveDefaultToken`, and the `fastTokens` block from `resolveToken`**

In `app/cli/src/services/token-resolver.ts`:

- Delete the `pickDefaultTokenName` function declaration.
- Delete the `resolveDefaultToken` function declaration.
- In `resolveToken`, delete the transitional `fastTokens` step (the "PR #87 fastTokens map" block from Task 4 step 3).

Final `resolveToken` no-chain branch:

```ts
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
      return { fastTokenId: fromHex(token.fastTokenId), decimals: token.decimals };
    }
  }
}

throw new TokenNotFoundError({ token: tokenName });
```

- [ ] **Step 6: Remove the `fastTokens` field from the schema**

In `app/cli/src/schemas/networks.ts`, delete the `fastTokens: Schema.optional(...)` line from `NetworkConfigSchema`. Leave `defaultToken` and `allSet` in place.

If `FastTokenConfig` was defined by PR #87 specifically for `fastTokens` and is unused after this deletion, also remove it. (`FastTokenSchema` introduced by Task 2 stays.)

- [ ] **Step 7: Remove `fastTokens.fastUSD` from bundled mainnet**

In `app/cli/src/config/networks.ts`, delete the `fastTokens: { fastUSD: { … } }` entry from the mainnet block. The mainnet `defaultToken` (populated in Task 3) carries the same id and supersedes it.

- [ ] **Step 8: Run the full test suite + typecheck**

Run: `pnpm --filter @fastxyz/cli exec vitest run && pnpm --filter @fastxyz/cli exec tsc --noEmit`

Expected: all green. If the schema test (Task 2) referenced `fastTokens`, update it to assert `fastTokens === undefined` is no longer a thing — or remove that assertion.

- [ ] **Step 9: Update token-resolver test if it references removed helpers**

If `app/cli/tests/services/token-resolver.test.ts` (from PR #87) has cases for `pickDefaultTokenName` or `resolveDefaultToken`, delete those cases. Keep the cases added in Task 4.

Run: `pnpm --filter @fastxyz/cli exec vitest run tests/services/token-resolver.test.ts` — should pass.

- [ ] **Step 10: Commit**

```bash
git add -u app/cli/src/services/token-resolver.ts \
  app/cli/src/schemas/networks.ts \
  app/cli/src/config/networks.ts \
  app/cli/tests/services/token-resolver.test.ts
# the deleted file is already staged by `git rm`
git commit -m "refactor(cli): drop dead default-resolution code (PR #87 fastTokens, pickDefaultTokenName, send-token-helper)"
```

---

## Task 8: x402-client log fix

**Files:**
- Modify: `packages/x402-client/src/fast.ts`

The `decimals=6` hardcode + `"USDC"` literal in the verbose log line is a wire-format limitation: `PaymentRequirement` doesn't carry decimals (verified in `packages/x402-types/src/payment.ts`). The cleanest correct fix is to remove the broken line entirely — the raw amount is already logged at line 98 (`Amount: ${maxAmountRequired} (raw)`) and the asset hex at line 132.

- [ ] **Step 1: Read the current file to confirm the exact lines**

Read `packages/x402-client/src/fast.ts` lines 130–160 to confirm the structure matches the spec.

Expected: lines 139–141 are:
```ts
const amountHuman = toHuman(fastReq.maxAmountRequired, 6);
log(`[Fast] Building transaction via TransactionBuilder...`);
log(`  Amount: ${fastReq.maxAmountRequired} raw → ${amountHuman} USDC`);
```

- [ ] **Step 2: Delete the broken log**

Replace those three lines with:

```ts
log(`[Fast] Building transaction via TransactionBuilder...`);
```

(Remove the `amountHuman` declaration and the `"… raw → … USDC"` log call.)

- [ ] **Step 3: Remove `toHuman` if it's now unused**

Run:
```bash
grep -n "toHuman" packages/x402-client/src/fast.ts
```

Expected: zero occurrences (the only call site was the deleted line). If grep is empty, delete the `function toHuman(...)` declaration at the top of the file (around line 28).

If grep returns OTHER callers, leave `toHuman` in place.

- [ ] **Step 4: Run x402-client tests + typecheck**

Run: `pnpm --filter @fastxyz/x402-client exec vitest run && pnpm --filter @fastxyz/x402-client exec tsc --noEmit`

Expected: 20 pass, typecheck clean. No test currently asserts on the log line; removing it should not regress anything.

- [ ] **Step 5: Commit**

```bash
git add packages/x402-client/src/fast.ts
git commit -m "fix(x402-client): drop broken hardcoded 'USDC raw → human' log line"
```

---

## Task 9: Documentation sync

**Files:**
- Modify: `SPEC.md`
- Modify: `app/cli/README.md`
- Modify: `README.md` (root)
- Modify: `skills/fast/SKILL.md`

No TDD here — review and verification by reading the rendered text.

- [ ] **Step 1: `SPEC.md` — §6.18.2 `fund usdc crypto`**

Update the `--token` row in the flags table to:
- Default column: `network.defaultToken.symbol` (e.g., `fastUSD` on mainnet, `testUSDC` on testnet).
- Description: append "Bridge routes do not carry `fastUSD`; omitting `--token` on mainnet `fund usdc crypto` errors with `CommandUnsupportedForTokenError`. Pass `--token USDC` for the bridge case."

Update the "Errors" or "Behavior" subsection (whichever applies) to document that `CommandUnsupportedForTokenError` is the error raised when the chosen (or defaulted) token is not available on the requested chain.

- [ ] **Step 2: `SPEC.md` — §6.19 `send`**

Update the `--token` row in the flags table to:
- Default column: `network.defaultToken.symbol`.
- Description: simplify the "Defaults depend on the route…" sentence to "If `--token` is omitted, the network's default token (`network.defaultToken.symbol`) is used. Bridge routes additionally require the resolved token to exist on the target chain; otherwise the command errors with `CommandUnsupportedForTokenError`."

- [ ] **Step 3: `SPEC.md` — §5 Exit codes / error table**

Add a new row for `COMMAND_UNSUPPORTED_FOR_TOKEN` with exit code 2.

- [ ] **Step 4: `SPEC.md` — §6 command listing intro**

Add a one-sentence note near the top of §6: "Commands that accept `--token` default to `network.defaultToken.symbol` (`fastUSD` on mainnet, `testUSDC` on testnet) when the flag is omitted."

- [ ] **Step 5: `app/cli/README.md` — Quick Start**

Find the line near the Quick Start that mentions the default behavior (PR #87 added "Send USDC explicitly (omitting --token would default to fastUSD on mainnet)"). Reframe as:

```text
# Send the network's default token (fastUSD on mainnet) — Fast → Fast
fast send fast1abc...xyz 10

# Send a specific token explicitly
fast send fast1abc...xyz 10 --token USDC
```

Add a short section under "Global Options" or near `--token`: "The default token is sourced from the network config. To use a different default, register a custom network with `fast network add <name> --config <path>` where the JSON includes a `defaultToken` field."

- [ ] **Step 6: Root `README.md`**

If the root README has CLI example snippets that mention `--token` defaulting, sync the wording with the Quick Start. If the examples don't reference defaulting, no change.

- [ ] **Step 7: `skills/fast/SKILL.md`**

In the `send` table, update the `--token <TOKEN>` row to:
> Defaults to `network.defaultToken.symbol` (`fastUSD` on mainnet, `testUSDC` on testnet) when omitted. Bridge routes (`--from-chain` / `--to-chain`) require the resolved token to be available on the target chain; otherwise the command errors with `CommandUnsupportedForTokenError`.

In the `fund` table, update the `fast fund usdc crypto <amount>` row to:
> Defaults to `network.defaultToken.symbol` when `--token` is omitted. On mainnet that's `fastUSD`, which is not bridgeable — pass `--token USDC` for the bridge case. The command errors with `CommandUnsupportedForTokenError` otherwise.

- [ ] **Step 8: Read the changed files to verify**

Run:
```bash
git diff -- SPEC.md app/cli/README.md README.md skills/fast/SKILL.md | head -120
```

Skim for consistency: every place that previously mentioned `selectSendTokenName`, "first chain's first token", or `fastTokens` is updated. No stale wording remains.

- [ ] **Step 9: Commit**

```bash
git add SPEC.md app/cli/README.md README.md skills/fast/SKILL.md
git commit -m "docs: sync default-token policy and CommandUnsupportedForTokenError"
```

---

## Task 10: Final regression + changeset + open PR

**Files:**
- Create: `.changeset/cli-explicit-default-token.md`

- [ ] **Step 1: Full monorepo regression**

Run:
```bash
pnpm install --frozen-lockfile
pnpm --filter @fastxyz/cli exec vitest run
pnpm --filter @fastxyz/x402-client exec vitest run
pnpm --filter @fastxyz/cli exec tsc --noEmit
pnpm --filter @fastxyz/x402-client exec tsc --noEmit
pnpm --filter @fastxyz/sdk exec tsc --noEmit
pnpm exec turbo run build
```

Expected: all green. CLI test count is up from PR #87's 31 (new tests in `tests/errors/`, `tests/schemas/`, `tests/commands/command-unsupported-for-token.test.ts`).

- [ ] **Step 2: Add a changeset**

Run `pnpm exec changeset` interactively, or create `.changeset/cli-explicit-default-token.md` directly:

```markdown
---
"@fastxyz/cli": minor
"@fastxyz/x402-client": patch
---

CLI: `send` and `fund usdc crypto` now resolve omitted `--token` to `network.defaultToken.symbol` (sourced from the SDK — `fastUSD` on mainnet, `testUSDC` on testnet) instead of silently falling back to the first chain's first token. When the resolved token isn't available on the targeted chain, the CLI errors with the new `CommandUnsupportedForTokenError` (exit code 2, `COMMAND_UNSUPPORTED_FOR_TOKEN`). Typos still surface as `TokenNotFoundError`.

The PR-#87 default-resolution helpers (`pickDefaultTokenName`, `resolveDefaultToken`, `selectSendTokenName`) and the CLI-only `fastTokens` map are removed in favor of the single SDK-driven path.

x402-client: removes the broken `"… raw → … USDC"` diagnostic log in `fast.ts` (the wire format does not carry decimals; the raw amount and asset hex are already logged separately).
```

- [ ] **Step 3: Push branch and open PR**

```bash
git push -u origin feat/cli-explicit-default-token
gh pr create --base develop --title "feat(cli): explicit default-token resolution + CommandUnsupportedForTokenError" --body "$(cat <<'EOF'
## Summary

Replaces the silent "first chain's first token" fallback in `send` and `fund usdc crypto` with an explicit, configuration-driven default sourced from the SDK's `network.defaultToken` (mainnet → fastUSD, testnet → testUSDC). Adds `CommandUnsupportedForTokenError` for the chain × token mismatch case, distinguishing it from genuine typos (which keep producing `TokenNotFoundError`). Removes the PR-#87 default-resolution machinery now that `network.defaultToken` is the sole source.

Also fixes the broken `decimals=6` + `"USDC"` literal log in `packages/x402-client/src/fast.ts` by removing the diagnostic line (the wire format does not carry decimals).

Spec: `docs/superpowers/specs/2026-05-20-cli-explicit-default-token-design.md`. Plan: `docs/superpowers/plans/2026-05-20-cli-explicit-default-token.md`.

## What changed

- `app/cli/src/schemas/networks.ts` — add `FastTokenSchema` and `NetworkConfigSchema.defaultToken`; remove `fastTokens` (PR #87).
- `app/cli/src/config/networks.ts` — populate `bundledNetworks.{mainnet,testnet}.defaultToken` from the SDK; remove `fastTokens.fastUSD`.
- `app/cli/src/services/token-resolver.ts` — `resolveToken` consults `network.defaultToken` in the Fast → Fast branch; `lookupTokenNameById` falls back to `defaultToken`; new `tokenIsKnownOnNetwork` predicate; `pickDefaultTokenName`/`resolveDefaultToken` removed.
- `app/cli/src/commands/send.ts` — uses `args.token ?? network.defaultToken?.symbol`; chain-context `TokenNotFoundError` is rewrapped as `CommandUnsupportedForTokenError` when the token was defaulted or is known elsewhere on the network.
- `app/cli/src/commands/fund/usdc/crypto.ts` — same pattern; suggestion always includes "Try `--token USDC`."
- `app/cli/src/commands/send-token-helper.ts` — deleted (`selectSendTokenName` no longer needed).
- `app/cli/src/errors/transaction.ts` + `index.ts` — `CommandUnsupportedForTokenError` added to `ClientError`.
- `packages/x402-client/src/fast.ts` — drop the broken `"raw → … USDC"` log line.
- `SPEC.md`, `app/cli/README.md`, `README.md`, `skills/fast/SKILL.md` — doc sync.

## Test plan

- [x] `pnpm --filter @fastxyz/cli exec vitest run` — all pass, including the new tests in `tests/errors/`, `tests/schemas/`, `tests/services/`, `tests/commands/`.
- [x] `pnpm --filter @fastxyz/x402-client exec vitest run` — 20 pass.
- [x] `pnpm --filter @fastxyz/cli exec tsc --noEmit` — clean.
- [x] `pnpm --filter @fastxyz/x402-client exec tsc --noEmit` — clean.
- [x] `pnpm exec turbo run build` — green.
- [ ] Smoke: `fast send fast1addr 5` on mainnet defaults to fastUSD; on testnet defaults to testUSDC.
- [ ] Smoke: `fast send fast1addr 5 --from-chain arbitrum` on mainnet errors with `CommandUnsupportedForTokenError` mentioning fastUSD and suggesting `--token`.
- [ ] Smoke: `fast send fast1addr 5 --from-chain arbitrum --token USDD` errors with `TokenNotFoundError` (no rewrap).
- [ ] Smoke: `fast fund usdc crypto 50 --chain arbitrum` on mainnet errors with `CommandUnsupportedForTokenError` and suggestion `"Try --token USDC. Pass --token explicitly."`.
- [ ] Smoke: `fast pay <url> --dry-run` against a Fast endpoint — verbose logs no longer show the `"raw → human USDC"` line.

## Follow-ups

- GitHub issue tracking the deeper `fund usdc crypto` semantic-mismatch UX (see spec §Open follow-ups).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Confirm PR opens green**

Run: `gh pr checks --watch` (replace with the new PR number if needed).

Expected: CI runs and goes green within ~5 minutes.

---

## Risk register

1. **PR #87 not on develop yet.** Task 0 verifies this. If the verification fails, the entire plan is premature.
2. **`send-token-helper.ts` has callers besides `send.ts`.** Task 7 step 1 guards against this with `grep`. If any other caller exists, that caller is updated to use the new resolver path before deletion.
3. **The transitional `fastTokens` block in `resolveToken` (Task 4 step 3) leaks into Task 7 if Task 7's step 5 is skipped.** Task 7 step 5 removes it; the spec's resolver snippet (§Code changes step 4) describes the final form.
4. **Changeset bumps may surprise.** This PR ships a behavior change (silent fallback removed). A minor bump for `@fastxyz/cli` is appropriate. The x402-client change is log-only — patch.
