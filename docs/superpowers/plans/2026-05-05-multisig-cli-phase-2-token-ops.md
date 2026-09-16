# Multisig CLI — Phase 2 (Token Operations) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `fast token create`, `fast token mint`, `fast token burn`, and `fast token manage` commands. All four work polymorphically for single-signer and multisig accounts, reusing the dispatch shape Phase 1 established for `fast send`.

**Architecture:** Extract the build-and-submit-operation pipeline (resolve signer, fetch nonce, sign via `Signer` or `MultiSigSigner`, submit, branch on `Success` vs `IncompleteMultiSig`) into a shared `submitOperation` helper so the four token commands stay short and focused. Each command handles only its operation-specific concerns: arg parsing, token resolution, pre-validation, success rendering. Phase 1's `signer-resolver`, error taxonomy, and SDK `MultiSigSigner` carry over unchanged.

**Tech Stack:** TypeScript, Effect, `@optique/core`, `@fastxyz/sdk` (`TransactionBuilder`, `MultiSigSigner`), `@fastxyz/schema` (token operation BCS types). Test runner: vitest.

**Spec:** [docs/superpowers/specs/2026-05-04-multisig-in-fast-cli-design.md](../specs/2026-05-04-multisig-in-fast-cli-design.md) §"Operations (polymorphic)".

**Phase 1 prerequisite:** Tasks 1–21 of [2026-05-04-multisig-cli-phase-1.md](./2026-05-04-multisig-cli-phase-1.md) must be merged or available on the branch this plan executes on.

## Preconditions

