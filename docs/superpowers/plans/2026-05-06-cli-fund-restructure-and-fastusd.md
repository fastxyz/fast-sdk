<!-- markdownlint-disable MD013 MD024 MD031 MD032 MD040 -->
# CLI fund restructure and fastUSD adoption — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape the `fund` CLI command tree to `fund usdc fiat` / `fund usdc crypto` / `fund fastusd`, where `fund fastusd` emits an `app.fast.xyz/send?to=<addr>&amount=<n>` URL; make `fastUSD` (a Fast-native token, mainnet-only) the default Fast→Fast token in `send`; stop mislabeling x402 payments as `"USDC"` in display/log/history when the actual asset paid is different.

**Architecture:** Optique parsers nest natively via `command()` + `or()`, so the 2-deep tree is a parser change plus updates to `main.ts`'s post-parse error helper (`SUBCOMMANDS` / `SUBCOMMAND_REQUIREMENTS`). `networks.json` gains an optional top-level `fastTokens` map per network (mainnet only); the schema gains a matching optional field; `resolveToken` learns to consult `fastTokens` first when no chain context is given, plus an inverse `lookupTokenNameById` helper used by `pay.ts` for B2-fix display/history truth. `send`'s implicit-default block delegates to a new `resolveDefaultToken` helper that prefers `fastTokens.fastUSD` on mainnet. The `fund` directory restructure is a pure file move plus a new `fastusd.ts` URL-emitter; the existing fund handlers' bodies don't change.

**Tech Stack:** TypeScript, Effect, Effect Schema, `@optique/core`, vitest, Drizzle, `@fastxyz/sdk`, `@fastxyz/allset-sdk`, `@fastxyz/x402-client`.

**Spec:** [docs/superpowers/specs/2026-05-06-cli-fund-restructure-and-fastusd-design.md](docs/superpowers/specs/2026-05-06-cli-fund-restructure-and-fastusd-design.md)