- Branch off either `feat/multisig-cli` (where Phase 1 lives) or a `main` that includes Phase 1.
- `pnpm exec tsc --noEmit` clean in `app/cli` and `packages/fast-sdk`.
- `pnpm test` green at the start.
- Familiarity with the polymorphic dispatch in [app/cli/src/commands/send.ts](../../app/cli/src/commands/send.ts) (Phase 1's Task 18 output) — Phase 2's helper extracts this exact shape.

## Conventions used by every task

- **Run a single test file:** `cd app/cli && pnpm exec vitest run path/to/test.ts`.
- **tsc check:** `cd app/cli && pnpm exec tsc --noEmit` — must report zero output.
- **Build:** `pnpm --filter @fastxyz/cli build` for the CLI; `pnpm build` for the full monorepo.
- **Commit cadence:** one commit per task. Conventional message style (`feat(cli): ...`).
- **Token id parsing:** users pass either a 64-char hex (with optional `0x` prefix) for a raw token id, or a name like `USDC` resolved via the existing [resolveToken](../../app/cli/src/services/token-resolver.ts) helper. Try hex first (sniff: starts with `0x` or matches `/^[0-9a-fA-F]{64}$/`); fall back to the resolver.
- **Operation user_data:** the `TokenCreation` and `TokenManagement` BCS structs carry `user_data`; `Mint` and `Burn` do **not**. Only `token create` and `token manage` expose `--memo`.
- **Pre-existing pattern reuse:** the polymorphic dispatch in [send.ts](../../app/cli/src/commands/send.ts) at the Fast→Fast branch is the canonical reference. Tasks below cite line ranges; if the line numbers drift, locate by the comment `// ── Fast → Fast ──`.

---

## File structure

**New files:**

- `app/cli/src/services/tx-pipeline.ts` — `submitOperation` helper (Task 1)
- `app/cli/src/commands/token/index.ts` (barrel)
- `app/cli/src/commands/token/create.ts`
- `app/cli/src/commands/token/mint.ts`
- `app/cli/src/commands/token/burn.ts`
- `app/cli/src/commands/token/manage.ts`
- `app/cli/tests/unit/tx-pipeline.test.ts`
- `app/cli/tests/integration/token-operations.test.ts`

**Modified files:**

- `app/cli/src/cli.ts` — four parsers + `tokenGroup`
- `app/cli/src/main.ts` — dispatch + `SUBCOMMANDS` + `SUBCOMMAND_REQUIREMENTS`
- `app/cli/src/commands/index.ts` — register four commands

---

## Task 1: Shared `submitOperation` pipeline helper

**Files:**

- Create: `app/cli/src/services/tx-pipeline.ts`
- Create: `app/cli/tests/unit/tx-pipeline.test.ts`

This helper consolidates the build-and-submit pipeline used by `send`, `token create`, `token mint`, `token burn`, and `token manage`. Given a resolved signer and one operation, it: derives sender bytes, fetches the nonce, signs (single-signer via `TransactionBuilder`, multisig via `MultiSigSigner.signTransaction`), submits, and returns the envelope plus a discriminated result describing success vs incomplete-multisig.

- [ ] **Step 1: Write the failing test**

Create `app/cli/tests/unit/tx-pipeline.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import { Signer } from "@fastxyz/sdk";
import { submitOperation } from "../../src/services/tx-pipeline";
import { FastRpc } from "../../src/services/api/fast";

const SECRET = new Uint8Array(32).fill(0xaa);

describe("submitOperation (single-signer)", () => {
  it("builds, signs, and submits a TokenTransfer; returns Success with hash", async () => {
    const signer = new Signer(SECRET);

    let submitCalls = 0;
    const rpcStub = Layer.succeed(
      FastRpc,
      {
        getAccountInfo: (_p: unknown) =>
          Effect.succeed({ nextNonce: 7n }) as never,
        submitTransaction: (_envelope: unknown) =>
          Effect.sync(() => {
            submitCalls++;
            return { type: "Success", certificate: { stub: true } } as never;
          }) as never,
        getPendingMultisigTransactions: (_p: unknown) =>
          Effect.succeed([]) as never,
        getTokenInfo: (_p: unknown) => Effect.succeed({}) as never,
        getTransactionCertificates: (_p: unknown) =>
          Effect.succeed([]) as never,
        getRpcUrl: () => Effect.succeed("http://test"),
      } as unknown as never,
    );

    const result = await Effect.runPromise(
      submitOperation({
        resolved: { kind: "single", signer, account: {} as never },
        networkId: "fast:testnet",
        operation: {
          type: "TokenTransfer",
          value: {
            tokenId: new Uint8Array(32),
            recipient: new Uint8Array(32),
            amount: 1n,
            userData: null,
          },
        },
      }).pipe(Effect.provide(rpcStub)),
    );

    expect(submitCalls).toBe(1);
    expect(result.status).toBe("success");
    expect(result.nonce).toBe(7n);
    expect(typeof result.txHash).toBe("string");
    expect(result.txHash?.startsWith("0x")).toBe(true);
  });

  it("returns incomplete-multisig (txHash null) when proxy says IncompleteMultiSig", async () => {
    const signer = new Signer(SECRET);

    const rpcStub = Layer.succeed(
      FastRpc,
      {
        getAccountInfo: (_p: unknown) =>
          Effect.succeed({ nextNonce: 0n }) as never,
        submitTransaction: (_envelope: unknown) =>
          Effect.succeed({ type: "IncompleteMultiSig" }) as never,
        getPendingMultisigTransactions: (_p: unknown) =>
          Effect.succeed([]) as never,
        getTokenInfo: (_p: unknown) => Effect.succeed({}) as never,
        getTransactionCertificates: (_p: unknown) =>
          Effect.succeed([]) as never,
        getRpcUrl: () => Effect.succeed("http://test"),
      } as unknown as never,
    );

    const result = await Effect.runPromise(
      submitOperation({
        resolved: { kind: "single", signer, account: {} as never },
        networkId: "fast:testnet",
        operation: {
          type: "TokenTransfer",
          value: {
            tokenId: new Uint8Array(32),
            recipient: new Uint8Array(32),
            amount: 1n,
            userData: null,
          },
        },
      }).pipe(Effect.provide(rpcStub)),
    );

    expect(result.status).toBe("incomplete-multisig");
    expect(result.txHash).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify FAIL**

```bash
cd /home/yuqing/Documents/Code/fast-sdk/app/cli
pnpm exec vitest run tests/unit/tx-pipeline.test.ts
```

Expected: FAIL — module `../../src/services/tx-pipeline` does not exist.

- [ ] **Step 3: Implement the helper**

Create `app/cli/src/services/tx-pipeline.ts`:

```ts
import {
  bcsSchema,
  type NetworkId,
  type OperationInputParams,
  type TransactionEnvelope,
  VersionedTransactionFromBcs,
} from "@fastxyz/schema";
import { hashHex, TransactionBuilder } from "@fastxyz/sdk";
import { Effect, Schema } from "effect";
import { TransactionFailedError } from "../errors/index.js";
import { FastRpc } from "./api/fast.js";
import type { ResolvedSigner } from "./signer-resolver.js";

export interface TxPipelineSuccess {
  readonly status: "success";
  readonly envelope: TransactionEnvelope;
  readonly txHash: string;
  readonly nonce: bigint;
}

export interface TxPipelineIncomplete {
  readonly status: "incomplete-multisig";
  readonly envelope: TransactionEnvelope;
  readonly txHash: null;
  readonly nonce: bigint;
}

export type TxPipelineResult = TxPipelineSuccess | TxPipelineIncomplete;

export interface SubmitOperationParams {
  readonly resolved: ResolvedSigner;
  readonly networkId: NetworkId;
  readonly operation: OperationInputParams;
}

const opAsBuilderCall = (
  builder: TransactionBuilder,
  op: OperationInputParams,
): TransactionBuilder => {
  switch (op.type) {
    case "TokenTransfer":
      return builder.addTokenTransfer(op.value);
    case "TokenCreation":
      return builder.addTokenCreation(op.value);
    case "TokenManagement":
      return builder.addTokenManagement(op.value);
    case "Mint":
      return builder.addMint(op.value);
    case "Burn":
      return builder.addBurn(op.value);
    case "StateInitialization":
      return builder.addStateInitialization(op.value);
    case "StateUpdate":
      return builder.addStateUpdate(op.value);
    case "StateReset":
      return builder.addStateReset(op.value);
    case "ExternalClaim":
      return builder.addExternalClaim(op.value);
    case "LeaveCommittee":
      return builder.addLeaveCommittee();
    case "Escrow":
      return builder.addEscrow(op.value);
    default:
      throw new Error(`unsupported operation type: ${(op as { type: string }).type}`);
  }
};

export const submitOperation = (
  params: SubmitOperationParams,
): Effect.Effect<TxPipelineResult, TransactionFailedError, FastRpc> =>
  Effect.gen(function* () {
    const rpc = yield* FastRpc;

    // 1. Resolve sender bytes
    const senderBytes = yield* Effect.tryPromise({
      try: () =>
        params.resolved.kind === "single"
          ? params.resolved.signer.getPublicKey()
          : params.resolved.signer.getDerivedAddressBytes(),
      catch: (cause) =>
        new TransactionFailedError({
          message: "Failed to resolve sender bytes",
          cause,
        }),
    });

    // 2. Fetch nonce
    const accountInfoRpc = yield* rpc.getAccountInfo({
      address: senderBytes,
      tokenBalancesFilter: null,
      stateKeyFilter: null,
      certificateByNonce: null,
    } as never);
    const nonce = (accountInfoRpc as { nextNonce?: bigint } | null)?.nextNonce ?? 0n;

    // 3. Build + sign the envelope
    let envelope: TransactionEnvelope;
    if (params.resolved.kind === "single") {
      const builder = new TransactionBuilder({
        networkId: params.networkId,
        signer: params.resolved.signer,
        nonce,
      });
      envelope = yield* Effect.tryPromise({
        try: () => opAsBuilderCall(builder, params.operation).sign(),
        catch: (cause) =>
          new TransactionFailedError({
            message: "Failed to sign transaction",
            cause,
          }),
      });
    } else {
      envelope = yield* Effect.tryPromise({
        try: () =>
          params.resolved.signer.signTransaction({
            networkId: params.networkId,
            nonce,
            operations: [params.operation],
          }),
        catch: (cause) =>
          new TransactionFailedError({
            message: "Failed to sign multisig transaction",
            cause,
          }),
      });
    }

    // 4. Submit
    const submitResult = yield* rpc.submitTransaction(envelope);

    // 5. Branch on result type
    const submitObj = (submitResult as { type?: string } | null) ?? null;
    if (submitObj?.type === "IncompleteMultiSig") {
      return {
        status: "incomplete-multisig",
        envelope,
        txHash: null,
        nonce,
      } satisfies TxPipelineIncomplete;
    }

    // 6. Success: compute hash
    const bcsInput = yield* Schema.encode(VersionedTransactionFromBcs)(
      envelope.transaction,
    ).pipe(
      Effect.mapError(
        (cause) =>
          new TransactionFailedError({
            message: "Failed to encode transaction for hashing",
            cause,
          }),
      ),
    );
    const txHash = yield* Effect.tryPromise({
      try: () => hashHex(bcsSchema.VersionedTransaction, bcsInput),
      catch: (cause) =>
        new TransactionFailedError({
          message: "Failed to compute transaction hash",
          cause,
        }),
    });

    return {
      status: "success",
      envelope,
      txHash,
      nonce,
    } satisfies TxPipelineSuccess;
  });
```

- [ ] **Step 4: Run test to verify PASS**

```bash
cd /home/yuqing/Documents/Code/fast-sdk/app/cli
pnpm exec vitest run tests/unit/tx-pipeline.test.ts
pnpm exec tsc --noEmit
```

Expected: 2/2 tests pass; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add app/cli/src/services/tx-pipeline.ts \
        app/cli/tests/unit/tx-pipeline.test.ts
git commit -m "feat(cli): submitOperation helper for polymorphic build+submit pipeline"
```

---

## Task 2: `fast token create` command

**Files:**

- Create: `app/cli/src/commands/token/index.ts`
- Create: `app/cli/src/commands/token/create.ts`
- Modify: `app/cli/src/cli.ts` — add `tokenCreateParser`, `tokenGroup`
- Modify: `app/cli/src/main.ts` — dispatch + `SUBCOMMANDS.token` entry + `SUBCOMMAND_REQUIREMENTS`
- Modify: `app/cli/src/commands/index.ts` — register

`fast token create --name <s> --decimals <n> --initial-supply <amt> [--minters <addr,...>] [--memo <s>]` deploys a new token. Active account becomes admin. Polymorphic on `--account` kind.

- [ ] **Step 1: Add parser**

In `app/cli/src/cli.ts`, alongside the existing parsers:

```ts
const tokenCreateParser = command(
  "create",
  object({
    cmd: constant("token-create" as const),
    name: option("--name", string({ metavar: "STRING" }), {
      description: message`Human-readable token name`,
    }),
    decimals: option("--decimals", integer({ metavar: "0-18" }), {
      description: message`Number of fractional digits (0-18)`,
    }),
    initialSupply: option("--initial-supply", string({ metavar: "AMOUNT" }), {
      description: message`Initial total supply (decimal; will be scaled by decimals)`,
    }),
    minters: optional(
      option("--minters", string({ metavar: "ADDR,..." }), {
        description: message`Comma-separated bech32 addresses authorized to mint`,
      }),
    ),
    memo: optional(
      option("--memo", string({ metavar: "STRING" }), {
        description: message`UserData memo (max 32 bytes UTF-8)`,
      }),
    ),
    asMember: optional(
      option("--as", string({ metavar: "NAME" }), {
        description: message`For multisig: which local member key signs`,
      }),
    ),
  }),
  { description: message`Create a new token` },
);
```

Add a `tokenGroup` parser that wraps the four token subcommands. After Task 5, the group will include all four; for Task 2 only, use a single-arg form to avoid the optique inference issue Phase 1 hit:

```ts
const tokenGroup = command(
  "token",
  tokenCreateParser,
  { description: message`Token operations` },
);
```

(Tasks 3–5 will switch this to `or(tokenCreateParser, tokenMintParser, ...)` once a second subcommand exists.)

Add `tokenGroup` to the top-level `or(...)` of subcommands. Export `TokenCreateArgs = InferValue<typeof tokenCreateParser>`.

- [ ] **Step 2: Implement command**

Create `app/cli/src/commands/token/index.ts`:

```ts
export { tokenCreate } from "./create.js";
```

Create `app/cli/src/commands/token/create.ts`:

```ts
import { fromFastAddress } from "@fastxyz/sdk";
import { Effect } from "effect";
import type { TokenCreateArgs } from "../../cli.js";
import {
  InvalidAddressError,
  InvalidAmountError,
} from "../../errors/index.js";
import { FastRpc } from "../../services/api/fast.js";
import { ClientConfig } from "../../services/config/client.js";
import { Output } from "../../services/output.js";
import { Prompt } from "../../services/prompt.js";
import { resolveSigner } from "../../services/signer-resolver.js";
import { AccountStore } from "../../services/storage/account.js";
import { NetworkConfigService } from "../../services/storage/network.js";
import { submitOperation } from "../../services/tx-pipeline.js";
import type { Command } from "../index.js";

const encodeMemo = (s: string | undefined): Uint8Array | null => {
  if (!s) return null;
  const bytes = new TextEncoder().encode(s);
  if (bytes.length > 32) {
    throw new InvalidAmountError({
      message: `--memo too long: ${bytes.length} bytes (max 32)`,
    });
  }
  const padded = new Uint8Array(32);
  padded.set(bytes, 0);
  return padded;
};

const parseAmount = (s: string, decimals: number): bigint => {
  const trimmed = s.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new InvalidAmountError({
      message: `--initial-supply not a non-negative decimal: "${s}"`,
    });
  }
  const [whole, frac = ""] = trimmed.split(".");
  if (frac.length > decimals) {
    throw new InvalidAmountError({
      message: `--initial-supply has more fractional digits (${frac.length}) than decimals (${decimals})`,
    });
  }
  const scaled = `${whole}${frac.padEnd(decimals, "0")}`;
  return BigInt(scaled);
};

export const tokenCreate: Command<TokenCreateArgs> = {
  cmd: "token-create",
  handler: (args) =>
    Effect.gen(function* () {
      const accounts = yield* AccountStore;
      const networks = yield* NetworkConfigService;
      const config = yield* ClientConfig;
      const output = yield* Output;
      const prompt = yield* Prompt;
      yield* FastRpc; // ensure provided

      // Validate decimals
      if (args.decimals < 0 || args.decimals > 18) {
        return yield* Effect.fail(
          new InvalidAmountError({
            message: `--decimals must be between 0 and 18 (got ${args.decimals})`,
          }),
        );
      }

      // Parse initial supply
      const initialSupply = yield* Effect.try({
        try: () => parseAmount(args.initialSupply, args.decimals),
        catch: (e) => e as InvalidAmountError,
      });

      // Parse minters list
      const minterEntries = (args.minters ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const minterBytes: Uint8Array[] = [];
      for (const m of minterEntries) {
        if (!m.startsWith("fast1")) {
          return yield* Effect.fail(
            new InvalidAddressError({
              message: `--minters entry "${m}" is not a bech32 fast1... address`,
            }),
          );
        }
        try {
          minterBytes.push(fromFastAddress(m));
        } catch (cause) {
          return yield* Effect.fail(
            new InvalidAddressError({
              message: `--minters entry "${m}" is not a valid bech32 address: ${cause instanceof Error ? cause.message : String(cause)}`,
            }),
          );
        }
      }

      // Encode memo
      const userData = yield* Effect.try({
        try: () => encodeMemo(args.memo),
        catch: (e) => e as InvalidAmountError,
      });

      // Resolve account + signer
      const accountInfo = yield* accounts.resolveAccount(config.account);
      const password =
        config.password ??
        (accountInfo.kind === "single" && !accountInfo.encrypted
          ? null
          : yield* prompt.password());
      const resolved = yield* resolveSigner({
        account: accountInfo,
        asMember: args.asMember,
        password,
      });

      const network = yield* networks.resolve(config.network);

      // Confirm if interactive
      if (!config.nonInteractive && !config.json) {
        yield* output.humanLine(`Create token "${args.name}"`);
        yield* output.humanLine(`  Decimals:       ${args.decimals}`);
        yield* output.humanLine(`  Initial supply: ${args.initialSupply}`);
        yield* output.humanLine(`  Minters:        ${minterEntries.length > 0 ? minterEntries.join(", ") : "(admin only)"}`);
        yield* output.humanLine(`  Admin:          ${accountInfo.fastAddress}`);
        const ok = yield* prompt.confirm("Confirm?");
        if (!ok) return;
      }

      const result = yield* submitOperation({
        resolved,
        networkId: network.networkId as never,
        operation: {
          type: "TokenCreation",
          value: {
            tokenName: args.name,
            decimals: args.decimals,
            initialAmount: initialSupply,
            mints: minterBytes,
            userData,
          } as never,
        },
      });

      if (result.status === "incomplete-multisig") {
        const quorum =
          resolved.kind === "multisig"
            ? resolved.account.multisigConfig.quorum
            : 1;
        yield* output.humanLine(
          `Submitted as multisig partial: 1/${quorum} signatures collected.`,
        );
        yield* output.humanLine(
          `Cosigners can run \`fast multisig pending\` to view, \`fast multisig vote\` to sign.`,
        );
        yield* output.ok({
          status: "incomplete-multisig",
          tokenName: args.name,
          wallet: accountInfo.name,
        });
        return;
      }

      yield* output.humanLine(`Created token "${args.name}".`);
      yield* output.humanLine(`  Transaction: ${result.txHash}`);
      yield* output.ok({
        status: "success",
        tokenName: args.name,
        decimals: args.decimals,
        initialSupply: args.initialSupply,
        txHash: result.txHash,
        admin: accountInfo.fastAddress,
      });
    }),
};
```

> Note on the new token id: the deterministic token id is computed as `keccak256(sender || nonce || opIndex)` per the SDK helper `getTokenId`. The CLI doesn't surface this in v1 — users find it via the network explorer or by inspecting `getTokenInfo` after submission. If a follow-up wants to print the new id, compute it from `result.envelope.transaction.value.{sender,nonce}` plus opIndex 0.

- [ ] **Step 3: Wire main.ts dispatch**

In `app/cli/src/main.ts`:

1. Add to imports:

   ```ts
   import { tokenCreate } from "./commands/token/index.js";
   ```

2. Add to the dispatch switch:

   ```ts
   case "token-create":
     return tokenCreate.handler(args);
   ```

3. Add to `SUBCOMMANDS`:

   ```ts
   token: ["create"],
   ```

4. Add to `SUBCOMMAND_REQUIREMENTS`:

   ```ts
   "token create": {
     usage: "fast token create --name <s> --decimals <n> --initial-supply <amt> [--minters <addr,...>] [--memo <s>] [--as <name>]",
     options: ["--name", "--decimals", "--initial-supply", "--minters", "--memo", "--as"],
   },
   ```

In `app/cli/src/commands/index.ts`, register:

```ts
import { tokenCreate } from "./token/index.js";
// ...
const commands = [..., tokenCreate];
```

- [ ] **Step 4: Verify**

```bash
cd /home/yuqing/Documents/Code/fast-sdk/app/cli
pnpm exec tsc --noEmit
pnpm exec vitest run
pnpm --filter @fastxyz/cli build 2>&1 | tail -3
node dist/main.js token create --help
```

Expected: zero tsc errors; tests pass; build succeeds; `--help` prints the parser description.

- [ ] **Step 5: Commit**

```bash
git add app/cli/src/commands/token/ \
        app/cli/src/cli.ts app/cli/src/main.ts \
        app/cli/src/commands/index.ts
git commit -m "feat(cli): token create command"
```

---

## Task 3: `fast token mint` command

**Files:**

- Create: `app/cli/src/commands/token/mint.ts`
- Modify: `app/cli/src/commands/token/index.ts`
- Modify: `app/cli/src/cli.ts` — add parser; switch `tokenGroup` to `or(...)`
- Modify: `app/cli/src/main.ts`
- Modify: `app/cli/src/commands/index.ts`

`fast token mint --token <id|name> --to <addr> --amount <n>` mints to a recipient. Active account must be in the token's authorized minters; the proxy enforces this so the CLI doesn't pre-validate.

- [ ] **Step 1: Add parser + switch tokenGroup to or(...)**

In `app/cli/src/cli.ts`:

```ts
const tokenMintParser = command(
  "mint",
  object({
    cmd: constant("token-mint" as const),
    token: option("--token", string({ metavar: "ID_OR_NAME" }), {
      description: message`Token id (hex, 64 chars, optional 0x) or registered token name`,
    }),
    to: option("--to", string({ metavar: "ADDR" }), {
      description: message`Bech32 fast1... recipient address`,
    }),
    amount: option("--amount", string({ metavar: "AMOUNT" }), {
      description: message`Decimal amount; scaled by the token's decimals`,
    }),
    asMember: optional(
      option("--as", string({ metavar: "NAME" }), {
        description: message`For multisig: which local member key signs`,
      }),
    ),
  }),
  { description: message`Mint tokens to a recipient (caller must be a minter)` },
);
```

Update the existing `tokenGroup` definition to use `or(...)` now that there are two subcommands:

```ts
const tokenGroup = command(
  "token",
  or(tokenCreateParser, tokenMintParser),
  { description: message`Token operations` },
);
```

Export `TokenMintArgs = InferValue<typeof tokenMintParser>`.

- [ ] **Step 2: Implement command**

Create `app/cli/src/commands/token/mint.ts`:

```ts
import { fromFastAddress, fromHex, toHex } from "@fastxyz/sdk";
import { Effect } from "effect";
import type { TokenMintArgs } from "../../cli.js";
import {
  InvalidAddressError,
  InvalidAmountError,
  TokenNotFoundError,
} from "../../errors/index.js";
import { FastRpc } from "../../services/api/fast.js";
import { ClientConfig } from "../../services/config/client.js";
import { Output } from "../../services/output.js";
import { Prompt } from "../../services/prompt.js";
import { resolveSigner } from "../../services/signer-resolver.js";
import { AccountStore } from "../../services/storage/account.js";
import { NetworkConfigService } from "../../services/storage/network.js";
import { resolveToken } from "../../services/token-resolver.js";
import { submitOperation } from "../../services/tx-pipeline.js";
import type { Command } from "../index.js";