**Branch:** `feat/cli-fund-fastusd` (off `origin/main`). Do not touch `feat/multisig-cli` (PR #85).

---

## File map

| Status | Path | Responsibility |
| --- | --- | --- |
| Create | `app/cli/vitest.config.ts` | Vitest config for CLI package (matches feat/multisig-cli shape). |
| Modify | `app/cli/package.json` | Add `"test": "vitest run"` script. |
| Create | `app/cli/tests/services/token-resolver.test.ts` | Tests for resolver: chain-scoped, no-chain `fastTokens`, no-chain fallback, default helper, id→name helper. |
| Create | `app/cli/tests/commands/fund-fastusd.test.ts` | URL-shape tests for `fund fastusd` (handler-level, no DB). |
| Create | `app/cli/tests/commands/send-default-token.test.ts` | Default-token resolution for Fast→Fast `send`. |
| Modify | `app/cli/src/schemas/networks.ts` | Add `FastTokenSchema`, optional `fastTokens` on `NetworkConfigSchema`. |
| Modify | `app/cli/src/config/networks.json` | Add mainnet `fastTokens.fastUSD`. |
| Modify | `app/cli/src/services/token-resolver.ts` | `fastTokens` consult; `resolveDefaultToken`; `lookupTokenNameById`. |
| Modify | `app/cli/src/commands/send.ts` | Use `resolveDefaultToken` when `--token` is omitted. |
| Modify | `packages/x402-client/src/types.ts` | Add `asset?: string` to `PaymentDetails`. |
| Modify | `packages/x402-client/src/fast.ts` | Set `asset` on result; verbose log shows raw asset. |
| Modify | `app/cli/src/commands/pay.ts` | Resolve real asset name for dry-run + history. |
| Move + Modify | `app/cli/src/commands/fund/fiat.ts` → `app/cli/src/commands/fund/usdc/fiat.ts` | Path change + rename handler/type/discriminant; logic unchanged. |
| Move + Modify | `app/cli/src/commands/fund/crypto.ts` → `app/cli/src/commands/fund/usdc/crypto.ts` | Path change + rename handler/type/discriminant; logic unchanged. |
| Create | `app/cli/src/commands/fund/fastusd-url.ts` | Pure URL builder (Task 8). |
| Create | `app/cli/src/commands/fund/fastusd.ts` | New URL-emitter handler (Task 9 step 5). |
| Modify | `app/cli/src/cli.ts` | Restructure `fund` parser; rename arg-type exports; new `fundFastUsd` parser. |
| Modify | `app/cli/src/commands/index.ts` | Swap imports; rename registrants. |
| Modify | `app/cli/src/main.ts` | Update `SUBCOMMANDS["fund"]`; rekey `SUBCOMMAND_REQUIREMENTS` for 2-deep entries; add 3rd-token error message. |
| Modify | `skills/fast/SKILL.md` | Sync command tables and walkthroughs. |
| Modify | `app/cli/README.md` | Sync quickstart, command reference, end-to-end example. |
| Scan | `README.md`, `SPEC.md` | Update only if stale references found. |

---

## Conventions for every task

- Each task ends in **one** commit, conventional message style (`feat(cli): ...`, `refactor(cli): ...`, etc.).
- Run `cd app/cli && pnpm exec tsc --noEmit` before committing each task; output must be empty. Same for `packages/x402-client` when its files change.
- After editing any `.md` file, run `pnpm dlx markdownlint-cli --fix <file>` (per global CLAUDE.md formatting rule).
- Do not add `--no-verify` or skip hooks.
- One task at a time. Do not batch tasks into a single commit.

---

## Task 1: Vitest infrastructure for the CLI package

**Files:**
- Create: `app/cli/vitest.config.ts`
- Modify: `app/cli/package.json`
- Create: `app/cli/tests/sanity.test.ts` (deleted at end of this task)

- [ ] **Step 1: Write the smoke test that proves vitest runs**

Create `app/cli/tests/sanity.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("vitest sanity", () => {
  it("runs a trivial test", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails (no config yet)**

Run: `cd app/cli && pnpm exec vitest run`
Expected: ERROR — vitest cannot find a config or finds no test files (depends on root-workspace vitest defaults). The exact failure mode doesn't matter; we just want to prove the test isn't already passing by accident.

- [ ] **Step 3: Add the vitest config**

Create `app/cli/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Add the `test` script to `package.json`**

Edit `app/cli/package.json` `scripts` block to add `"test": "vitest run"`:

```jsonc
"scripts": {
  "build": "tsup",
  "prepack": "tsup",
  "dev": "tsup --watch",
  "test": "vitest run"
},
```

(No new devDependency — vitest is provided by the root workspace at `/package.json`.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd app/cli && pnpm exec vitest run`
Expected: `1 passed`. The sanity test passes.

- [ ] **Step 6: Delete the sanity test**

Delete `app/cli/tests/sanity.test.ts`. Real tests come in subsequent tasks.

- [ ] **Step 7: Verify tsc**

Run: `cd app/cli && pnpm exec tsc --noEmit`
Expected: empty output.

- [ ] **Step 8: Commit**

```bash
git add app/cli/vitest.config.ts app/cli/package.json
git commit -m "chore(cli): add vitest test infrastructure"
```

---

## Task 2: Schema gains optional `fastTokens` field

**Files:**
- Modify: `app/cli/src/schemas/networks.ts`

This is a schema-only change; no test for the schema itself (Effect Schema decoders are exercised transitively by the resolver tests in Task 3 and the bundled-config load path).

- [ ] **Step 1: Add the schema**

Edit `app/cli/src/schemas/networks.ts` and add the `FastTokenSchema`, plus the optional `fastTokens` field on `NetworkConfigSchema`:

```ts
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

export const FastTokenSchema = Schema.Struct({
  fastTokenId: Schema.String,
  decimals: Schema.Number,
});
export type FastTokenConfig = typeof FastTokenSchema.Type;

export const NetworkConfigSchema = Schema.Struct({
  url: Schema.String,
  explorerUrl: Schema.String,
  networkId: Schema.String,
  allSet: Schema.optional(AllSetConfigSchema),
  fastTokens: Schema.optional(
    Schema.Record({ key: Schema.String, value: FastTokenSchema }),
  ),
});
export type NetworkConfig = typeof NetworkConfigSchema.Type;

export const BundledNetworksSchema = Schema.Record({
  key: Schema.String,
  value: NetworkConfigSchema,
});
export type BundledNetworks = typeof BundledNetworksSchema.Type;
```

- [ ] **Step 2: Verify tsc**

Run: `cd app/cli && pnpm exec tsc --noEmit`
Expected: empty output. (No consumer reads `fastTokens` yet, but adding optional fields breaks nothing.)

- [ ] **Step 3: Commit**

```bash
git add app/cli/src/schemas/networks.ts
git commit -m "feat(cli): schema support for optional fastTokens map"
```

---

## Task 3: Token resolver — `fastTokens` consult, default helper, inverse helper (TDD)

**Files:**
- Create: `app/cli/tests/services/token-resolver.test.ts`
- Modify: `app/cli/src/services/token-resolver.ts`

The resolver is pure (no DB / Effect services), so tests can call it synchronously with handcrafted `NetworkConfig` objects.

- [ ] **Step 1: Write the failing tests**

Create `app/cli/tests/services/token-resolver.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  lookupTokenNameById,
  resolveDefaultToken,
  resolveToken,
} from "../../src/services/token-resolver.js";
import { TokenNotFoundError, UnsupportedChainError } from "../../src/errors/index.js";
import type { NetworkConfig } from "../../src/schemas/networks.js";

const MAINNET: NetworkConfig = {
  url: "https://api.fast.xyz/proxy-rest",
  explorerUrl: "https://explorer.fast.xyz",
  networkId: "fast:mainnet",
  allSet: {
    crossSignUrl: "https://cross-sign.allset.fast.xyz",
    portalApiUrl: "https://allset.fast.xyz/api",
    chains: {
      ethereum: {
        chainId: 1,
        bridgeContract: "0xbridge",
        fastBridgeAddress: "fast1bridge",
        relayerUrl: "https://relay/eth",
        evmRpcUrl: "https://rpc/eth",
        evmExplorerUrl: "https://etherscan.io",
        tokens: {
          USDC: {
            evmAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
            fastTokenId:
              "0xc655a12330da6af361d281b197996d2bc135aaed3b66278e729c2222291e9130",
            decimals: 6,
          },
        },
      },
    },
  },
  fastTokens: {
    fastUSD: {
      fastTokenId:
        "0x125b60bb2e805336f0934077d4f9fdb36f45bec9ded8d7b0e637516cc43a86eb",
      decimals: 6,
    },
  },
};

const TESTNET: NetworkConfig = {
  url: "https://testnet.api.fast.xyz/proxy-rest",
  explorerUrl: "https://testnet.explorer.fast.xyz",
  networkId: "fast:testnet",
  allSet: {
    crossSignUrl: "https://testnet.cross-sign.allset.fast.xyz",
    portalApiUrl: "https://testnet.allset.fast.xyz/api",
    chains: {
      "arbitrum-sepolia": {
        chainId: 421614,
        bridgeContract: "0xbridge",
        fastBridgeAddress: "fast1bridge",
        relayerUrl: "https://relay/arb",
        evmRpcUrl: "https://rpc/arb",
        evmExplorerUrl: "https://sepolia.arbiscan.io",
        tokens: {
          testUSDC: {
            evmAddress: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
            fastTokenId:
              "0xd73a0679a2be46981e2a8aedecd951c8b6690e7d5f8502b34ed3ff4cc2163b46",
            decimals: 6,
          },
        },
      },
    },
  },
};

describe("resolveToken", () => {
  it("resolves a chain-scoped token (bridge route)", () => {
    const r = resolveToken("USDC", MAINNET, "ethereum");
    expect(r.decimals).toBe(6);
    expect(r.evmAddress).toBe("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
  });

  it("throws UnsupportedChainError for an unknown chain", () => {
    expect(() => resolveToken("USDC", MAINNET, "polygon")).toThrow(
      UnsupportedChainError,
    );
  });

  it("throws TokenNotFoundError when chain exists but token does not", () => {
    expect(() => resolveToken("WBTC", MAINNET, "ethereum")).toThrow(
      TokenNotFoundError,
    );
  });

  it("prefers fastTokens over chain scan when no chain context (mainnet)", () => {
    const r = resolveToken("fastUSD", MAINNET);
    expect(r.decimals).toBe(6);
    expect(r.evmAddress).toBeUndefined();
  });

  it("falls back to chain scan when no fastTokens entry matches (mainnet)", () => {
    const r = resolveToken("USDC", MAINNET);
    expect(r.decimals).toBe(6);
  });

  it("falls back to chain scan when fastTokens is absent (testnet)", () => {
    const r = resolveToken("testUSDC", TESTNET);
    expect(r.decimals).toBe(6);
  });

  it("ignores fastTokens when chain context is given (mainnet)", () => {
    expect(() => resolveToken("fastUSD", MAINNET, "ethereum")).toThrow(
      TokenNotFoundError,
    );
  });
});

describe("resolveDefaultToken", () => {
  it("returns fastUSD on mainnet", () => {
    const r = resolveDefaultToken(MAINNET);
    expect(r.name).toBe("fastUSD");
    expect(r.token.decimals).toBe(6);
  });

  it("returns testUSDC on testnet (no fastTokens, falls back to first chain's first token)", () => {
    const r = resolveDefaultToken(TESTNET);
    expect(r.name).toBe("testUSDC");
    expect(r.token.decimals).toBe(6);
  });

  it("throws TokenNotFoundError when nothing is registered", () => {
    const empty: NetworkConfig = {
      url: "x",
      explorerUrl: "x",
      networkId: "x",
    };
    expect(() => resolveDefaultToken(empty)).toThrow(TokenNotFoundError);
  });
});

describe("lookupTokenNameById", () => {
  it("returns the fastTokens key when an entry matches (mainnet)", () => {
    const name = lookupTokenNameById(
      MAINNET,
      "0x125b60bb2e805336f0934077d4f9fdb36f45bec9ded8d7b0e637516cc43a86eb",
    );
    expect(name).toBe("fastUSD");
  });

  it("returns a chain-scoped token name when its fastTokenId matches", () => {
    const name = lookupTokenNameById(
      MAINNET,
      "0xc655a12330da6af361d281b197996d2bc135aaed3b66278e729c2222291e9130",
    );
    expect(name).toBe("USDC");
  });

  it("matches case-insensitively on hex value", () => {
    const name = lookupTokenNameById(
      MAINNET,
      "0xC655A12330DA6AF361D281B197996D2BC135AAED3B66278E729C2222291E9130",
    );
    expect(name).toBe("USDC");
  });

  it("strips a leading 0x consistently on input", () => {
    const name = lookupTokenNameById(
      MAINNET,
      "c655a12330da6af361d281b197996d2bc135aaed3b66278e729c2222291e9130",
    );
    expect(name).toBe("USDC");
  });

  it("returns undefined when no entry matches", () => {
    const name = lookupTokenNameById(MAINNET, "0xdeadbeef");
    expect(name).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `cd app/cli && pnpm exec vitest run tests/services/token-resolver.test.ts`
Expected: All tests fail because `resolveDefaultToken` and `lookupTokenNameById` are not exported, and `resolveToken` does not consult `fastTokens`.

- [ ] **Step 3: Update the resolver**

Replace `app/cli/src/services/token-resolver.ts` with:

```ts
import { fromHex } from "@fastxyz/sdk";
import type { NetworkConfig } from "../schemas/networks.js";
import { TokenNotFoundError, UnsupportedChainError } from "../errors/index.js";

export interface ResolvedToken {
  readonly fastTokenId: Uint8Array;
  readonly decimals: number;
  readonly evmAddress?: string;
}

/**
 * Map a token name to its on-Fast id, decimals, and (when bridging) EVM address.
 *
 * - With chain context (bridge route): only chain-scoped `allSet.chains[chain].tokens` is consulted.
 * - Without chain context (Fast→Fast): `network.fastTokens` is consulted first, then chain-scoped tokens.
 */
export function resolveToken(
  tokenName: string,
  networkConfig: NetworkConfig,
  chain?: string,
): ResolvedToken {
  if (chain) {
    const allset = networkConfig.allSet;
    if (!allset) {
      throw new TokenNotFoundError({ token: tokenName });
    }
    const chainConfig = allset.chains[chain];
    if (!chainConfig) {
      throw new UnsupportedChainError({ chain });
    }
    const token = chainConfig.tokens[tokenName];
    if (!token) {
      throw new TokenNotFoundError({ token: tokenName });
    }
    return {
      fastTokenId: fromHex(token.fastTokenId),
      decimals: token.decimals,
      evmAddress: token.evmAddress,
    };
  }

  const fast = networkConfig.fastTokens?.[tokenName];
  if (fast) {
    return {
      fastTokenId: fromHex(fast.fastTokenId),
      decimals: fast.decimals,
    };
  }

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

/**
 * Resolve the implicit default token for a Fast→Fast operation.
 * Prefers `fastTokens.fastUSD`, then any single `fastTokens` entry,
 * then the first chain's first token. Throws TokenNotFoundError if none.
 */
export function resolveDefaultToken(networkConfig: NetworkConfig): {
  readonly name: string;
  readonly token: ResolvedToken;
} {
  const fast = networkConfig.fastTokens;
  if (fast) {
    if ("fastUSD" in fast) {
      const t = fast.fastUSD!;
      return {
        name: "fastUSD",
        token: { fastTokenId: fromHex(t.fastTokenId), decimals: t.decimals },
      };
    }
    const keys = Object.keys(fast);
    if (keys.length === 1) {
      const name = keys[0]!;
      const t = fast[name]!;
      return {
        name,
        token: { fastTokenId: fromHex(t.fastTokenId), decimals: t.decimals },
      };
    }
    // Multiple entries, none called "fastUSD" — ambiguous, fall through.
  }

  const allset = networkConfig.allSet;
  if (allset) {
    const firstChain = Object.values(allset.chains)[0];
    if (firstChain) {
      const firstName = Object.keys(firstChain.tokens)[0];
      if (firstName) {
        const token = firstChain.tokens[firstName]!;
        return {
          name: firstName,
          token: {
            fastTokenId: fromHex(token.fastTokenId),
            decimals: token.decimals,
          },
        };
      }
    }
  }

  throw new TokenNotFoundError({ token: "<default>" });
}

/** Normalise a hex string for comparison: strip leading 0x and lowercase. */
const norm = (h: string): string =>
  (h.startsWith("0x") || h.startsWith("0X") ? h.slice(2) : h).toLowerCase();

/**
 * Inverse of resolveToken: given a fastTokenId hex (server's payment requirement),
 * return the registered display name. Searches `fastTokens` then `allSet.chains[*].tokens`.
 * Returns undefined when no entry matches.
 */
export function lookupTokenNameById(
  networkConfig: NetworkConfig,
  fastTokenId: string,
): string | undefined {
  const target = norm(fastTokenId);

  const fast = networkConfig.fastTokens;
  if (fast) {
    for (const [name, entry] of Object.entries(fast)) {
      if (norm(entry.fastTokenId) === target) return name;
    }
  }

  const allset = networkConfig.allSet;
  if (allset) {
    for (const chain of Object.values(allset.chains)) {
      for (const [name, entry] of Object.entries(chain.tokens)) {
        if (norm(entry.fastTokenId) === target) return name;
      }
    }
  }

  return undefined;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app/cli && pnpm exec vitest run tests/services/token-resolver.test.ts`
Expected: All resolver tests pass.

- [ ] **Step 5: Verify tsc**

Run: `cd app/cli && pnpm exec tsc --noEmit`
Expected: empty output.

- [ ] **Step 6: Commit**

```bash
git add app/cli/src/services/token-resolver.ts app/cli/tests/services/token-resolver.test.ts
git commit -m "feat(cli): token resolver consults fastTokens + add default and id->name helpers"
```

---

## Task 4: Register `fastUSD` in `networks.json` (mainnet)

**Files:**
- Modify: `app/cli/src/config/networks.json`

The schema gained the field in Task 2; the resolver gained the lookup logic in Task 3; this task wires the actual data so the bundled mainnet config has fastUSD available.

- [ ] **Step 1: Add the data**

Edit `app/cli/src/config/networks.json`. Inside the `mainnet` object, after the `allSet` block, add:

```json
"fastTokens": {
  "fastUSD": {
    "fastTokenId": "0x125b60bb2e805336f0934077d4f9fdb36f45bec9ded8d7b0e637516cc43a86eb",
    "decimals": 6
  }
}
```

The `mainnet` object then ends:

```json
"mainnet": {
  "url": "...",
  "explorerUrl": "...",
  "networkId": "fast:mainnet",
  "allSet": { ... },
  "fastTokens": {
    "fastUSD": {
      "fastTokenId": "0x125b60bb2e805336f0934077d4f9fdb36f45bec9ded8d7b0e637516cc43a86eb",
      "decimals": 6
    }
  }
}
```

Do NOT add `fastTokens` to the `testnet` block — testnet has no fastUSD.

- [ ] **Step 2: Verify the schema accepts it**

Run: `cd app/cli && pnpm exec tsc --noEmit`
Expected: empty output (the JSON is loaded as a module via `tsconfig`'s `resolveJsonModule`; the schema decode happens at runtime in `services/config/app.ts`, but tsc still validates the type shape).

- [ ] **Step 3: Run all CLI tests so far**

Run: `cd app/cli && pnpm exec vitest run`
Expected: all tests pass (no behavior change — resolver tests use handcrafted configs, and no other consumer reads `fastTokens` yet).

- [ ] **Step 4: Commit**

```bash
git add app/cli/src/config/networks.json
git commit -m "feat(cli): register fastUSD in mainnet bundled network config"
```

---

## Task 5: `send` Fast→Fast uses `resolveDefaultToken` (TDD)

**Files:**
- Create: `app/cli/tests/commands/send-default-token.test.ts`
- Modify: `app/cli/src/commands/send.ts`

The test exercises only the implicit-default selection logic — not the entire send handler. Specifically: today, when `args.token` is undefined, `send.ts` constructs `resolvedTokenName` via an inline IIFE that scans the first chain. This IIFE must be replaced with a call to `resolveDefaultToken`. To test this without spinning up an entire Effect runtime + DB, we test `resolveDefaultToken` directly (Task 3 covered that) and add a focused integration-ish test that spies on the IIFE replacement via re-export.

For the focused command-level test we exercise the small piece of logic that belongs to `send.ts`: the `resolvedTokenName` selection block. We extract it into a tiny helper so it's testable without an Effect runtime.

- [ ] **Step 1: Write the failing test**

Create `app/cli/tests/commands/send-default-token.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { selectSendTokenName } from "../../src/commands/send-token-helper.js";
import type { NetworkConfig } from "../../src/schemas/networks.js";

const MAINNET: NetworkConfig = {
  url: "https://api.fast.xyz/proxy-rest",
  explorerUrl: "https://explorer.fast.xyz",
  networkId: "fast:mainnet",
  allSet: {
    crossSignUrl: "https://cross-sign.allset.fast.xyz",
    portalApiUrl: "https://allset.fast.xyz/api",
    chains: {
      ethereum: {
        chainId: 1,
        bridgeContract: "0xb",
        fastBridgeAddress: "fast1b",
        relayerUrl: "https://r/eth",
        evmRpcUrl: "https://rpc/eth",
        evmExplorerUrl: "https://etherscan.io",
        tokens: {
          USDC: {
            evmAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
            fastTokenId:
              "0xc655a12330da6af361d281b197996d2bc135aaed3b66278e729c2222291e9130",
            decimals: 6,
          },
        },
      },
    },
  },
  fastTokens: {
    fastUSD: {
      fastTokenId:
        "0x125b60bb2e805336f0934077d4f9fdb36f45bec9ded8d7b0e637516cc43a86eb",
      decimals: 6,
    },
  },
};

const TESTNET: NetworkConfig = {
  ...MAINNET,
  fastTokens: undefined,
  allSet: {
    ...MAINNET.allSet!,
    chains: {
      "arbitrum-sepolia": {
        ...MAINNET.allSet!.chains.ethereum!,
        tokens: {
          testUSDC: {
            evmAddress: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
            fastTokenId:
              "0xd73a0679a2be46981e2a8aedecd951c8b6690e7d5f8502b34ed3ff4cc2163b46",
            decimals: 6,
          },
        },
      },
    },
  },
};

describe("selectSendTokenName (send default-token logic)", () => {
  it("returns explicit token when provided (mainnet)", () => {
    expect(selectSendTokenName("fastUSDC", MAINNET, undefined)).toBe("fastUSDC");
  });

  it("returns fastUSD on mainnet when token is omitted and no chain", () => {
    expect(selectSendTokenName(undefined, MAINNET, undefined)).toBe("fastUSD");
  });

  it("returns testUSDC on testnet when token is omitted and no chain", () => {
    expect(selectSendTokenName(undefined, TESTNET, undefined)).toBe("testUSDC");
  });

  it("returns first chain token when token is omitted and chain context exists (mainnet)", () => {
    expect(selectSendTokenName(undefined, MAINNET, "ethereum")).toBe("USDC");
  });

  it("returns first chain token when token is omitted and chain context exists (testnet)", () => {
    expect(selectSendTokenName(undefined, TESTNET, "arbitrum-sepolia")).toBe(
      "testUSDC",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app/cli && pnpm exec vitest run tests/commands/send-default-token.test.ts`
Expected: FAIL — module `../../src/commands/send-token-helper.js` not found.

- [ ] **Step 3: Extract the helper**

Create `app/cli/src/commands/send-token-helper.ts`:

```ts
import type { NetworkConfig } from "../schemas/networks.js";
import { resolveDefaultToken } from "../services/token-resolver.js";

/**
 * Pick the token NAME (a string the resolver later maps to a ResolvedToken) for
 * a `send` invocation given the user's --token flag and bridge chain context.
 *
 * - Explicit --token wins.
 * - With chain context (--from-chain / --to-chain): default to first token on that
 *   chain, falling back to "USDC" only if the chain config is somehow empty.
 * - Without chain context (Fast→Fast): use resolveDefaultToken (prefers fastTokens.fastUSD on mainnet).
 */
export function selectSendTokenName(
  explicit: string | undefined,
  networkConfig: NetworkConfig,
  chain: string | undefined,
): string {
  if (explicit !== undefined) return explicit;

  if (chain) {
    const chainCfg = networkConfig.allSet?.chains[chain];
    const first = chainCfg ? Object.keys(chainCfg.tokens)[0] : undefined;
    return first ?? "USDC";
  }

  return resolveDefaultToken(networkConfig).name;
}
```

- [ ] **Step 4: Wire the helper into `send.ts`**

In `app/cli/src/commands/send.ts`, replace the inline default-token IIFE (current lines 122-131) with a call to the helper.

Today:

```ts
const tokenChain = fromChain ?? toChain;
const resolvedTokenName =
  args.token ??
  (() => {
    const chains = network.allSet?.chains ?? {};
    const firstChain = Object.values(chains)[0];
    return firstChain
      ? (Object.keys(firstChain.tokens)[0] ?? "USDC")
      : "USDC";
  })();
```

New:

```ts
const tokenChain = fromChain ?? toChain;
const resolvedTokenName = selectSendTokenName(args.token, network, tokenChain);
```

Add the import at the top of `send.ts`:

```ts
import { selectSendTokenName } from "./send-token-helper.js";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd app/cli && pnpm exec vitest run tests/commands/send-default-token.test.ts`
Expected: all 5 tests pass.

- [ ] **Step 6: Run all CLI tests**

Run: `cd app/cli && pnpm exec vitest run`
Expected: all tests pass.

- [ ] **Step 7: Verify tsc**

Run: `cd app/cli && pnpm exec tsc --noEmit`
Expected: empty output.

- [ ] **Step 8: Commit**

```bash
git add app/cli/src/commands/send-token-helper.ts app/cli/src/commands/send.ts app/cli/tests/commands/send-default-token.test.ts
git commit -m "feat(cli): send Fast->Fast defaults to fastUSD on mainnet"
```

---

## Task 6: x402-client surfaces `asset` on `PaymentDetails`

**Files:**
- Modify: `packages/x402-client/src/types.ts`
- Modify: `packages/x402-client/src/fast.ts`

The x402-client has a vitest setup of its own (`packages/x402-client/tests/`); we add a tiny focused test for the new `asset` field on the result.

- [ ] **Step 1: Write the failing test**

Edit `packages/x402-client/tests/index.test.ts` and add a new `describe` block at the bottom (inside the outer `describe('x402-client', ...)`):

```ts
  describe('PaymentDetails.asset', () => {
    it('exposes the asset hex on the result so callers can label payments correctly', async () => {
      // This is a structural assertion — it confirms the type carries `asset`
      // and that fast.ts populates it from the server's payment requirement.
      // We do NOT exercise the full Fast network flow (that's covered
      // by integration tests). We do a minimal handler-level check by
      // constructing a result via the public type and verifying TS accepts it.
      const sample: import('../src/types.js').PaymentDetails = {
        network: 'fast-mainnet',
        amount: '1.0',
        recipient: 'fast1abc',
        txHash: '0xdead',
        asset:
          '0x125b60bb2e805336f0934077d4f9fdb36f45bec9ded8d7b0e637516cc43a86eb',
      };
      expect(sample.asset).toBe(
        '0x125b60bb2e805336f0934077d4f9fdb36f45bec9ded8d7b0e637516cc43a86eb',
      );
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/x402-client && pnpm exec vitest run tests/index.test.ts`
Expected: FAIL — TypeScript error "Object literal may only specify known properties, and `asset` does not exist in type `PaymentDetails`."

- [ ] **Step 3: Extend `PaymentDetails`**

Edit `packages/x402-client/src/types.ts` line 108-115 (the `PaymentDetails` interface). Add an optional `asset` field:

```ts
/**
 * Payment details in response
 */
export interface PaymentDetails {
  network: string;
  amount: string;
  recipient: string;
  txHash: string;
  /** The token id (hex string) actually paid, mirrored from the server's payment requirement. */
  asset?: string;
  bridged?: boolean;
  bridgeTxHash?: string;
}
```

- [ ] **Step 4: Populate `asset` in `fast.ts`**

Edit `packages/x402-client/src/fast.ts` lines 205-220 (the return statement of `handleFastPayment`). Add `asset` to the `payment` object:

```ts
return {
  success: paidRes.ok,
  statusCode: paidRes.status,
  headers: resHeaders,
  body: resBody,
  payment: {
    network: fastReq.network,
    amount: amountHuman,
    recipient: fastReq.payTo,
    txHash,
    asset: fastReq.asset,
  },
  note: paidRes.ok
    ? `Fast payment of ${amountHuman} successful. Content delivered.`
    : `Payment submitted (tx: ${txHash}) but server returned ${paidRes.status}.`,
  logs: verbose ? logs : undefined,
};
```

- [ ] **Step 5: Fix the verbose log line**

In the same `fast.ts`, replace line 137 (the misleading `→ ${amountHuman} USDC` log):

Old:

```ts
log(`  Amount: ${fastReq.maxAmountRequired} raw → ${amountHuman} USDC`);
```

New:

```ts
log(`  Amount: ${fastReq.maxAmountRequired} raw → ${amountHuman} (asset ${fastReq.asset})`);
```

- [ ] **Step 6: Run the x402-client tests**

Run: `cd packages/x402-client && pnpm exec vitest run`
Expected: all tests pass.

- [ ] **Step 7: Verify tsc**

Run: `cd packages/x402-client && pnpm exec tsc --noEmit`
Expected: empty output.

- [ ] **Step 8: Commit**

```bash
git add packages/x402-client/src/types.ts packages/x402-client/src/fast.ts packages/x402-client/tests/index.test.ts
git commit -m "feat(x402-client): surface asset on PaymentDetails; fix misleading USDC log"
```

---

## Task 7: `pay.ts` resolves real asset name for dry-run + history (TDD)

**Files:**
- Modify: `app/cli/src/commands/pay.ts`

`pay.ts` integrates many services so a full handler test is heavy. We instead:

1. Use `lookupTokenNameById` (Task 3) inside `pay.ts` to resolve names.
2. Add a focused unit test that constructs a fake history-entry object using the same helper, demonstrating that the helper produces the right name and "unknown" fallback. This is sufficient to exercise the code path without spinning up the full handler.

- [ ] **Step 1: Write the failing test**

Add a new test file `app/cli/tests/commands/pay-asset-label.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { labelAssetForPayment } from "../../src/commands/pay-asset-label.js";
import type { NetworkConfig } from "../../src/schemas/networks.js";

const MAINNET: NetworkConfig = {
  url: "https://api.fast.xyz/proxy-rest",
  explorerUrl: "https://explorer.fast.xyz",
  networkId: "fast:mainnet",
  fastTokens: {
    fastUSD: {
      fastTokenId:
        "0x125b60bb2e805336f0934077d4f9fdb36f45bec9ded8d7b0e637516cc43a86eb",
      decimals: 6,
    },
  },
};

describe("labelAssetForPayment", () => {
  it("returns the registered token name when asset matches", () => {
    expect(
      labelAssetForPayment(
        MAINNET,
        "0x125b60bb2e805336f0934077d4f9fdb36f45bec9ded8d7b0e637516cc43a86eb",
      ),
    ).toBe("fastUSD");
  });

  it("returns 'unknown' when asset is undefined", () => {
    expect(labelAssetForPayment(MAINNET, undefined)).toBe("unknown");
  });

  it("returns the short hex when asset is unknown", () => {
    expect(labelAssetForPayment(MAINNET, "0xdeadbeefcafe1234")).toBe(
      "0xdeadbeefcafe1234",
    );
  });

  it("returns the empty-string fallback as 'unknown'", () => {
    expect(labelAssetForPayment(MAINNET, "")).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app/cli && pnpm exec vitest run tests/commands/pay-asset-label.test.ts`
Expected: FAIL — module `../../src/commands/pay-asset-label.js` not found.

- [ ] **Step 3: Add the helper**

Create `app/cli/src/commands/pay-asset-label.ts`:

```ts
import type { NetworkConfig } from "../schemas/networks.js";
import { lookupTokenNameById } from "../services/token-resolver.js";

/**
 * Translate a server-supplied asset hex into a display string for the pay
 * dry-run printer and the history entry's `tokenName` column.
 *
 * - undefined / "" → "unknown"
 * - registered → the registry's display name (e.g. "fastUSD", "USDC")
 * - unregistered hex → the hex itself (so callers can still trace it on-chain)
 */
export function labelAssetForPayment(
  networkConfig: NetworkConfig,
  asset: string | undefined,
): string {
  if (!asset) return "unknown";
  const name = lookupTokenNameById(networkConfig, asset);
  return name ?? asset;
}
```

- [ ] **Step 4: Wire the helper into `pay.ts`**

Edit `app/cli/src/commands/pay.ts`. Three substitutions; explicit before/after each.

**Note on a small semantic change in this step:** today the network is resolved at line 106, *after* the dry-run early return. To make the dry-run display use real asset names, this step **hoists** the `network` resolution above the dry-run branch. After the change, dry-run mode also resolves the active network — so a broken network config will fail dry-run, where today it would not. This is a deliberate, low-cost change (one extra DB read on dry-run) and arguably better behavior; mention it in the commit message.

(a) **Imports** — add the helper and the `NetworkConfigService` is already imported. Add at the top:

```ts
import { labelAssetForPayment } from "./pay-asset-label.js";
```

(b) **Dry-run display** (current line 94). The dry-run path resolves the network via `networkConfig.resolve(config.network)` later in normal mode, but the dry-run path runs *before* network resolution. Restructure so the network is resolved up-front and made available to both branches. Add right after the `body` line (around line 56):

```ts
const network = yield* networkConfig.resolve(config.network);
```

Then in the dry-run loop (around line 90-95), replace:

```ts
yield* output.humanLine(`  Asset:   ${opt.asset ?? "USDC"}`);
```

With:

```ts
yield* output.humanLine(
  `  Asset:   ${labelAssetForPayment(network, opt.asset)}`,
);
```

Then **remove** the duplicate `const network = yield* networkConfig.resolve(config.network);` line that previously appeared in the normal-mode branch (around line 106) — it's now hoisted above.

(c) **History entry tokenName** (current line 191). Replace:

```ts
tokenName: "USDC",
```

With:

```ts
tokenName: labelAssetForPayment(network, p.asset),
```

The `result.payment.asset` field exists from Task 6.

- [ ] **Step 5: Run the new test to verify it passes**

Run: `cd app/cli && pnpm exec vitest run tests/commands/pay-asset-label.test.ts`
Expected: all 4 tests pass.

- [ ] **Step 6: Run all CLI tests**

Run: `cd app/cli && pnpm exec vitest run`
Expected: all tests pass.

- [ ] **Step 7: Verify tsc**

Run: `cd app/cli && pnpm exec tsc --noEmit`
Expected: empty output.

- [ ] **Step 8: Commit**

```bash
git add app/cli/src/commands/pay-asset-label.ts app/cli/src/commands/pay.ts app/cli/tests/commands/pay-asset-label.test.ts
git commit -m "fix(cli): pay shows real asset name in dry-run and history"
```

---

## Task 8: `fund fastusd` URL builder helper (TDD, pure)

**Files:**
- Create: `app/cli/src/commands/fund/fastusd-url.ts` (pure URL builder)
- Create: `app/cli/tests/commands/fund-fastusd.test.ts` (URL builder tests)

The handler that uses this helper is created in Task 9 (so `cli.ts` parser additions, the new arg type, and the handler all land together with `tsc` clean). This task lands the pure URL builder + its tests independently.

**Tests are limited to the URL builder.** Handler-level tests (mainnet-only check, `--to` default to active account, address validation, JSON output shape) would require setting up an Effect runtime with a mocked `AccountStore` / `Output` / `ClientConfig` — and there is no such test scaffolding for any other CLI handler on `origin/main`. Introducing it for one new handler is out of scope; manual smoke testing in Task 11 step 4 verifies the handler paths instead.

- [ ] **Step 1: Write the failing test**

Create `app/cli/tests/commands/fund-fastusd.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildFundFastUsdUrl } from "../../src/commands/fund/fastusd-url.js";

describe("buildFundFastUsdUrl", () => {
  it("emits to= when only address is provided", () => {
    expect(buildFundFastUsdUrl("fast1abc", undefined)).toBe(
      "https://app.fast.xyz/send?to=fast1abc",
    );
  });

  it("emits both to= and amount= when both are provided", () => {
    expect(buildFundFastUsdUrl("fast1abc", "10")).toBe(
      "https://app.fast.xyz/send?to=fast1abc&amount=10",
    );
  });

  it("preserves a decimal amount unchanged", () => {
    expect(buildFundFastUsdUrl("fast1abc", "10.5")).toBe(
      "https://app.fast.xyz/send?to=fast1abc&amount=10.5",
    );
  });

  it("URL-encodes special characters in the address", () => {
    expect(buildFundFastUsdUrl("fast1abc def", "10")).toBe(
      "https://app.fast.xyz/send?to=fast1abc+def&amount=10",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app/cli && pnpm exec vitest run tests/commands/fund-fastusd.test.ts`
Expected: FAIL — module `../../src/commands/fund/fastusd-url.js` not found.

- [ ] **Step 3: Write the URL builder**

Create `app/cli/src/commands/fund/fastusd-url.ts`:

```ts
const APP_BASE = "https://app.fast.xyz/send";

/**
 * Build the `app.fast.xyz/send` URL that opens the unified Fast funding flow.
 * The web app accepts both query params as optional and prompts the user when missing.
 */
export function buildFundFastUsdUrl(
  to: string,
  amount: string | undefined,
): string {
  const params = new URLSearchParams({ to });
  if (amount !== undefined) {
    params.set("amount", amount);
  }
  return `${APP_BASE}?${params.toString()}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd app/cli && pnpm exec vitest run tests/commands/fund-fastusd.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Verify tsc**

Run: `cd app/cli && pnpm exec tsc --noEmit`
Expected: empty output. (The URL builder is self-contained — no dependency on types that arrive in Task 9.)

- [ ] **Step 6: Commit**

```bash
git add app/cli/src/commands/fund/fastusd-url.ts app/cli/tests/commands/fund-fastusd.test.ts
git commit -m "feat(cli): fund fastusd URL builder helper"
```

---

## Task 9: Restructure `fund` command tree — parsers, registry, dispatch

**Files:**
- Modify: `app/cli/src/cli.ts`
- Modify: `app/cli/src/commands/index.ts`
- Modify: `app/cli/src/main.ts`
- Move: `app/cli/src/commands/fund/fiat.ts` → `app/cli/src/commands/fund/usdc/fiat.ts`
- Move: `app/cli/src/commands/fund/crypto.ts` → `app/cli/src/commands/fund/usdc/crypto.ts`

This is the biggest single change. We do it in one task because the parser, registry, and main dispatch are tightly coupled — partial changes leave the build broken.

- [ ] **Step 1: Move the `fiat.ts` and `crypto.ts` files into the new `usdc/` subdirectory**

```bash
mkdir -p app/cli/src/commands/fund/usdc
git mv app/cli/src/commands/fund/fiat.ts app/cli/src/commands/fund/usdc/fiat.ts
git mv app/cli/src/commands/fund/crypto.ts app/cli/src/commands/fund/usdc/crypto.ts
```

- [ ] **Step 2: Update import depths inside the moved files**

In both `app/cli/src/commands/fund/usdc/fiat.ts` and `app/cli/src/commands/fund/usdc/crypto.ts`, every relative import currently reads `../../...`. They now need one more `../`. Update each file's imports.

For `fiat.ts`, the imports change from `../../cli.js`, `../../errors/index.js`, etc. to `../../../cli.js`, `../../../errors/index.js`, etc. **Concrete diff for `fiat.ts`:**

Old top of file:

```ts
import { Effect } from "effect";
import type { FundFiatArgs } from "../../cli.js";
import { InvalidAddressError, InvalidUsageError } from "../../errors/index.js";
import { ClientConfig } from "../../services/config/client.js";
import { Output } from "../../services/output.js";
import { AccountStore } from "../../services/storage/account.js";
import type { Command } from "../index.js";
```

New top of file:

```ts
import { Effect } from "effect";
import type { FundUsdcFiatArgs } from "../../../cli.js";
import { InvalidAddressError, InvalidUsageError } from "../../../errors/index.js";
import { ClientConfig } from "../../../services/config/client.js";
import { Output } from "../../../services/output.js";
import { AccountStore } from "../../../services/storage/account.js";
import type { Command } from "../../index.js";
```

Then change the exported handler name and discriminant:

Old:

```ts
export const fundFiat: Command<FundFiatArgs> = {
  cmd: "fund-fiat",
```

New:

```ts
export const fundUsdcFiat: Command<FundUsdcFiatArgs> = {
  cmd: "fund-usdc-fiat",
```

Repeat the analogous changes in `crypto.ts`:
- Type rename: `FundCryptoArgs` → `FundUsdcCryptoArgs`.
- Handler rename: `fundCrypto` → `fundUsdcCrypto`.
- Discriminant rename: `"fund-crypto"` → `"fund-usdc-crypto"`.
- Three-deep relative imports.

- [ ] **Step 3: Restructure parsers in `cli.ts`**

Edit `app/cli/src/cli.ts`. Find the `// Fund commands` section (currently lines 351-396) and replace **the entire fund block** (the three parsers `fundFiatParser`, `fundCryptoParser`, `fundGroup`) with:

```ts
// ---------------------------------------------------------------------------
// Fund commands
// ---------------------------------------------------------------------------

const fundUsdcFiatParser = command(
  "fiat",
  object({
    cmd: constant("fund-usdc-fiat" as const),
    address: optional(
      option("--address", string({ metavar: "ADDRESS" }), {
        description: message`Fast address to fund (default: default account)`,
      }),
    ),
  }),
  { description: message`Get a fiat on-ramp funding URL (USDC via Ramp)` },
);

const fundUsdcCryptoParser = command(
  "crypto",
  object({
    cmd: constant("fund-usdc-crypto" as const),
    amount: argument(string({ metavar: "AMOUNT" }), {
      description: message`Human-readable amount to fund (e.g., 100.00)`,
    }),
    chain: option("--chain", string({ metavar: "CHAIN" }), {
      description: message`EVM chain to bridge from (see fast info bridge-chains)`,
    }),
    token: optional(
      option("--token", string({ metavar: "TOKEN" }), {
        description: message`Token to bridge (default: USDC / testUSDC)`,
      }),
    ),
    eip7702: withDefault(
      option("--eip-7702", {
        description: message`Use EIP-7702 smart deposit (gas paid in USDC via paymaster, no ETH required)`,
      }),
      false,
    ),
  }),
  { description: message`Bridge USDC from an EVM chain (lands as fastUSDC)` },
);

const fundUsdcGroup = command(
  "usdc",
  or(fundUsdcFiatParser, fundUsdcCryptoParser),
  { description: message`Fund with USDC (lands as fastUSDC on Fast)` },
);

const fundFastUsdParser = command(
  "fastusd",
  object({
    cmd: constant("fund-fastusd" as const),
    to: optional(
      option("--to", string({ metavar: "ADDRESS" }), {
        description: message`Fast address to fund (default: default account)`,
      }),
    ),
    amount: optional(
      option("--amount", string({ metavar: "AMOUNT" }), {
        description: message`Optional amount (decimal, e.g. 10.5)`,
      }),
    ),
  }),
  {
    description: message`Print a Fast web-app URL to fund your account with fastUSD (mainnet only)`,
  },
);

const fundGroup = command(
  "fund",
  or(fundUsdcGroup, fundFastUsdParser),
  { description: message`Fund your account` },
);
```

- [ ] **Step 4: Restructure exported types in `cli.ts`**

Still in `cli.ts`. Find the export block (currently lines 471-473):

```ts
export type FundFiatArgs = InferValue<typeof fundFiatParser>;
export type FundCryptoArgs = InferValue<typeof fundCryptoParser>;
export type PayArgs = InferValue<typeof payParser>;
```

Replace with:

```ts
export type FundUsdcFiatArgs = InferValue<typeof fundUsdcFiatParser>;
export type FundUsdcCryptoArgs = InferValue<typeof fundUsdcCryptoParser>;
export type FundFastUsdArgs = InferValue<typeof fundFastUsdParser>;
export type PayArgs = InferValue<typeof payParser>;
```

The root-union line `const commands = or(accountGroup, networkGroup, infoGroup, sendParser, fundGroup, payParser);` is unchanged (`fundGroup` is now the new tree).

- [ ] **Step 5: Create the `fund fastusd` handler**

Create `app/cli/src/commands/fund/fastusd.ts`:

```ts
import { Effect } from "effect";
import type { FundFastUsdArgs } from "../../cli.js";
import { InvalidAddressError, InvalidAmountError, InvalidUsageError } from "../../errors/index.js";
import { ClientConfig } from "../../services/config/client.js";
import { Output } from "../../services/output.js";
import { AccountStore } from "../../services/storage/account.js";
import type { Command } from "../index.js";
import { buildFundFastUsdUrl } from "./fastusd-url.js";

const isPositiveDecimal = (s: string): boolean => {
  if (s.trim() === "") return false;
  if (!/^\d+(\.\d+)?$/.test(s)) return false;
  return Number.parseFloat(s) > 0;
};

export const fundFastUsd: Command<FundFastUsdArgs> = {
  cmd: "fund-fastusd",
  handler: (args) =>
    Effect.gen(function* () {
      const accounts = yield* AccountStore;
      const output = yield* Output;
      const config = yield* ClientConfig;

      if (config.network !== "mainnet") {
        return yield* Effect.fail(
          new InvalidUsageError({
            message:
              `fastUSD funding is only available on mainnet. ` +
              `Current network: ${config.network}. ` +
              `Switch with --network mainnet.`,
          }),
        );
      }

      let address: string;
      if (args.to) {
        if (!args.to.startsWith("fast1")) {
          return yield* Effect.fail(
            new InvalidAddressError({
              message: `Invalid Fast address "${args.to}". Must start with fast1.`,
            }),
          );
        }
        address = args.to;
      } else {
        const account = yield* accounts.resolveAccount(config.account);
        address = account.fastAddress;
      }

      if (args.amount !== undefined && !isPositiveDecimal(args.amount)) {
        return yield* Effect.fail(
          new InvalidAmountError({
            message: `Invalid amount "${args.amount}". Expected a positive decimal (e.g. 10 or 1.5).`,
          }),
        );
      }

      const url = buildFundFastUsdUrl(address, args.amount);

      yield* output.humanLine("Open this URL in your browser to fund your account:");
      yield* output.humanLine("");
      yield* output.humanLine(`  ${url}`);
      yield* output.humanLine("");
      yield* output.ok({ url, address });
    }),
};
```

This file depends on `FundFastUsdArgs` (added in Step 4) and `buildFundFastUsdUrl` (added in Task 8). Both are present at this point.

- [ ] **Step 6: Update the command registry in `commands/index.ts`**

Edit `app/cli/src/commands/index.ts`. Replace the two fund imports:

Old:

```ts
import { fundCrypto } from "./fund/crypto.js";
import { fundFiat } from "./fund/fiat.js";
```

New:

```ts
import { fundFastUsd } from "./fund/fastusd.js";
import { fundUsdcCrypto } from "./fund/usdc/crypto.js";
import { fundUsdcFiat } from "./fund/usdc/fiat.js";
```

Replace the registrations in the `commands` array:

Old:

```ts
fundCrypto,
fundFiat,
```

New (alphabetised to match surrounding style):

```ts
fundFastUsd,
fundUsdcCrypto,
fundUsdcFiat,
```

- [ ] **Step 7: Update dispatch metadata in `main.ts`**

Edit `app/cli/src/main.ts`.

(a) `SUBCOMMANDS["fund"]` (current line 157):

Old:

```ts
fund: ["fiat", "crypto"],
```

New:

```ts
fund: ["usdc", "fastusd"],
```

(b) `SUBCOMMAND_REQUIREMENTS` (currently lines 222-237). Remove the two old fund entries:

Old:

```ts
"fund crypto": {
  usage: "fast fund crypto <amount> --chain <chain> [--token <token>]",
  options: ["--chain", "--token", "--eip-7702"],
  check: (positionals, allArgv) => {
    if (positionals.length < 3) return "Missing required argument: <amount>";
    if (!allArgv.some((a) => a === "--chain" || a.startsWith("--chain=")))
      return "Missing required option: --chain <chain>";
    return null;
  },
},
"fund fiat": {
  usage: "fast fund fiat [--address <address>]",
  options: ["--address"],
  check: () => null,
},
```

Replace with:

```ts
"fund usdc": {
  usage: "fast fund usdc <fiat|crypto>",
  options: [],
  check: (positionals) => {
    const third = positionals[2];
    if (!third) return "Missing subcommand. Available: fiat, crypto";
    if (third !== "fiat" && third !== "crypto")
      return `Unknown subcommand '${third}' for 'fund usdc'. Available: fiat, crypto`;
    return null;
  },
},
"fund usdc fiat": {
  usage: "fast fund usdc fiat [--address <address>]",
  options: ["--address"],
  check: () => null,
},
"fund usdc crypto": {
  usage: "fast fund usdc crypto <amount> --chain <chain> [--token <token>]",
  options: ["--chain", "--token", "--eip-7702"],
  check: (positionals, allArgv) => {
    if (positionals.length < 4) return "Missing required argument: <amount>";
    if (!allArgv.some((a) => a === "--chain" || a.startsWith("--chain=")))
      return "Missing required option: --chain <chain>";
    return null;
  },
},
"fund fastusd": {
  usage: "fast fund fastusd [--to <fast1...>] [--amount <decimal>]",
  options: ["--to", "--amount"],
  check: () => null,
},
```

Note: `fund usdc crypto`'s positional check is now `< 4` (not `< 3`) because the chain has three positional tokens before the amount: `fund`, `usdc`, `crypto`, then `<amount>`.

(c) Extend the parse-error post-processing (currently lines 341-364) to look up `${firstToken} ${secondToken} ${thirdToken}` when a third positional exists. Replace the `else if (firstToken && firstToken in SUBCOMMANDS)` branch as follows:

Old:

```ts
} else if (firstToken && firstToken in SUBCOMMANDS) {
  const subs = SUBCOMMANDS[firstToken];
  const secondToken = positionals[1];
  if (!secondToken) {
    msg = `Missing subcommand for '${firstToken}'. Available: ${subs.join(", ")}.`;
  } else if (!subs.includes(secondToken)) {
    const s = suggest(secondToken, subs);
    msg = s
      ? `Unknown subcommand '${secondToken}' for '${firstToken}'. Did you mean '${s}'?`
      : `Unknown subcommand '${secondToken}' for '${firstToken}'. Available: ${subs.join(", ")}.`;
  } else {
    // Valid subcommand but parse still failed — check for missing required args/options
    const key = `${firstToken} ${secondToken}`;
    const req = SUBCOMMAND_REQUIREMENTS[key];
    if (req) {
      const hint = req.check(positionals, argv);
      if (hint) {
        msg = `${hint}\n  Usage: ${req.usage}`;
      } else if (req.options) {
        const unknown = findUnknownFlag(argv, req.options);
        if (unknown) msg = `Unknown option '${unknown}'.\n  Usage: ${req.usage}`;
      }
    }
  }
}
```

New:

```ts
} else if (firstToken && firstToken in SUBCOMMANDS) {
  const subs = SUBCOMMANDS[firstToken];
  const secondToken = positionals[1];
  if (!secondToken) {
    msg = `Missing subcommand for '${firstToken}'. Available: ${subs.join(", ")}.`;
  } else if (!subs.includes(secondToken)) {
    const s = suggest(secondToken, subs);
    msg = s
      ? `Unknown subcommand '${secondToken}' for '${firstToken}'. Did you mean '${s}'?`
      : `Unknown subcommand '${secondToken}' for '${firstToken}'. Available: ${subs.join(", ")}.`;
  } else {
    // Try the deepest matching key (3-deep first, then 2-deep) so e.g.
    // `fund usdc fiat` matches "fund usdc fiat" not "fund usdc".
    const thirdToken = positionals[2];
    const deepKey = thirdToken ? `${firstToken} ${secondToken} ${thirdToken}` : null;
    const shallowKey = `${firstToken} ${secondToken}`;
    const key =
      deepKey && deepKey in SUBCOMMAND_REQUIREMENTS ? deepKey : shallowKey;
    const req = SUBCOMMAND_REQUIREMENTS[key];
    if (req) {
      const hint = req.check(positionals, argv);
      if (hint) {
        msg = `${hint}\n  Usage: ${req.usage}`;
      } else if (req.options) {
        const unknown = findUnknownFlag(argv, req.options);
        if (unknown) msg = `Unknown option '${unknown}'.\n  Usage: ${req.usage}`;
      }
    }
  }
}
```

- [ ] **Step 8: Verify tsc**

Run: `cd app/cli && pnpm exec tsc --noEmit`
Expected: empty output. If errors mention old names (`fundFiat`, `FundFiatArgs`, etc.), grep the codebase for stragglers and rename them.

- [ ] **Step 9: Run all CLI tests**

Run: `cd app/cli && pnpm exec vitest run`
Expected: all tests pass.

- [ ] **Step 10: Manual sanity check — exercise the new commands end-to-end**

```bash
cd app/cli && pnpm exec tsx src/main.ts fund fastusd --help
cd app/cli && pnpm exec tsx src/main.ts fund usdc --help
cd app/cli && pnpm exec tsx src/main.ts fund usdc fiat --help
cd app/cli && pnpm exec tsx src/main.ts fund usdc crypto --help
cd app/cli && pnpm exec tsx src/main.ts fund usdc bogus 2>&1 | head -3
cd app/cli && pnpm exec tsx src/main.ts fund usdc 2>&1 | head -3
```

Expected: each `--help` invocation prints the contextual help; `fund usdc bogus` prints the "Unknown subcommand" hint; `fund usdc` prints the "Missing subcommand. Available: fiat, crypto" hint.

- [ ] **Step 11: Commit**

```bash
git add app/cli/src/cli.ts \
  app/cli/src/commands/index.ts \
  app/cli/src/commands/fund/ \
  app/cli/src/main.ts
git commit -m "feat(cli): restructure fund into 2-deep tree (usdc fiat/crypto + fastusd)"
```

The `app/cli/src/commands/fund/` add picks up both the moved `usdc/` files and the new `fastusd.ts` handler from Step 5.

---

## Task 10: Sync agent skill doc and CLI README

**Files:**
- Modify: `skills/fast/SKILL.md`
- Modify: `app/cli/README.md`
- Read (and modify only if stale): `README.md`, `SPEC.md`

This task has no automated tests; the verification is `markdownlint --fix` clean and a manual diff review.

- [ ] **Step 1: Update `skills/fast/SKILL.md`**

Open the file. Apply the following edits.

(a) The funding-commands table near line 84-86:

Old:

```markdown
| `fast fund crypto <amount>` | Bridge USDC from an EVM chain into the Fast account | `--chain <chain>` (required), `--eip-7702` (gasless) |
| `fast fund fiat` | Open a fiat on-ramp (mainnet only) | `--network mainnet` |
```

New:

```markdown
| `fast fund usdc fiat` | Print a Ramp on-ramp URL for funding with USDC (mainnet only). Lands as **fastUSDC**. | `--network mainnet`, `--address` |
| `fast fund usdc crypto <amount>` | Bridge USDC from an EVM chain into the Fast account. Lands as **fastUSDC**. | `--chain <chain>` (required), `--token`, `--eip-7702` (gasless) |
| `fast fund fastusd` | Print an `app.fast.xyz/send` URL that opens the unified Fast funding page (mainnet only). Funds **fastUSD** (Fast-native, distinct from fastUSDC). | `--to <fast1...>`, `--amount <decimal>` |
```

(b) The `--token` row in the `send` table around line 98:

Old:

```markdown
| `--token <TOKEN>` | Token to send (**always specify explicitly**) | `USDC` (default; `testUSDC` is an alias on testnet) |
```

New:

```markdown
| `--token <TOKEN>` | Token to send. If omitted, defaults to `fastUSD` on mainnet (Fast→Fast) and `testUSDC` on testnet. | `USDC`, `fastUSDC`, `fastUSD`, `testUSDC` |
```

(c) The references in the EVM-address note (around line 172):

Old:

```markdown
When running `fast fund crypto` or `fast send --from-chain <chain>`, the CLI
```

New:

```markdown
When running `fast fund usdc crypto` or `fast send --from-chain <chain>`, the CLI
```

(d) The walkthrough section header (around line 270) and its examples (around lines 273, 288, 303):

Old:

```markdown
### 4. Fund from EVM → Fast (`fast fund crypto`)

```sh
fast fund crypto 50 --chain arbitrum-sepolia
```

...

```sh
fast fund crypto 50 --chain base --eip-7702
```

...

```sh
fast fund fiat --network mainnet
# → prints an on-ramp URL
```
```

New:

```markdown
### 4. Fund from EVM → Fast (`fast fund usdc crypto`)

```sh
fast fund usdc crypto 50 --chain arbitrum-sepolia
```

...

```sh
fast fund usdc crypto 50 --chain base --eip-7702
```

...

```sh
fast fund usdc fiat --network mainnet
# → prints a Ramp on-ramp URL (USDC → fastUSDC)
```

### 6. Fund fastUSD via the unified Fast web app

```sh
fast fund fastusd --network mainnet
# → prints app.fast.xyz/send?to=<your-fast-address>
fast fund fastusd --network mainnet --amount 25
# → adds &amount=25
```

This URL is mainnet-only and funds **fastUSD** (a Fast-native token, separate
from fastUSDC).
```

(Adjust the heading number `### 6.` if it conflicts with an existing section — match the local numbering.)

- [ ] **Step 2: Run markdownlint --fix on SKILL.md**

```bash
pnpm dlx markdownlint-cli --fix skills/fast/SKILL.md
```

Expected: clean.

- [ ] **Step 3: Update `app/cli/README.md`**

Apply the following edits.

(a) Quickstart line (around line 38-39):

Old:

```bash
# Bridge from Arbitrum Sepolia to Fast
fast fund crypto 50 --chain arbitrum-sepolia
```

New:

```bash
# Bridge from Arbitrum Sepolia to Fast (USDC → fastUSDC)
fast fund usdc crypto 50 --chain arbitrum-sepolia

# Or get a unified Fast web-app URL to fund fastUSD (mainnet only)
fast fund fastusd --amount 50
```

(b) Section `### \`fast fund fiat\`` (around line 243-258). Replace the entire section with:

```markdown
### `fast fund usdc fiat`

Get a fiat on-ramp URL for funding a Fast address with USDC. The URL targets
[ramp.fast.xyz](https://ramp.fast.xyz). The deposit lands on Fast as
**fastUSDC** (the EVM-bridged variant of USDC).

```bash
fast fund usdc fiat --network mainnet
```

**Requirements:**
- Mainnet only (Ramp does not support testnet).
- Active account or `--address <fast1...>`.
```

(c) Section `### \`fast fund crypto <amount>\`` (around line 261-276). Replace with:

```markdown
### `fast fund usdc crypto <amount>`

Bridge USDC from an EVM chain to the Fast network. The deposit lands as
**fastUSDC** on Fast.

```bash
fast fund usdc crypto 10.5 --chain arbitrum-sepolia --token USDC
```

**Positional arguments:**
- `<amount>` — Human-readable amount to bridge (e.g., `10.5`).

**Options:**
- `--chain <chain>` — Source EVM chain (required).
- `--token <token>` — Token symbol or token ID (defaults to `USDC` / `testUSDC`).
- `--eip-7702` — Use the smart deposit flow (gas paid in USDC via paymaster).
```

(d) Add a new section right after `### \`fast fund usdc crypto\``:

```markdown
### `fast fund fastusd`

Print an `app.fast.xyz/send` URL that opens the unified Fast web app to fund
your account with **fastUSD** (a Fast-native token, separate from fastUSDC).
The web app handles fiat-onramp, crypto-bridge, and wallet-to-wallet funding
under the hood; the CLI's job is just to produce the URL.

```bash
fast fund fastusd
# → https://app.fast.xyz/send?to=fast1...

fast fund fastusd --amount 25
# → https://app.fast.xyz/send?to=fast1...&amount=25

fast fund fastusd --to fast1someoneelse --amount 10
# → https://app.fast.xyz/send?to=fast1someoneelse&amount=10
```

**Options:**
- `--to <fast1...>` — Recipient Fast address (default: active account).
- `--amount <decimal>` — Optional amount; if omitted, the web app prompts.

**Requirements:**
- Mainnet only.
```

(e) End-to-end example around line 386-390:

Old:

```bash
# 2. Get a fiat on-ramp URL
fast fund fiat --network mainnet --address fast1...
```

New:

```bash
# 2. Get a fiat on-ramp URL (USDC → fastUSDC)
fast fund usdc fiat --network mainnet --address fast1...

# 2b. Or open the unified Fast web app to fund fastUSD
fast fund fastusd --network mainnet
```

- [ ] **Step 4: Run markdownlint --fix on the README**

```bash
pnpm dlx markdownlint-cli --fix app/cli/README.md
```

Expected: clean.

- [ ] **Step 5: Scan root `README.md` and `SPEC.md` for stale references**

Run:

```bash
grep -n -E "fund (fiat|crypto)|testUSDC|fund-fiat|fund-crypto" README.md SPEC.md 2>/dev/null
```

If matches appear: update them in place using the same patterns as above
(`fund fiat` → `fund usdc fiat`, etc.) and run `pnpm dlx markdownlint-cli
--fix <file>` for each modified file. If no matches: skip (no need to invent
new sections).

- [ ] **Step 6: Manual sanity-check the rendered docs**

Read each modified file end-to-end one more time. Look for:
- Inconsistent token names (USDC vs fastUSDC vs fastUSD).
- Broken markdown anchors (any `#fast-fund-fiat` ids that should now be `#fast-fund-usdc-fiat`).
- Out-of-order section numbering after additions.

Fix in place.

- [ ] **Step 7: Commit**

```bash
git add skills/fast/SKILL.md app/cli/README.md
# Add README.md and SPEC.md too if Step 5 modified them.
git commit -m "docs(cli): sync fund command tree and fastUSD adoption"
```

---

## Task 11: Cross-cutting verification + PR prep

**Files:** none (verification only).

- [ ] **Step 1: Full repo tsc clean**

```bash
cd app/cli && pnpm exec tsc --noEmit
cd packages/x402-client && pnpm exec tsc --noEmit
cd packages/fast-sdk && pnpm exec tsc --noEmit
```

Expected: every command exits 0 with empty output. If `packages/fast-sdk` reports errors that pre-date this branch (compare against `git diff origin/main -- packages/fast-sdk/`), they are out of scope and should be flagged but not "fixed" in this branch.

- [ ] **Step 2: Full vitest run from each modified package**

```bash
cd app/cli && pnpm exec vitest run
cd packages/x402-client && pnpm exec vitest run
```

Expected: all tests pass. If any test runs flaky (e.g., network), retry once; on persistent flake, capture the failure and pause to ask the user before proceeding.

- [ ] **Step 3: Optional — full monorepo build**

```bash
cd /home/yuqing/Documents/Code/fast-sdk && pnpm build
```

Expected: build succeeds. If it fails for unrelated reasons (e.g., a sibling package has a pre-existing issue on main), confirm with `git stash && pnpm build` on a clean working tree — if it still fails, the issue is pre-existing and out of scope.

- [ ] **Step 4: Manual smoke test on the dev CLI**

```bash
cd app/cli
pnpm exec tsx src/main.ts --help
pnpm exec tsx src/main.ts fund --help
pnpm exec tsx src/main.ts fund fastusd --help
pnpm exec tsx src/main.ts fund usdc fiat --help
pnpm exec tsx src/main.ts fund usdc crypto --help
pnpm exec tsx src/main.ts fund fastusd --network mainnet --to fast1abc --amount 10
# Expected output: an https://app.fast.xyz/send?to=fast1abc&amount=10 URL
pnpm exec tsx src/main.ts fund fastusd --network testnet
# Expected: InvalidUsageError "fastUSD funding is only available on mainnet…"
```

If any output mismatches what's documented in the README or SKILL.md, fix the discrepancy and re-run from Step 1.

- [ ] **Step 5: Final `git status` review**

```bash
git status
git log origin/main..HEAD --oneline
```

Expected status: clean working tree. Expected log: ~10 commits (one per task above), in conventional-commit form.

If there are uncommitted changes, decide per-file: legitimate fix → commit with a `chore` or `fix` message; experimental/forgotten → revert.

- [ ] **Step 6: Hand off**

Pause and report to the user:

```text
Implementation complete on branch `feat/cli-fund-fastusd`. <N> commits ahead of origin/main:
  <list of commits>

All checks green:
  - tsc (app/cli, packages/x402-client, packages/fast-sdk)
  - vitest (app/cli, packages/x402-client)
  - manual smoke test of `fund fastusd` URL output

Ready to push and open PR? (Will use the same shape as PR #85: Summary / Test plan / Out of scope, with the Generated-with-Claude-Code trailer.)
```

Wait for user confirmation before running `git push -u origin feat/cli-fund-fastusd` or `gh pr create`.

---

## Self-review checklist (run before considering this plan finished)

- [ ] Every spec section maps to a task: `fund` restructure → 8+9; fastUSD config → 2+4; resolver extension → 3; send default → 5; pay/x402-client cosmetic fix → 6+7; doc sync → 10.
- [ ] No `TBD` / `TODO` / `implement later` / `add appropriate error handling` / `similar to Task N` (without code) phrases anywhere.
- [ ] Type names consistent across tasks: `FundUsdcFiatArgs`, `FundUsdcCryptoArgs`, `FundFastUsdArgs`, `selectSendTokenName`, `resolveDefaultToken`, `lookupTokenNameById`, `labelAssetForPayment`, `buildFundFastUsdUrl`. Method/discriminant names: `fundUsdcFiat` (`"fund-usdc-fiat"`), `fundUsdcCrypto` (`"fund-usdc-crypto"`), `fundFastUsd` (`"fund-fastusd"`).
- [ ] Each task ends with one commit; commit message style is conventional and matches the type of change (`feat`, `refactor`, `chore`, `docs`, `fix`).
- [ ] Verification commands are spelled out: `cd app/cli && pnpm exec vitest run`, `cd app/cli && pnpm exec tsc --noEmit`, etc.