const HEX_TOKEN_ID = /^(0x)?[0-9a-fA-F]{64}$/;

const parseAmount = (s: string, decimals: number): bigint => {
  const trimmed = s.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new InvalidAmountError({
      message: `--amount not a non-negative decimal: "${s}"`,
    });
  }
  const [whole, frac = ""] = trimmed.split(".");
  if (frac.length > decimals) {
    throw new InvalidAmountError({
      message: `--amount has more fractional digits (${frac.length}) than the token allows (${decimals})`,
    });
  }
  const scaled = `${whole}${frac.padEnd(decimals, "0")}`;
  return BigInt(scaled);
};

export const tokenMint: Command<TokenMintArgs> = {
  cmd: "token-mint",
  handler: (args) =>
    Effect.gen(function* () {
      const accounts = yield* AccountStore;
      const networks = yield* NetworkConfigService;
      const config = yield* ClientConfig;
      const output = yield* Output;
      const prompt = yield* Prompt;
      const rpc = yield* FastRpc;

      // Validate recipient
      if (!args.to.startsWith("fast1")) {
        return yield* Effect.fail(
          new InvalidAddressError({
            message: `--to "${args.to}" is not a bech32 fast1... address`,
          }),
        );
      }
      const recipientBytes = fromFastAddress(args.to);

      // Resolve token: hex id or registered name
      let tokenId: Uint8Array;
      let decimals: number;
      const network = yield* networks.resolve(config.network);
      if (HEX_TOKEN_ID.test(args.token)) {
        tokenId = fromHex(args.token);
        // Look up decimals via getTokenInfo (proxy round-trip).
        const info = (yield* rpc.getTokenInfo({
          tokenIds: [tokenId],
        } as never)) as unknown as {
          requestedTokenMetadata: ReadonlyArray<readonly [Uint8Array, { decimals: number } | null]>;
        };
        const found = info.requestedTokenMetadata?.[0];
        if (!found || !found[1]) {
          return yield* Effect.fail(
            new TokenNotFoundError({ token: args.token }),
          );
        }
        decimals = found[1].decimals;
      } else {
        // Try resolveToken (registered named token)
        const resolved = yield* Effect.try({
          try: () => resolveToken(args.token, network, undefined),
          catch: (e) => e as TokenNotFoundError,
        });
        tokenId = resolved.fastTokenId;
        decimals = resolved.decimals;
      }

      const amount = yield* Effect.try({
        try: () => parseAmount(args.amount, decimals),
        catch: (e) => e as InvalidAmountError,
      });

      const accountInfo = yield* accounts.resolveAccount(config.account);
      const password =
        config.password ??
        (accountInfo.kind === "single" && !accountInfo.encrypted
          ? null
          : yield* prompt.password());
      const resolved = yield* resolveSigner({
        account: accountInfo,
        asMember: args.asMember,
        password,
      });

      if (!config.nonInteractive && !config.json) {
        yield* output.humanLine(`Mint ${args.amount} of token ${toHex(tokenId)}`);
        yield* output.humanLine(`  To:     ${args.to}`);
        yield* output.humanLine(`  Minter: ${accountInfo.fastAddress}`);
        const ok = yield* prompt.confirm("Confirm?");
        if (!ok) return;
      }

      const result = yield* submitOperation({
        resolved,
        networkId: network.networkId as never,
        operation: {
          type: "Mint",
          value: {
            tokenId,
            recipient: recipientBytes,
            amount,
          } as never,
        },
      });

      if (result.status === "incomplete-multisig") {
        const quorum =
          resolved.kind === "multisig"
            ? resolved.account.multisigConfig.quorum
            : 1;
        yield* output.humanLine(
          `Submitted as multisig partial: 1/${quorum} signatures collected.`,
        );
        yield* output.ok({
          status: "incomplete-multisig",
          tokenId: toHex(tokenId),
          to: args.to,
          amount: args.amount,
          wallet: accountInfo.name,
        });
        return;
      }

      yield* output.humanLine(`Minted ${args.amount}.`);
      yield* output.humanLine(`  Transaction: ${result.txHash}`);
      yield* output.ok({
        status: "success",
        tokenId: toHex(tokenId),
        to: args.to,
        amount: args.amount,
        txHash: result.txHash,
      });
    }),
};
```

Update `app/cli/src/commands/token/index.ts`:

```ts
export { tokenCreate } from "./create.js";
export { tokenMint } from "./mint.js";
```

- [ ] **Step 3: Wire main.ts and registry**

`app/cli/src/main.ts`:

- Import `tokenMint`.
- Add `case "token-mint": return tokenMint.handler(args);`
- Update `SUBCOMMANDS.token` to `["create", "mint"]`.
- Add `SUBCOMMAND_REQUIREMENTS["token mint"] = { usage: "...", options: ["--token", "--to", "--amount", "--as"] }`.

`app/cli/src/commands/index.ts`: register `tokenMint`.

- [ ] **Step 4: Verify**

```bash
cd /home/yuqing/Documents/Code/fast-sdk/app/cli
pnpm exec tsc --noEmit
pnpm exec vitest run
pnpm --filter @fastxyz/cli build 2>&1 | tail -3
node dist/main.js token mint --help
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add app/cli/src/commands/token/mint.ts \
        app/cli/src/commands/token/index.ts \
        app/cli/src/cli.ts app/cli/src/main.ts \
        app/cli/src/commands/index.ts
git commit -m "feat(cli): token mint command"
```

---

## Task 4: `fast token burn` command

**Files:**

- Create: `app/cli/src/commands/token/burn.ts`
- Modify: `app/cli/src/commands/token/index.ts`
- Modify: `app/cli/src/cli.ts` — add parser; extend `tokenGroup` `or(...)`
- Modify: `app/cli/src/main.ts`
- Modify: `app/cli/src/commands/index.ts`

`fast token burn --token <id|name> --amount <n>` burns from the active account's holdings.

- [ ] **Step 1: Add parser**

```ts
const tokenBurnParser = command(
  "burn",
  object({
    cmd: constant("token-burn" as const),
    token: option("--token", string({ metavar: "ID_OR_NAME" }), {
      description: message`Token id (hex, 64 chars, optional 0x) or registered token name`,
    }),
    amount: option("--amount", string({ metavar: "AMOUNT" }), {
      description: message`Decimal amount; scaled by the token's decimals`,
    }),
    asMember: optional(
      option("--as", string({ metavar: "NAME" }), {
        description: message`For multisig: which local member key signs`,
      }),
    ),
  }),
  { description: message`Burn tokens from the active account's balance` },
);

const tokenGroup = command(
  "token",
  or(tokenCreateParser, tokenMintParser, tokenBurnParser),
  { description: message`Token operations` },
);
```

Export `TokenBurnArgs = InferValue<typeof tokenBurnParser>`.

- [ ] **Step 2: Implement command**

Create `app/cli/src/commands/token/burn.ts`:

```ts
import { fromHex, toHex } from "@fastxyz/sdk";
import { Effect } from "effect";
import type { TokenBurnArgs } from "../../cli.js";
import {
  InvalidAmountError,
  TokenNotFoundError,
} from "../../errors/index.js";
import { FastRpc } from "../../services/api/fast.js";
import { ClientConfig } from "../../services/config/client.js";
import { Output } from "../../services/output.js";
import { Prompt } from "../../services/prompt.js";
import { resolveSigner } from "../../services/signer-resolver.js";
import { AccountStore } from "../../services/storage/account.js";
import { NetworkConfigService } from "../../services/storage/network.js";
import { resolveToken } from "../../services/token-resolver.js";
import { submitOperation } from "../../services/tx-pipeline.js";
import type { Command } from "../index.js";

const HEX_TOKEN_ID = /^(0x)?[0-9a-fA-F]{64}$/;

const parseAmount = (s: string, decimals: number): bigint => {
  const trimmed = s.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new InvalidAmountError({
      message: `--amount not a non-negative decimal: "${s}"`,
    });
  }
  const [whole, frac = ""] = trimmed.split(".");
  if (frac.length > decimals) {
    throw new InvalidAmountError({
      message: `--amount has more fractional digits (${frac.length}) than the token allows (${decimals})`,
    });
  }
  const scaled = `${whole}${frac.padEnd(decimals, "0")}`;
  return BigInt(scaled);
};

export const tokenBurn: Command<TokenBurnArgs> = {
  cmd: "token-burn",
  handler: (args) =>
    Effect.gen(function* () {
      const accounts = yield* AccountStore;
      const networks = yield* NetworkConfigService;
      const config = yield* ClientConfig;
      const output = yield* Output;
      const prompt = yield* Prompt;
      const rpc = yield* FastRpc;

      const network = yield* networks.resolve(config.network);

      let tokenId: Uint8Array;
      let decimals: number;
      if (HEX_TOKEN_ID.test(args.token)) {
        tokenId = fromHex(args.token);
        const info = (yield* rpc.getTokenInfo({
          tokenIds: [tokenId],
        } as never)) as unknown as {
          requestedTokenMetadata: ReadonlyArray<readonly [Uint8Array, { decimals: number } | null]>;
        };
        const found = info.requestedTokenMetadata?.[0];
        if (!found || !found[1]) {
          return yield* Effect.fail(
            new TokenNotFoundError({ token: args.token }),
          );
        }
        decimals = found[1].decimals;
      } else {
        const resolved = yield* Effect.try({
          try: () => resolveToken(args.token, network, undefined),
          catch: (e) => e as TokenNotFoundError,
        });
        tokenId = resolved.fastTokenId;
        decimals = resolved.decimals;
      }

      const amount = yield* Effect.try({
        try: () => parseAmount(args.amount, decimals),
        catch: (e) => e as InvalidAmountError,
      });

      const accountInfo = yield* accounts.resolveAccount(config.account);
      const password =
        config.password ??
        (accountInfo.kind === "single" && !accountInfo.encrypted
          ? null
          : yield* prompt.password());
      const resolved = yield* resolveSigner({
        account: accountInfo,
        asMember: args.asMember,
        password,
      });

      if (!config.nonInteractive && !config.json) {
        yield* output.humanLine(`Burn ${args.amount} of token ${toHex(tokenId)}`);
        yield* output.humanLine(`  From: ${accountInfo.fastAddress}`);
        const ok = yield* prompt.confirm("Confirm?");
        if (!ok) return;
      }

      const result = yield* submitOperation({
        resolved,
        networkId: network.networkId as never,
        operation: {
          type: "Burn",
          value: {
            tokenId,
            amount,
          } as never,
        },
      });

      if (result.status === "incomplete-multisig") {
        const quorum =
          resolved.kind === "multisig"
            ? resolved.account.multisigConfig.quorum
            : 1;
        yield* output.humanLine(
          `Submitted as multisig partial: 1/${quorum} signatures collected.`,
        );
        yield* output.ok({
          status: "incomplete-multisig",
          tokenId: toHex(tokenId),
          amount: args.amount,
          wallet: accountInfo.name,
        });
        return;
      }

      yield* output.humanLine(`Burned ${args.amount}.`);
      yield* output.humanLine(`  Transaction: ${result.txHash}`);
      yield* output.ok({
        status: "success",
        tokenId: toHex(tokenId),
        amount: args.amount,
        txHash: result.txHash,
      });
    }),
};
```

Update `app/cli/src/commands/token/index.ts`:

```ts
export { tokenBurn } from "./burn.js";
export { tokenCreate } from "./create.js";
export { tokenMint } from "./mint.js";
```

- [ ] **Step 3: Wire main.ts and registry**

Same shape as Task 3:

- Import `tokenBurn`.
- Add dispatch case `"token-burn"`.
- `SUBCOMMANDS.token = ["create", "mint", "burn"]`.
- `SUBCOMMAND_REQUIREMENTS["token burn"] = { usage: "...", options: ["--token", "--amount", "--as"] }`.
- Register in `commands/index.ts`.

- [ ] **Step 4: Verify**

```bash
cd /home/yuqing/Documents/Code/fast-sdk/app/cli
pnpm exec tsc --noEmit
pnpm exec vitest run
pnpm --filter @fastxyz/cli build 2>&1 | tail -3
node dist/main.js token burn --help
```

- [ ] **Step 5: Commit**

```bash
git add app/cli/src/commands/token/burn.ts \
        app/cli/src/commands/token/index.ts \
        app/cli/src/cli.ts app/cli/src/main.ts \
        app/cli/src/commands/index.ts
git commit -m "feat(cli): token burn command"
```

---

## Task 5: `fast token manage` command

**Files:**

- Create: `app/cli/src/commands/token/manage.ts`
- Modify: `app/cli/src/commands/token/index.ts`
- Modify: `app/cli/src/cli.ts` — add parser; extend `tokenGroup` `or(...)`
- Modify: `app/cli/src/main.ts`
- Modify: `app/cli/src/commands/index.ts`

`fast token manage --token <id|name> [--admin <addr>] [--add-minters <addr,...>] [--remove-minters <addr,...>] [--memo <s>]` updates token admin and/or minters. At least one of `--admin / --add-minters / --remove-minters` is required. Active account must be the current admin (proxy enforces).

The `TokenManagement` BCS layout includes an `update_id` field — the per-token admin nonce. The CLI fetches the token's **current** `updateId` via `getTokenInfo` and submits that value verbatim. The validator increments after settlement (confirmed against the Rust reference CLI and validator unit tests). Submitting `current + 1` is rejected.

- [ ] **Step 1: Add parser**

```ts
const tokenManageParser = command(
  "manage",
  object({
    cmd: constant("token-manage" as const),
    token: option("--token", string({ metavar: "ID_OR_NAME" }), {
      description: message`Token id (hex, 64 chars, optional 0x) or registered token name`,
    }),
    admin: optional(
      option("--admin", string({ metavar: "ADDR" }), {
        description: message`Transfer admin to this bech32 fast1... address`,
      }),
    ),
    addMinters: optional(
      option("--add-minters", string({ metavar: "ADDR,..." }), {
        description: message`Comma-separated minter addresses to add`,
      }),
    ),
    removeMinters: optional(
      option("--remove-minters", string({ metavar: "ADDR,..." }), {
        description: message`Comma-separated minter addresses to remove`,
      }),
    ),
    memo: optional(
      option("--memo", string({ metavar: "STRING" }), {
        description: message`UserData memo (max 32 bytes UTF-8)`,
      }),
    ),
    asMember: optional(
      option("--as", string({ metavar: "NAME" }), {
        description: message`For multisig: which local member key signs`,
      }),
    ),
  }),
  {
    description: message`Update a token's admin or minters (caller must be current admin)`,
  },
);

const tokenGroup = command(
  "token",
  or(tokenCreateParser, tokenMintParser, tokenBurnParser, tokenManageParser),
  { description: message`Token operations` },
);
```

Export `TokenManageArgs = InferValue<typeof tokenManageParser>`.

- [ ] **Step 2: Implement command**

Create `app/cli/src/commands/token/manage.ts`:

```ts
import { fromFastAddress, fromHex, toHex } from "@fastxyz/sdk";
import { Effect } from "effect";
import type { TokenManageArgs } from "../../cli.js";
import {
  InvalidAddressError,
  InvalidUsageError,
  TokenNotFoundError,
} from "../../errors/index.js";
import { FastRpc } from "../../services/api/fast.js";
import { ClientConfig } from "../../services/config/client.js";
import { Output } from "../../services/output.js";
import { Prompt } from "../../services/prompt.js";
import { resolveSigner } from "../../services/signer-resolver.js";
import { AccountStore } from "../../services/storage/account.js";
import { NetworkConfigService } from "../../services/storage/network.js";
import { resolveToken } from "../../services/token-resolver.js";
import { submitOperation } from "../../services/tx-pipeline.js";
import type { Command } from "../index.js";

const HEX_TOKEN_ID = /^(0x)?[0-9a-fA-F]{64}$/;

const splitAddrs = (csv: string | undefined): string[] =>
  (csv ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

const encodeMemo = (s: string | undefined): Uint8Array | null => {
  if (!s) return null;
  const bytes = new TextEncoder().encode(s);
  if (bytes.length > 32) {
    throw new InvalidUsageError({
      message: `--memo too long: ${bytes.length} bytes (max 32)`,
    });
  }
  const padded = new Uint8Array(32);
  padded.set(bytes, 0);
  return padded;
};

const parseAddr = (addr: string, label: string): Uint8Array => {
  if (!addr.startsWith("fast1")) {
    throw new InvalidAddressError({
      message: `${label} "${addr}" is not a bech32 fast1... address`,
    });
  }
  return fromFastAddress(addr);
};

export const tokenManage: Command<TokenManageArgs> = {
  cmd: "token-manage",
  handler: (args) =>
    Effect.gen(function* () {
      // Require at least one change
      if (
        args.admin === undefined &&
        args.addMinters === undefined &&
        args.removeMinters === undefined
      ) {
        return yield* Effect.fail(
          new InvalidUsageError({
            message:
              "At least one of --admin, --add-minters, --remove-minters must be provided",
          }),
        );
      }

      const accounts = yield* AccountStore;
      const networks = yield* NetworkConfigService;
      const config = yield* ClientConfig;
      const output = yield* Output;
      const prompt = yield* Prompt;
      const rpc = yield* FastRpc;

      const network = yield* networks.resolve(config.network);

      // Resolve token
      let tokenId: Uint8Array;
      if (HEX_TOKEN_ID.test(args.token)) {
        tokenId = fromHex(args.token);
      } else {
        const resolved = yield* Effect.try({
          try: () => resolveToken(args.token, network, undefined),
          catch: (e) => e as TokenNotFoundError,
        });
        tokenId = resolved.fastTokenId;
      }

      // Fetch current metadata for updateId
      const info = (yield* rpc.getTokenInfo({
        tokenIds: [tokenId],
      } as never)) as unknown as {
        requestedTokenMetadata: ReadonlyArray<
          readonly [Uint8Array, { updateId: bigint } | null]
        >;
      };
      const found = info.requestedTokenMetadata?.[0];
      if (!found || !found[1]) {
        return yield* Effect.fail(
          new TokenNotFoundError({ token: args.token }),
        );
      }
      const currentUpdateId = found[1].updateId;

      // Build mints array
      const mintsChange: Array<readonly [{ type: "Add" | "Remove" }, Uint8Array]> = [];
      for (const addr of splitAddrs(args.addMinters)) {
        const bytes = yield* Effect.try({
          try: () => parseAddr(addr, "--add-minters entry"),
          catch: (e) => e as InvalidAddressError,
        });
        mintsChange.push([{ type: "Add" }, bytes]);
      }
      for (const addr of splitAddrs(args.removeMinters)) {
        const bytes = yield* Effect.try({
          try: () => parseAddr(addr, "--remove-minters entry"),
          catch: (e) => e as InvalidAddressError,
        });
        mintsChange.push([{ type: "Remove" }, bytes]);
      }

      // newAdmin: null = no change; otherwise parse the address
      const newAdmin =
        args.admin === undefined
          ? null
          : yield* Effect.try({
              try: () => parseAddr(args.admin!, "--admin"),
              catch: (e) => e as InvalidAddressError,
            });

      const userData = yield* Effect.try({
        try: () => encodeMemo(args.memo),
        catch: (e) => e as InvalidUsageError,
      });

      const accountInfo = yield* accounts.resolveAccount(config.account);
      const password =
        config.password ??
        (accountInfo.kind === "single" && !accountInfo.encrypted
          ? null
          : yield* prompt.password());
      const resolved = yield* resolveSigner({
        account: accountInfo,
        asMember: args.asMember,
        password,
      });

      if (!config.nonInteractive && !config.json) {
        yield* output.humanLine(`Manage token ${toHex(tokenId)}`);
        yield* output.humanLine(`  Caller (admin): ${accountInfo.fastAddress}`);
        if (args.admin) yield* output.humanLine(`  New admin:      ${args.admin}`);
        if (args.addMinters)
          yield* output.humanLine(`  Add minters:    ${args.addMinters}`);
        if (args.removeMinters)
          yield* output.humanLine(`  Remove minters: ${args.removeMinters}`);
        const ok = yield* prompt.confirm("Confirm?");
        if (!ok) return;
      }

      const result = yield* submitOperation({
        resolved,
        networkId: network.networkId as never,
        operation: {
          type: "TokenManagement",
          value: {
            tokenId,
            updateId: currentUpdateId,
            newAdmin,
            mints: mintsChange,
            userData,
          } as never,
        },
      });

      if (result.status === "incomplete-multisig") {
        const quorum =
          resolved.kind === "multisig"
            ? resolved.account.multisigConfig.quorum
            : 1;
        yield* output.humanLine(
          `Submitted as multisig partial: 1/${quorum} signatures collected.`,
        );
        yield* output.ok({
          status: "incomplete-multisig",
          tokenId: toHex(tokenId),
          updateId: currentUpdateId.toString(),
          wallet: accountInfo.name,
        });
        return;
      }

      yield* output.humanLine(`Token managed.`);
      yield* output.humanLine(`  Transaction: ${result.txHash}`);
      yield* output.ok({
        status: "success",
        tokenId: toHex(tokenId),
        updateId: currentUpdateId.toString(),
        newAdmin: args.admin ?? null,
        addMinters: splitAddrs(args.addMinters),
        removeMinters: splitAddrs(args.removeMinters),
        txHash: result.txHash,
      });
    }),
};
```

Update `app/cli/src/commands/token/index.ts`:

```ts
export { tokenBurn } from "./burn.js";
export { tokenCreate } from "./create.js";
export { tokenManage } from "./manage.js";
export { tokenMint } from "./mint.js";
```

- [ ] **Step 3: Wire main.ts and registry**

- Import `tokenManage`.
- Add dispatch case `"token-manage"`.
- `SUBCOMMANDS.token = ["create", "mint", "burn", "manage"]`.
- `SUBCOMMAND_REQUIREMENTS["token manage"] = { usage: "...", options: ["--token", "--admin", "--add-minters", "--remove-minters", "--memo", "--as"] }`.
- Register in `commands/index.ts`.

- [ ] **Step 4: Verify**

```bash
cd /home/yuqing/Documents/Code/fast-sdk/app/cli
pnpm exec tsc --noEmit
pnpm exec vitest run
pnpm --filter @fastxyz/cli build 2>&1 | tail -3
node dist/main.js token --help
node dist/main.js token manage --help
```

Expected: `token --help` lists all 4 subcommands; each subcommand's `--help` renders.

- [ ] **Step 5: Commit**

```bash
git add app/cli/src/commands/token/manage.ts \
        app/cli/src/commands/token/index.ts \
        app/cli/src/cli.ts app/cli/src/main.ts \
        app/cli/src/commands/index.ts
git commit -m "feat(cli): token manage command"
```

---

## Task 6: Integration test for token operations

**Files:**

- Create: `app/cli/tests/integration/token-operations.test.ts`

End-to-end test stubbing `FastRpc.submitTransaction` and `getTokenInfo` to verify the four token commands' service-level flow works for both single-signer and multisig accounts. Mirrors the pattern from `tests/integration/multisig-happy-path.test.ts`.

- [ ] **Step 1: Write the test**

Create `app/cli/tests/integration/token-operations.test.ts`. Reference [multisig-happy-path.test.ts](../../app/cli/tests/integration/multisig-happy-path.test.ts) for the layer pattern (in-memory SQLite + drizzle migrate + AccountStore + stubbed FastRpc).

The test exercises `submitOperation` directly (not the full command handlers, which would require Output/Prompt/ClientConfig wiring beyond the test's value). Each case:

```ts
import { describe, expect, it } from "vitest";
import { Effect, Layer, Ref } from "effect";
import Db from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { Signer, fromFastAddress } from "@fastxyz/sdk";
import { AccountStore } from "../../src/services/storage/account";
import { DatabaseService } from "../../src/services/storage/database";
import { resolveSigner } from "../../src/services/signer-resolver";
import { submitOperation } from "../../src/services/tx-pipeline";
import { FastRpc } from "../../src/services/api/fast";

const SEED = (b: number) => new Uint8Array(32).fill(b);

interface RpcState {
  pendingMultisig: Map<string, { partialCount: number; quorum: number }>;
  submittedSuccess: number;
}

const makeDbLayer = () => {
  const dir = mkdtempSync(join(tmpdir(), "fast-cli-token-test-"));
  const dbPath = join(dir, "fast.db");
  const sqlite = new Db(dbPath);
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: join(__dirname, "../../drizzle") });
  return Layer.succeed(DatabaseService, {
    query: <A>(fn: (db: typeof db) => A, _msg: string) =>
      Effect.sync(() => fn(db)),
  } as never);
};

const makeRpcLayer = (state: Ref.Ref<RpcState>, quorum = 1) =>
  Layer.succeed(
    FastRpc,
    {
      getAccountInfo: (_p: unknown) =>
        Effect.succeed({ nextNonce: 0n }) as never,
      getTokenInfo: (_p: unknown) =>
        Effect.succeed({
          requestedTokenMetadata: [
            [
              new Uint8Array(32).fill(0xee),
              { updateId: 0n, decimals: 6, admin: new Uint8Array(32), tokenName: "TEST", totalSupply: 0n, mints: [] },
            ],
          ],
        }) as never,
      submitTransaction: (envelope: unknown) =>
        Effect.gen(function* () {
          const env = envelope as { signature: { type: string; value?: { signatures?: unknown[] } } };
          if (env.signature.type === "Signature") {
            yield* Ref.update(state, (s) => ({
              ...s,
              submittedSuccess: s.submittedSuccess + 1,
            }));
            return { type: "Success", certificate: { stub: true } } as never;
          }
          // MultiSig: track quorum
          if (quorum > 1) {
            return { type: "IncompleteMultiSig" } as never;
          }
          yield* Ref.update(state, (s) => ({
            ...s,
            submittedSuccess: s.submittedSuccess + 1,
          }));
          return { type: "Success", certificate: { stub: true } } as never;
        }) as never,
      getPendingMultisigTransactions: (_p: unknown) =>
        Effect.succeed([]) as never,
      getTransactionCertificates: (_p: unknown) =>
        Effect.succeed([]) as never,
      getRpcUrl: () => Effect.succeed("http://test"),
    } as unknown as never,
  );

describe("token operations end-to-end (service-level)", () => {
  it("single-signer create → submitOperation returns Success", async () => {
    const stateRef = await Effect.runPromise(
      Ref.make<RpcState>({ pendingMultisig: new Map(), submittedSuccess: 0 }),
    );
    const layer = Layer.merge(
      makeDbLayer(),
      Layer.merge(makeRpcLayer(stateRef, 1), AccountStore.Default),
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const accounts = yield* AccountStore;
        yield* accounts.create("alice", SEED(0xaa), null);
        const alice = yield* accounts.get("alice");
        const resolved = yield* resolveSigner({
          account: alice,
          password: null,
        });
        return yield* submitOperation({
          resolved,
          networkId: "fast:testnet",
          operation: {
            type: "TokenCreation",
            value: {
              tokenName: "TEST",
              decimals: 6,
              initialAmount: 1000000n,
              mints: [],
              userData: null,
            } as never,
          },
        });
      }).pipe(Effect.provide(layer)),
    );

    expect(result.status).toBe("success");
    expect(result.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    const final = await Effect.runPromise(Ref.get(stateRef));
    expect(final.submittedSuccess).toBe(1);
  });

  it("multisig (quorum=2) create → submitOperation returns incomplete-multisig", async () => {
    const stateRef = await Effect.runPromise(
      Ref.make<RpcState>({ pendingMultisig: new Map(), submittedSuccess: 0 }),
    );
    const layer = Layer.merge(
      makeDbLayer(),
      Layer.merge(makeRpcLayer(stateRef, 2), AccountStore.Default),
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const accounts = yield* AccountStore;
        yield* accounts.create("alice", SEED(0xaa), null);
        yield* accounts.create("bob", SEED(0xbb), null);
        const aliceFast = (yield* accounts.get("alice")).fastAddress;
        const bobFast = (yield* accounts.get("bob")).fastAddress;
        const sortedSigners = [aliceFast, bobFast].sort();
        const { deriveMultiSigAddress } = await import("@fastxyz/sdk");
        const fastAddress = await deriveMultiSigAddress({
          authorized_signers: sortedSigners.map((s) => fromFastAddress(s)),
          quorum: 2n,
          nonce: 0n,
        });
        yield* accounts.createMultiSig(
          {
            version: 1,
            name: "treasury",
            signers: sortedSigners,
            quorum: 2,
            configNonce: "0",
            fastAddress,
            network: "testnet",
          },
          true,
        );
        const treasury = yield* accounts.get("treasury");
        const resolved = yield* resolveSigner({
          account: treasury,
          asMember: "alice",
          password: null,
        });
        return yield* submitOperation({
          resolved,
          networkId: "fast:testnet",
          operation: {
            type: "Mint",
            value: {
              tokenId: new Uint8Array(32).fill(0xee),
              recipient: new Uint8Array(32).fill(0xff),
              amount: 100n,
            } as never,
          },
        });
      }).pipe(Effect.provide(layer)),
    );

    expect(result.status).toBe("incomplete-multisig");
    expect(result.txHash).toBeNull();
  });

  it("burn op routes through pipeline (single-signer)", async () => {
    const stateRef = await Effect.runPromise(
      Ref.make<RpcState>({ pendingMultisig: new Map(), submittedSuccess: 0 }),
    );
    const layer = Layer.merge(
      makeDbLayer(),
      Layer.merge(makeRpcLayer(stateRef, 1), AccountStore.Default),
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const accounts = yield* AccountStore;
        yield* accounts.create("alice", SEED(0xaa), null);
        const alice = yield* accounts.get("alice");
        const resolved = yield* resolveSigner({
          account: alice,
          password: null,
        });
        return yield* submitOperation({
          resolved,
          networkId: "fast:testnet",
          operation: {
            type: "Burn",
            value: {
              tokenId: new Uint8Array(32).fill(0xee),
              amount: 50n,
            } as never,
          },
        });
      }).pipe(Effect.provide(layer)),
    );

    expect(result.status).toBe("success");
  });

  it("manage op routes through pipeline (single-signer)", async () => {
    const stateRef = await Effect.runPromise(
      Ref.make<RpcState>({ pendingMultisig: new Map(), submittedSuccess: 0 }),
    );
    const layer = Layer.merge(
      makeDbLayer(),
      Layer.merge(makeRpcLayer(stateRef, 1), AccountStore.Default),
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const accounts = yield* AccountStore;
        yield* accounts.create("alice", SEED(0xaa), null);
        const alice = yield* accounts.get("alice");
        const resolved = yield* resolveSigner({
          account: alice,
          password: null,
        });
        return yield* submitOperation({
          resolved,
          networkId: "fast:testnet",
          operation: {
            type: "TokenManagement",
            value: {
              tokenId: new Uint8Array(32).fill(0xee),
              updateId: 1n,
              newAdmin: null,
              mints: [],
              userData: null,
            } as never,
          },
        });
      }).pipe(Effect.provide(layer)),
    );

    expect(result.status).toBe("success");
  });
});
```

The shapes used in the operations (`as never` casts) sidestep the same brand-vs-input-shape friction Phase 1 hit; the runtime values are correct.

- [ ] **Step 2: Run the test**

```bash
cd /home/yuqing/Documents/Code/fast-sdk/app/cli
pnpm exec vitest run tests/integration/token-operations.test.ts
```

Expected: 4/4 tests pass.

- [ ] **Step 3: Run full suite + final verification**

```bash
cd /home/yuqing/Documents/Code/fast-sdk/app/cli
pnpm exec vitest run
pnpm exec tsc --noEmit
cd /home/yuqing/Documents/Code/fast-sdk
pnpm test 2>&1 | tail -10
pnpm --filter @fastxyz/cli build 2>&1 | tail -3
node app/cli/dist/main.js token --help
node app/cli/dist/main.js token create --help
node app/cli/dist/main.js token mint --help
node app/cli/dist/main.js token burn --help
node app/cli/dist/main.js token manage --help
```

Expected: full test suite green, tsc clean, build clean, all `--help` outputs render.

- [ ] **Step 4: Commit**

```bash
git add app/cli/tests/integration/token-operations.test.ts
git commit -m "test(cli): integration tests for token operations"
```

---

## Done

At this point Phase 2 is complete:

- `fast token create / mint / burn / manage` work for both single-signer and multisig accounts
- `submitOperation` extracted as the canonical build-and-submit pipeline; future operations plug in trivially
- Integration coverage for all four token operations across both account kinds

**Combined with Phase 1**, the multisig CLI now has full functional parity with the Rust `fastset-multisig-cli`:

- Account & keystore management ✓
- Multisig wallet config (init, import, export) ✓
- Transaction initiation: transfer (`send`), token-create, mint, burn, token-manage ✓
- Co-signing flow (`pending`, `vote`) ✓
- Balance queries (existing `info balance`) ✓
- Aliases not implemented (deliberately out of scope per spec)

**Out of scope (deferred to future phases or follow-ups):**

- The Phase 1 final-review tech debt items (rename SDK error class, type FastRpc returns, promise-cache `ensureValid`, validate `multisigConfig` on read, etc.)
- Printing the new token id in `token create` output (requires computing `getTokenId(sender, nonce, opIndex)` from the envelope)
- Pre-flight admin/minter authorization checks for `mint`/`manage` (currently relies on proxy rejection)
