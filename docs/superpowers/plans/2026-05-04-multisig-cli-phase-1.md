# Multisig CLI — Phase 1 (Backbone) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multisig support to fast-cli + fast-sdk: a `MultiSigSigner`
abstraction in the SDK; a tagged-union accounts table plus `multisig
init/import/export/pending/vote` commands and polymorphic `send` in the CLI.

**Architecture:** SDK gains `MultiSigSigner` (symmetric to `Signer`) plus a
`deriveMultiSigAddress` helper. CLI gains a unified `accounts` row that
discriminates `kind: 'single' | 'multisig'`, a `signer-resolver` service
that returns either kind, and a multisig command group. `send` dispatches
on account kind. End state: end-to-end usable N-of-M wallet for transfers.

**Tech Stack:** TypeScript, Effect, Drizzle (SQLite), `@optique/core`,
`@noble/ed25519`, `@noble/hashes`, BCS via `@mysten/bcs`. Test runner: vitest.

**Spec:** [docs/superpowers/specs/2026-05-04-multisig-in-fast-cli-design.md](../specs/2026-05-04-multisig-in-fast-cli-design.md).

**Phase 2** (token operations) is a separate plan; this plan deliberately
excludes `fast token create/mint/burn/manage`.

## Preconditions

- Branch `feat/multisig-cli` is based on `origin/main`.
- The fast-sdk dts build on `main` currently fails on
  `src/core/crypto/envelope.ts` (pre-existing, expected to land via the
  canonical-LatestTransaction refactor on `refactor/canonical-latest-transaction`).
  Before implementing, confirm `pnpm --filter @fastxyz/sdk build` succeeds
  — if not, rebase this branch onto a commit where it does (typically
  after the canonical-tx refactor merges).

## Conventions used by every task

- **Run a single test file:** from inside the package directory, e.g.
  `cd packages/fast-sdk && pnpm exec vitest run tests/unit/multisig-signer.test.ts`.
- **Build before testing:** dependent packages must be built first.
  `pnpm build` at the repo root, or
  `pnpm --filter @fastxyz/schema --filter @fastxyz/sdk build` for the SDK chain.
- **Error classes** use Effect's tagged-error pattern — extend
  `Data.TaggedError("Name")<{...}>` and provide `exitCode`, `errorCode`,
  and a `message` getter (see [app/cli/src/errors/account.ts](../../app/cli/src/errors/account.ts)).
- **Commit cadence:** one commit per task. Commit messages follow the
  conventional style used in this repo (e.g. `feat(fast-sdk): add
  MultiSigSigner`, `feat(cli): multisig init command`).

---

## Task 1: SDK — derive multisig address helpers

**Files:**

- Create: `packages/fast-sdk/src/interface/multisig-signer.ts`
- Create: `packages/fast-sdk/tests/unit/multisig-signer.test.ts`
- Create: `packages/fast-sdk/tests/unit/fixtures/multisig-addresses.json`

The Rust reference (from `fastset-rust-sdk/src/base_types.rs:789`):

```rust
pub fn address(&self) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    let mut buf = vec![];
    bcs::serialize_into(&mut buf, &self).expect("...");
    hasher.update(buf);
    hasher.finalize().into()
}
```

In TS: BCS-encode `MultiSigConfig` then keccak-256. The existing
`hash` helper in [packages/fast-sdk/src/core/crypto/bcs.ts:24](../../packages/fast-sdk/src/core/crypto/bcs.ts#L24)
does exactly this.

- [ ] **Step 1: Add a fixture file**

Create `packages/fast-sdk/tests/unit/fixtures/multisig-addresses.json`
with one entry. Generate a single ground-truth vector using the Rust
tool (or compute by hand via `bcs::serialize`+keccak256 in any working
environment), and paste the result. Use this fixture:

```json
[
  {
    "comment": "2-of-2, all-zero pubkeys, nonce=0 — deterministic baseline",
    "config": {
      "authorized_signers": [
        "0000000000000000000000000000000000000000000000000000000000000000",
        "0101010101010101010101010101010101010101010101010101010101010101"
      ],
      "quorum": "2",
      "nonce": "0"
    },
    "expectedAddressHex": "REPLACE_WITH_KECCAK256(BCS_ENCODE(config))"
  }
]
```

If running the Rust tool to generate the vector is impractical, compute
the expected hex by:

```bash
# In any rust environment with fastset-rust-sdk available:
cargo run --example multisig_address -- \
  --signers 0x000...,0x010101... --quorum 2 --nonce 0
```

Or compute purely in TS at REPL using the existing `hash` from
`@fastxyz/sdk`:

```ts
import { hash, toHex } from "@fastxyz/sdk";
import { bcsSchema } from "@fastxyz/schema";
import { Effect } from "effect";
const config = {
  authorized_signers: [new Uint8Array(32).fill(0), new Uint8Array(32).fill(1)],
  quorum: 2n,
  nonce: 0n,
};
const bytes = await Effect.runPromise(hash(bcsSchema.MultiSigConfig, config));
console.log(toHex(bytes));
```

Take whichever output matches the spec for that input and pin it into
the JSON. (Implementer may need to do this once during Step 3 and then
freeze.)

- [ ] **Step 2: Write the failing test**

Create `packages/fast-sdk/tests/unit/multisig-signer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fromHex, toHex } from "../../src/index";
import {
  deriveMultiSigAddress,
  deriveMultiSigAddressBytes,
} from "../../src/interface/multisig-signer";

const fixtures = JSON.parse(
  readFileSync(
    join(__dirname, "fixtures/multisig-addresses.json"),
    "utf8",
  ),
) as Array<{
  comment: string;
  config: {
    authorized_signers: string[];
    quorum: string;
    nonce: string;
  };
  expectedAddressHex: string;
}>;

describe("deriveMultiSigAddress", () => {
  for (const f of fixtures) {
    it(`matches Rust derivation: ${f.comment}`, async () => {
      const config = {
        authorized_signers: f.config.authorized_signers.map((s) =>
          fromHex(s),
        ),
        quorum: BigInt(f.config.quorum),
        nonce: BigInt(f.config.nonce),
      };
      const bytes = await deriveMultiSigAddressBytes(config);
      expect(toHex(bytes)).toBe(f.expectedAddressHex);
    });
  }

  it("produces a bech32m fast1... address", async () => {
    const config = {
      authorized_signers: [new Uint8Array(32), new Uint8Array(32).fill(1)],
      quorum: 2n,
      nonce: 0n,
    };
    const addr = await deriveMultiSigAddress(config);
    expect(addr.startsWith("fast1")).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run from repo root:

```bash
pnpm --filter @fastxyz/schema build
cd packages/fast-sdk && pnpm exec vitest run tests/unit/multisig-signer.test.ts
```

Expected: FAIL — module `../../src/interface/multisig-signer` does not exist.

- [ ] **Step 4: Implement minimal helpers**

Create `packages/fast-sdk/src/interface/multisig-signer.ts`:

```ts
import { bcsSchema, type MultiSigConfig } from "@fastxyz/schema";
import { hash } from "../core/crypto/bcs";
import { run } from "../core/run";
import { toFastAddress } from "./convert";

export async function deriveMultiSigAddressBytes(
  config: MultiSigConfig,
): Promise<Uint8Array> {
  return run(hash(bcsSchema.MultiSigConfig, config));
}

export async function deriveMultiSigAddress(
  config: MultiSigConfig,
): Promise<string> {
  return toFastAddress(await deriveMultiSigAddressBytes(config));
}
```

If the fixture's `expectedAddressHex` was a placeholder, run the test
once now to capture the actual output, then update the fixture file
(this is the "freeze the ground truth" step).

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd packages/fast-sdk && pnpm exec vitest run tests/unit/multisig-signer.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/fast-sdk/src/interface/multisig-signer.ts \
        packages/fast-sdk/tests/unit/multisig-signer.test.ts \
        packages/fast-sdk/tests/unit/fixtures/multisig-addresses.json
git commit -m "feat(fast-sdk): add deriveMultiSigAddress helpers"
```

---

## Task 2: SDK — assertAuthorizedSigner helper

**Files:**

- Modify: `packages/fast-sdk/src/interface/multisig-signer.ts`
- Modify: `packages/fast-sdk/tests/unit/multisig-signer.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/multisig-signer.test.ts`:

```ts
import {
  assertAuthorizedSigner,
  NotAuthorizedSignerError,
  MultiSigConfigInvalidError,
} from "../../src/interface/multisig-signer";
import { getPublicKeyAsync } from "@noble/ed25519";

describe("assertAuthorizedSigner", () => {
  const SECRET_A = new Uint8Array(32).fill(0xaa);
  const SECRET_B = new Uint8Array(32).fill(0xbb);

  it("returns void when secret derives a pubkey in authorized_signers", async () => {
    const pkA = await getPublicKeyAsync(SECRET_A);
    const pkB = await getPublicKeyAsync(SECRET_B);
    const config = {
      authorized_signers: [pkA, pkB],
      quorum: 2n,
      nonce: 0n,
    };
    await expect(assertAuthorizedSigner(config, SECRET_A)).resolves.toBeUndefined();
  });

  it("throws NotAuthorizedSignerError when secret is not a member", async () => {
    const pkA = await getPublicKeyAsync(SECRET_A);
    const otherSecret = new Uint8Array(32).fill(0xcc);
    const config = {
      authorized_signers: [pkA, await getPublicKeyAsync(SECRET_B)],
      quorum: 2n,
      nonce: 0n,
    };
    await expect(assertAuthorizedSigner(config, otherSecret)).rejects.toThrow(
      NotAuthorizedSignerError,
    );
  });

  it("throws MultiSigConfigInvalidError on quorum < 1", async () => {
    const config = {
      authorized_signers: [
        await getPublicKeyAsync(SECRET_A),
        await getPublicKeyAsync(SECRET_B),
      ],
      quorum: 0n,
      nonce: 0n,
    };
    await expect(assertAuthorizedSigner(config, SECRET_A)).rejects.toThrow(
      MultiSigConfigInvalidError,
    );
  });

  it("throws MultiSigConfigInvalidError on quorum > signer count", async () => {
    const config = {
      authorized_signers: [
        await getPublicKeyAsync(SECRET_A),
        await getPublicKeyAsync(SECRET_B),
      ],
      quorum: 3n,
      nonce: 0n,
    };
    await expect(assertAuthorizedSigner(config, SECRET_A)).rejects.toThrow(
      MultiSigConfigInvalidError,
    );
  });

  it("throws MultiSigConfigInvalidError on signer count < 2", async () => {
    const config = {
      authorized_signers: [await getPublicKeyAsync(SECRET_A)],
      quorum: 1n,
      nonce: 0n,
    };
    await expect(assertAuthorizedSigner(config, SECRET_A)).rejects.toThrow(
      MultiSigConfigInvalidError,
    );
  });

  it("throws MultiSigConfigInvalidError on duplicate signers", async () => {
    const pkA = await getPublicKeyAsync(SECRET_A);
    const config = {
      authorized_signers: [pkA, pkA],
      quorum: 2n,
      nonce: 0n,
    };
    await expect(assertAuthorizedSigner(config, SECRET_A)).rejects.toThrow(
      MultiSigConfigInvalidError,
    );
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd packages/fast-sdk && pnpm exec vitest run tests/unit/multisig-signer.test.ts
```

Expected: FAIL — `assertAuthorizedSigner`, `NotAuthorizedSignerError`,
and `MultiSigConfigInvalidError` are not exported.

- [ ] **Step 3: Implement**

Append to `packages/fast-sdk/src/interface/multisig-signer.ts`:

```ts
import { getPublicKeyAsync } from "@noble/ed25519";

export class MultiSigConfigInvalidError extends Error {
  readonly _tag = "MultiSigConfigInvalidError" as const;
  constructor(message: string) {
    super(message);
    this.name = "MultiSigConfigInvalidError";
  }
}

export class NotAuthorizedSignerError extends Error {
  readonly _tag = "NotAuthorizedSignerError" as const;
  constructor(message = "secret key is not in config.authorized_signers") {
    super(message);
    this.name = "NotAuthorizedSignerError";
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function validateConfig(config: MultiSigConfig): void {
  const signers = config.authorized_signers;
  if (signers.length < 2) {
    throw new MultiSigConfigInvalidError(
      `authorized_signers must have at least 2 entries (got ${signers.length})`,
    );
  }
  if (config.quorum < 1n) {
    throw new MultiSigConfigInvalidError(
      `quorum must be >= 1 (got ${config.quorum})`,
    );
  }
  if (config.quorum > BigInt(signers.length)) {
    throw new MultiSigConfigInvalidError(
      `quorum (${config.quorum}) exceeds signer count (${signers.length})`,
    );
  }
  for (let i = 0; i < signers.length; i++) {
    for (let j = i + 1; j < signers.length; j++) {
      if (bytesEqual(signers[i]!, signers[j]!)) {
        throw new MultiSigConfigInvalidError(
          `duplicate signer at indices ${i} and ${j}`,
        );
      }
    }
  }
}

export async function assertAuthorizedSigner(
  config: MultiSigConfig,
  secretKey: Uint8Array,
): Promise<void> {
  validateConfig(config);
  const pk = await getPublicKeyAsync(secretKey);
  const matched = config.authorized_signers.some((s) => bytesEqual(s, pk));
  if (!matched) throw new NotAuthorizedSignerError();
}
```

- [ ] **Step 4: Verify tests pass**

```bash
cd packages/fast-sdk && pnpm exec vitest run tests/unit/multisig-signer.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/fast-sdk/src/interface/multisig-signer.ts \
        packages/fast-sdk/tests/unit/multisig-signer.test.ts
git commit -m "feat(fast-sdk): assertAuthorizedSigner with config validation"
```

---

## Task 3: SDK — MultiSigSigner class (constructor + getters)

**Files:**

- Modify: `packages/fast-sdk/src/interface/multisig-signer.ts`
- Modify: `packages/fast-sdk/tests/unit/multisig-signer.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to the test file:

```ts
import { MultiSigSigner } from "../../src/interface/multisig-signer";
import { getPublicKeyAsync } from "@noble/ed25519";

describe("MultiSigSigner construction", () => {
  const SECRET_A = new Uint8Array(32).fill(0xaa);
  const SECRET_B = new Uint8Array(32).fill(0xbb);

  it("constructs with a member secret and exposes pubkey", async () => {
    const pkA = await getPublicKeyAsync(SECRET_A);
    const pkB = await getPublicKeyAsync(SECRET_B);
    const config = {
      authorized_signers: [pkA, pkB],
      quorum: 2n,
      nonce: 0n,
    };
    const signer = new MultiSigSigner({ config, secretKey: SECRET_A });
    expect(await signer.getSignerPublicKey()).toEqual(pkA);
  });

  it("getFastAddress returns derived multisig bech32m", async () => {
    const pkA = await getPublicKeyAsync(SECRET_A);
    const pkB = await getPublicKeyAsync(SECRET_B);
    const config = {
      authorized_signers: [pkA, pkB],
      quorum: 2n,
      nonce: 0n,
    };
    const signer = new MultiSigSigner({ config, secretKey: SECRET_A });
    const fromSigner = await signer.getFastAddress();
    const direct = await deriveMultiSigAddress(config);
    expect(fromSigner).toBe(direct);
  });

  it("rejects construction when secret is not in authorized_signers", async () => {
    const pkA = await getPublicKeyAsync(SECRET_A);
    const pkB = await getPublicKeyAsync(SECRET_B);
    const config = {
      authorized_signers: [pkA, pkB],
      quorum: 2n,
      nonce: 0n,
    };
    const stranger = new Uint8Array(32).fill(0xcc);
    // Construction is sync; validation happens lazily on first method call
    const signer = new MultiSigSigner({ config, secretKey: stranger });
    await expect(signer.getSignerPublicKey()).rejects.toThrow(
      NotAuthorizedSignerError,
    );
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd packages/fast-sdk && pnpm exec vitest run tests/unit/multisig-signer.test.ts
```

Expected: FAIL — `MultiSigSigner` is not exported.

- [ ] **Step 3: Implement the class**

Append to `packages/fast-sdk/src/interface/multisig-signer.ts`:

```ts
import { Redacted } from "effect";

export interface MultiSigSignerInit {
  config: MultiSigConfig;
  secretKey: Uint8Array;
}

export class MultiSigSigner {
  readonly config: MultiSigConfig;
  private readonly secretKey: Redacted.Redacted<Uint8Array>;
  private validatedOnce = false;
  private cachedPublicKey?: Uint8Array;

  constructor(init: MultiSigSignerInit) {
    this.config = init.config;
    this.secretKey = Redacted.make(init.secretKey);
  }

  private async ensureValid(): Promise<void> {
    if (this.validatedOnce) return;
    await assertAuthorizedSigner(this.config, Redacted.value(this.secretKey));
    this.validatedOnce = true;
  }

  async getSignerPublicKey(): Promise<Uint8Array> {
    await this.ensureValid();
    this.cachedPublicKey ??= await getPublicKeyAsync(
      Redacted.value(this.secretKey),
    );
    return this.cachedPublicKey;
  }

  async getDerivedAddressBytes(): Promise<Uint8Array> {
    await this.ensureValid();
    return deriveMultiSigAddressBytes(this.config);
  }

  async getFastAddress(): Promise<string> {
    await this.ensureValid();
    return deriveMultiSigAddress(this.config);
  }
}
```

- [ ] **Step 4: Verify tests pass**

```bash
cd packages/fast-sdk && pnpm exec vitest run tests/unit/multisig-signer.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/fast-sdk/src/interface/multisig-signer.ts \
        packages/fast-sdk/tests/unit/multisig-signer.test.ts
git commit -m "feat(fast-sdk): MultiSigSigner constructor and getters"
```

---

## Task 4: SDK — MultiSigSigner.signEnvelopeFor (vote path)

**Files:**

- Modify: `packages/fast-sdk/src/interface/multisig-signer.ts`
- Modify: `packages/fast-sdk/tests/unit/multisig-signer.test.ts`

`signEnvelopeFor(versionedTx)` signs an existing `VersionedTransaction`
and produces a `TransactionEnvelope` with a `MultiSig` partial. This is
the path used by `fast multisig vote` (operation already chosen by
initiator; co-signer just signs the same bytes).

- [ ] **Step 1: Write the failing test**

Append to the test file:

```ts
import { bcsSchema, VersionedTransactionFromBcs } from "@fastxyz/schema";
import { TransactionBuilder } from "../../src/index";
import { Schema } from "effect";

describe("MultiSigSigner.signEnvelopeFor", () => {
  it("produces a MultiSig envelope with one partial signature", async () => {
    const SECRET_A = new Uint8Array(32).fill(0xaa);
    const SECRET_B = new Uint8Array(32).fill(0xbb);
    const pkA = await getPublicKeyAsync(SECRET_A);
    const pkB = await getPublicKeyAsync(SECRET_B);
    const config = {
      authorized_signers: [pkA, pkB],
      quorum: 2n,
      nonce: 0n,
    };
    const signer = new MultiSigSigner({ config, secretKey: SECRET_A });
    const sender = await signer.getDerivedAddressBytes();

    // Build a versioned transaction by hand (single TokenTransfer).
    // Using TransactionBuilder against a throw-away Signer is the
    // simplest way to construct a valid VersionedTransaction shape.
    const { Signer } = await import("../../src/index");
    const builder = new TransactionBuilder({
      networkId: "fast:testnet" as const,
      signer: new Signer(SECRET_A), // construction only; we replace sender below
      nonce: 0n,
    });
    const stubEnvelope = await builder
      .addTokenTransfer({
        tokenId: new Uint8Array(32),
        recipient: new Uint8Array(32),
        amount: 1n,
        userData: null,
      })
      .sign();

    // Replace sender to simulate a tx originated by the multisig wallet
    const versioned = {
      ...stubEnvelope.transaction,
      value: { ...stubEnvelope.transaction.value, sender },
    };

    const envelope = await signer.signEnvelopeFor(versioned);
    expect(envelope.transaction).toBe(versioned);
    expect(envelope.signature.type).toBe("MultiSig");
    if (envelope.signature.type !== "MultiSig") throw new Error("unreachable");
    expect(envelope.signature.value.config).toEqual(config);
    expect(envelope.signature.value.signatures).toHaveLength(1);
    expect(envelope.signature.value.signatures[0]![0]).toEqual(pkA);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
cd packages/fast-sdk && pnpm exec vitest run tests/unit/multisig-signer.test.ts
```

Expected: FAIL — `signEnvelopeFor` is not defined.

- [ ] **Step 3: Implement**

Add imports at top of `multisig-signer.ts`:

```ts
import {
  bcsSchema,
  type SignatureOrMultiSig,
  type TransactionEnvelope,
  type VersionedTransaction,
  VersionedTransactionFromBcs,
} from "@fastxyz/schema";
import { Schema } from "effect";
import { domainEncode } from "../core/crypto/bcs";
import { signMessage } from "../core/crypto/signing";
```

Append a method to `MultiSigSigner`:

```ts
async signEnvelopeFor(
  transaction: VersionedTransaction,
): Promise<TransactionEnvelope> {
  await this.ensureValid();
  const pubkey = await this.getSignerPublicKey();
  const bcsEncoded = await run(
    Schema.encode(VersionedTransactionFromBcs)(transaction),
  );
  const messageWithDomain = await run(
    domainEncode(bcsSchema.VersionedTransaction, bcsEncoded),
  );
  const sig = await run(
    signMessage(Redacted.value(this.secretKey), messageWithDomain),
  );
  const multiSig: SignatureOrMultiSig = {
    type: "MultiSig",
    value: {
      config: this.config,
      signatures: [[pubkey, sig]],
    },
  };
  return { transaction, signature: multiSig };
}
```

> Note: `signing.signTypedData` does the equivalent for raw private keys
> in one call. We call `domainEncode` + `signMessage` here so the partial
> sig matches the bytes a single-signer's `Signature` would have for the
> same versioned transaction.

- [ ] **Step 4: Verify tests pass**

```bash
cd packages/fast-sdk && pnpm exec vitest run tests/unit/multisig-signer.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/fast-sdk/src/interface/multisig-signer.ts \
        packages/fast-sdk/tests/unit/multisig-signer.test.ts
git commit -m "feat(fast-sdk): MultiSigSigner.signEnvelopeFor"
```

---

## Task 5: SDK — MultiSigSigner.signTransaction (initiate path)

**Files:**

- Modify: `packages/fast-sdk/src/interface/multisig-signer.ts`
- Modify: `packages/fast-sdk/tests/unit/multisig-signer.test.ts`

`signTransaction(opts)` is the initiate path: build a `VersionedTransaction`
with `sender = derivedAddressBytes`, then sign as a partial (calls
`signEnvelopeFor` internally).

- [ ] **Step 1: Write the failing test**

Append:

```ts
describe("MultiSigSigner.signTransaction", () => {
  it("builds a versioned tx with sender=derived and signs as partial", async () => {
    const SECRET_A = new Uint8Array(32).fill(0xaa);
    const SECRET_B = new Uint8Array(32).fill(0xbb);
    const pkA = await getPublicKeyAsync(SECRET_A);
    const pkB = await getPublicKeyAsync(SECRET_B);
    const config = {
      authorized_signers: [pkA, pkB],
      quorum: 2n,
      nonce: 0n,
    };
    const signer = new MultiSigSigner({ config, secretKey: SECRET_A });
    const sender = await signer.getDerivedAddressBytes();

    const envelope = await signer.signTransaction({
      networkId: "fast:testnet" as const,
      nonce: 0n,
      operations: [
        {
          type: "TokenTransfer",
          value: {
            tokenId: new Uint8Array(32),
            recipient: new Uint8Array(32),
            amount: 1n,
            userData: null,
          },
        },
      ],
    });

    expect(envelope.transaction.value.sender).toEqual(sender);
    expect(envelope.signature.type).toBe("MultiSig");
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
cd packages/fast-sdk && pnpm exec vitest run tests/unit/multisig-signer.test.ts
```

Expected: FAIL — `signTransaction` not implemented.

- [ ] **Step 3: Implement**

Add imports to `multisig-signer.ts`:

```ts
import {
  getTransactionVersionConfig,
  LatestTransactionVersion,
  type NetworkId,
  type NonceInput,
  type OperationInputParams,
  type TokenIdInput,
  type TransactionVersion,
} from "@fastxyz/schema";
```

Append method:

```ts
async signTransaction(opts: {
  networkId: NetworkId;
  nonce: NonceInput;
  operations: OperationInputParams[];
  version?: TransactionVersion;
  archival?: boolean;
  feeToken?: TokenIdInput | null;
}): Promise<TransactionEnvelope> {
  if (opts.operations.length === 0) {
    throw new Error("signTransaction requires at least one operation");
  }
  const sender = await this.getDerivedAddressBytes();
  const type: TransactionVersion = opts.version ?? LatestTransactionVersion;
  const versionConfig = getTransactionVersionConfig(type);
  const internal = Schema.decodeUnknownSync(versionConfig.inputSchema)({
    networkId: opts.networkId,
    sender,
    nonce: opts.nonce,
    timestampNanos: BigInt(Date.now()) * 1_000_000n,
    ...versionConfig.wrapOperations(opts.operations),
    archival: opts.archival ?? false,
    feeToken: opts.feeToken ?? null,
  });
  const versioned = { type, value: internal } as VersionedTransaction;
  return this.signEnvelopeFor(versioned);
}
```

- [ ] **Step 4: Verify tests pass**

```bash
cd packages/fast-sdk && pnpm exec vitest run tests/unit/multisig-signer.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/fast-sdk/src/interface/multisig-signer.ts \
        packages/fast-sdk/tests/unit/multisig-signer.test.ts
git commit -m "feat(fast-sdk): MultiSigSigner.signTransaction"
```

---

## Task 6: SDK — Public exports + changeset

**Files:**

- Modify: `packages/fast-sdk/src/index.ts`
- Create: `.changeset/multisig-signer.md`

- [ ] **Step 1: Add exports**

Append to `packages/fast-sdk/src/index.ts`:

```ts
export {
  MultiSigSigner,
  deriveMultiSigAddress,
  deriveMultiSigAddressBytes,
  assertAuthorizedSigner,
  MultiSigConfigInvalidError,
  NotAuthorizedSignerError,
  type MultiSigSignerInit,
} from "./interface/multisig-signer";
```

- [ ] **Step 2: Verify SDK builds**

```bash
pnpm --filter @fastxyz/sdk build
```

Expected: clean build with no dts errors.

- [ ] **Step 3: Add changeset**

Create `.changeset/multisig-signer.md`:

```md
---
"@fastxyz/sdk": minor
---

Add `MultiSigSigner` and helpers (`deriveMultiSigAddress`,
`assertAuthorizedSigner`) for N-of-M multisig wallets. The signer
produces a single partial signature wrapped in the on-wire `MultiSig`
envelope; the proxy aggregates partials across cosigners.
```

- [ ] **Step 4: Commit**

```bash
git add packages/fast-sdk/src/index.ts .changeset/multisig-signer.md
git commit -m "feat(fast-sdk): export MultiSigSigner public API"
```

---

## Task 7: CLI — Wallet config schema

**Files:**

- Create: `app/cli/src/schemas/multisig-wallet.ts`
- Create: `app/cli/tests/unit/multisig-wallet-schema.test.ts`
- Modify: `app/cli/package.json` (add `vitest` to devDeps if missing; add `test` script)
- Create: `app/cli/vitest.config.ts` (if missing)

The CLI doesn't currently have a vitest setup. Add the minimal config so
new tests run.

- [ ] **Step 1: Add vitest setup if missing**

Check: `ls app/cli/vitest.config.ts app/cli/tests 2>/dev/null`. If
neither exists:

Create `app/cli/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
```

Modify `app/cli/package.json`:

- Add `"test": "vitest run"` to `scripts`.
- Ensure `vitest` is in `devDependencies` (it's a root devDep already; add
  here if `pnpm test` from inside the package fails to find it).

Run `pnpm install` at repo root to refresh.

- [ ] **Step 2: Write the failing test**

Create `app/cli/tests/unit/multisig-wallet-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import {
  MultiSigWalletConfigSchema,
  parseMultiSigWalletConfig,
} from "../../src/schemas/multisig-wallet";

const SAMPLE = {
  version: 1,
  name: "treasury",
  signers: ["fast1qqqq...", "fast1pppp..."],
  quorum: 2,
  configNonce: "0",
  fastAddress: "fast1xyz...",
  network: "testnet",
};

describe("MultiSigWalletConfigSchema", () => {
  it("decodes a valid wallet config JSON string", async () => {
    const decoded = await Effect.runPromise(
      parseMultiSigWalletConfig(JSON.stringify(SAMPLE)),
    );
    expect(decoded.name).toBe("treasury");
    expect(decoded.quorum).toBe(2);
    expect(decoded.configNonce).toBe("0");
  });

  it("rejects unknown version", async () => {
    await expect(
      Effect.runPromise(
        parseMultiSigWalletConfig(JSON.stringify({ ...SAMPLE, version: 99 })),
      ),
    ).rejects.toThrow();
  });

  it("rejects quorum < 1", async () => {
    await expect(
      Effect.runPromise(
        parseMultiSigWalletConfig(JSON.stringify({ ...SAMPLE, quorum: 0 })),
      ),
    ).rejects.toThrow();
  });

  it("rejects quorum > signer count", async () => {
    await expect(
      Effect.runPromise(
        parseMultiSigWalletConfig(JSON.stringify({ ...SAMPLE, quorum: 3 })),
      ),
    ).rejects.toThrow();
  });

  it("rejects fewer than 2 signers", async () => {
    await expect(
      Effect.runPromise(
        parseMultiSigWalletConfig(
          JSON.stringify({ ...SAMPLE, signers: [SAMPLE.signers[0]], quorum: 1 }),
        ),
      ),
    ).rejects.toThrow();
  });

  it("rejects duplicate signers", async () => {
    await expect(
      Effect.runPromise(
        parseMultiSigWalletConfig(
          JSON.stringify({
            ...SAMPLE,
            signers: [SAMPLE.signers[0], SAMPLE.signers[0]],
          }),
        ),
      ),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify failure**

```bash
cd app/cli && pnpm exec vitest run tests/unit/multisig-wallet-schema.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement schema**

Create `app/cli/src/schemas/multisig-wallet.ts`:

```ts
import { Effect, Schema } from "effect";

const MultiSigWalletConfigStruct = Schema.Struct({
  version: Schema.Literal(1),
  name: Schema.String.pipe(Schema.minLength(1)),
  signers: Schema.Array(Schema.String).pipe(Schema.minItems(2)),
  quorum: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(1)),
  configNonce: Schema.String, // u64 as decimal string
  fastAddress: Schema.String,
  network: Schema.String,
});

export const MultiSigWalletConfigSchema = MultiSigWalletConfigStruct.pipe(
  Schema.filter((v) =>
    v.quorum > v.signers.length
      ? `quorum ${v.quorum} exceeds signer count ${v.signers.length}`
      : new Set(v.signers).size !== v.signers.length
        ? "duplicate signers"
        : true,
  ),
);

export type MultiSigWalletConfig = Schema.Schema.Type<
  typeof MultiSigWalletConfigSchema
>;

export const parseMultiSigWalletConfig = (json: string) =>
  Effect.try({
    try: () => JSON.parse(json) as unknown,
    catch: (cause) => new Error(`invalid wallet config JSON: ${cause}`),
  }).pipe(Effect.flatMap(Schema.decodeUnknown(MultiSigWalletConfigSchema)));

export const stringifyMultiSigWalletConfig = (
  config: MultiSigWalletConfig,
): string => JSON.stringify(config, null, 2);
```

- [ ] **Step 5: Verify tests pass**

```bash
cd app/cli && pnpm exec vitest run tests/unit/multisig-wallet-schema.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/cli/src/schemas/multisig-wallet.ts \
        app/cli/tests/unit/multisig-wallet-schema.test.ts \
        app/cli/vitest.config.ts app/cli/package.json
git commit -m "feat(cli): multisig wallet config schema"
```

---

## Task 8: CLI — Drizzle migration: tagged-union accounts

**Files:**

- Modify: `app/cli/src/db/schema.ts`
- Create: `app/cli/drizzle/0001_multisig_accounts.sql`
- Create: `app/cli/drizzle/meta/0001_snapshot.json` (auto-generated)

The accounts table needs `kind`, `multisig_config`, plus making
`encrypted_key`, `evm_address`, `encrypted` nullable for multisig rows.

- [ ] **Step 1: Update drizzle schema**

Replace the `accounts` definition in [app/cli/src/db/schema.ts](../../app/cli/src/db/schema.ts):

```ts
export const accounts = sqliteTable("accounts", {
  name: text("name").primaryKey(),
  kind: text("kind").notNull().default("single"), // 'single' | 'multisig'
  fastAddress: text("fast_address").notNull(),
  evmAddress: text("evm_address"),                 // nullable for multisig
  encryptedKey: blob("encrypted_key", { mode: "buffer" }), // nullable for multisig
  encrypted: integer("encrypted", { mode: "boolean" }),    // nullable for multisig
  multisigConfig: text("multisig_config"),         // JSON; null for single
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
});
```

- [ ] **Step 2: Generate migration**

```bash
cd app/cli && pnpm exec drizzle-kit generate
```

Expected: a new file in `app/cli/drizzle/0001_*.sql` plus an updated
`meta/_journal.json`. Inspect the generated SQL — for SQLite, drizzle
will emit `ALTER TABLE` statements.

If drizzle-kit refuses to drop NOT NULL constraints (SQLite limitation),
hand-write the migration. Replace the generated file with
`app/cli/drizzle/0001_multisig_accounts.sql`:

```sql
-- SQLite ALTER TABLE can't drop NOT NULL or add CHECK; rebuild via temp table.
CREATE TABLE `accounts_new` (
  `name` text PRIMARY KEY NOT NULL,
  `kind` text NOT NULL DEFAULT 'single',
  `fast_address` text NOT NULL,
  `evm_address` text,
  `encrypted_key` blob,
  `encrypted` integer,
  `multisig_config` text,
  `is_default` integer NOT NULL DEFAULT 0,
  `created_at` text NOT NULL,
  CHECK (
    (kind = 'single' AND encrypted_key IS NOT NULL AND multisig_config IS NULL) OR
    (kind = 'multisig' AND encrypted_key IS NULL AND multisig_config IS NOT NULL)
  )
);
INSERT INTO `accounts_new`
  (name, kind, fast_address, evm_address, encrypted_key, encrypted, multisig_config, is_default, created_at)
SELECT
  name, 'single', fast_address, evm_address, encrypted_key, encrypted, NULL, is_default, created_at
FROM `accounts`;
DROP TABLE `accounts`;
ALTER TABLE `accounts_new` RENAME TO `accounts`;
```

Update `app/cli/drizzle/meta/_journal.json` to include the new migration
entry. (Drizzle's snapshot files will need regenerating — easiest path
is to let drizzle-kit produce a `0001_…snapshot.json` and hand-edit the
SQL only.)

- [ ] **Step 3: Verify migration runs**

Set up a fresh test DB and run migrations:

```bash
rm -f /tmp/fast-test.db
DRIZZLE_DB=/tmp/fast-test.db node -e '
  import("better-sqlite3").then(({default:Db})=>{
    import("drizzle-orm/better-sqlite3").then(({drizzle})=>{
      import("drizzle-orm/better-sqlite3/migrator").then(({migrate})=>{
        const sqlite = new Db("/tmp/fast-test.db");
        const db = drizzle(sqlite);
        migrate(db, { migrationsFolder: "./app/cli/drizzle" });
        console.log("OK");
      });
    });
  });
'
sqlite3 /tmp/fast-test.db ".schema accounts"
```

Expected: schema shows the new columns and CHECK constraint.

Also test the upgrade path: pre-populate a row with the OLD schema, run
the migration, confirm the row gets `kind='single'`:

```bash
rm -f /tmp/fast-test.db
sqlite3 /tmp/fast-test.db <<EOF
CREATE TABLE accounts (
  name text PRIMARY KEY NOT NULL,
  fast_address text NOT NULL,
  evm_address text NOT NULL,
  encrypted_key blob NOT NULL,
  encrypted integer NOT NULL DEFAULT 1,
  is_default integer NOT NULL DEFAULT 0,
  created_at text NOT NULL
);
INSERT INTO accounts VALUES ('alice', 'fast1...', '0xabc', x'01', 1, 1, '2026-05-01');
EOF
# Run only the 0001 migration manually:
sqlite3 /tmp/fast-test.db < app/cli/drizzle/0001_multisig_accounts.sql
sqlite3 /tmp/fast-test.db "SELECT name, kind, multisig_config FROM accounts;"
```

Expected output: `alice|single|` (kind backfilled, multisig_config null).

- [ ] **Step 4: Commit**

```bash
git add app/cli/src/db/schema.ts app/cli/drizzle/
git commit -m "feat(cli): tagged-union accounts schema for multisig"
```

---

## Task 9: CLI — AccountStore: kind-aware reads + multisig insert

**Files:**

- Modify: `app/cli/src/services/storage/account.ts`
- Create: `app/cli/tests/unit/account-store-multisig.test.ts`

`AccountInfo` becomes a tagged union; `AccountStore` adds methods to
insert and read multisig rows.

- [ ] **Step 1: Update the AccountInfo type and rowToInfo**

Replace the top of [app/cli/src/services/storage/account.ts](../../app/cli/src/services/storage/account.ts):

```ts
import type { MultiSigWalletConfig } from "../../schemas/multisig-wallet.js";
import {
  parseMultiSigWalletConfig,
  stringifyMultiSigWalletConfig,
} from "../../schemas/multisig-wallet.js";

export type AccountInfo =
  | {
      readonly kind: "single";
      readonly name: string;
      readonly fastAddress: string;
      readonly evmAddress: string;
      readonly isDefault: boolean;
      readonly encrypted: boolean;
      readonly createdAt: string;
    }
  | {
      readonly kind: "multisig";
      readonly name: string;
      readonly fastAddress: string;
      readonly multisigConfig: MultiSigWalletConfig;
      readonly isDefault: boolean;
      readonly createdAt: string;
    };
```

Replace `rowToInfo`:

```ts
const rowToInfo = (row: typeof accounts.$inferSelect): AccountInfo => {
  if (row.kind === "multisig") {
    if (row.multisigConfig === null) {
      throw new Error(
        `account "${row.name}" is multisig but multisig_config is null`,
      );
    }
    return {
      kind: "multisig",
      name: row.name,
      fastAddress: row.fastAddress,
      multisigConfig: JSON.parse(
        row.multisigConfig,
      ) as MultiSigWalletConfig,
      isDefault: row.isDefault,
      createdAt: row.createdAt,
    };
  }
  return {
    kind: "single",
    name: row.name,
    fastAddress: row.fastAddress,
    evmAddress: row.evmAddress ?? "",
    encrypted: row.encrypted ?? false,
    isDefault: row.isDefault,
    createdAt: row.createdAt,
  };
};
```

- [ ] **Step 2: Add `createMultiSig` to AccountStore**

In `ServiceEffect`, add:

```ts
const createMultiSig = (
  handle: DatabaseShape,
  config: MultiSigWalletConfig,
  setDefault: boolean,
) =>
  Effect.gen(function* () {
    const existing = yield* handle.query(
      (db) => getAccountByName(db, config.name),
      "Failed to check existing account",
    );
    if (existing) {
      return yield* Effect.fail(new AccountExistsError({ name: config.name }));
    }

    const isFirst = yield* handle.query(
      (db) => countAccounts(db) === 0,
      "Failed to count accounts",
    );
    const createdAt = new Date().toISOString();

    yield* handle.query(
      (db) =>
        db
          .insert(accounts)
          .values({
            name: config.name,
            kind: "multisig",
            fastAddress: config.fastAddress,
            evmAddress: null,
            encryptedKey: null,
            encrypted: null,
            multisigConfig: stringifyMultiSigWalletConfig(config),
            isDefault: isFirst || setDefault,
            createdAt,
          })
          .run(),
      "Failed to store multisig account",
    );

    if (setDefault && !isFirst) {
      yield* handle.query((db) => {
        db.update(accounts)
          .set({ isDefault: false })
          .where(eq(accounts.isDefault, true))
          .run();
        db.update(accounts)
          .set({ isDefault: true })
          .where(eq(accounts.name, config.name))
          .run();
      }, "Failed to mark multisig as default");
    }

    return rowToInfo({
      name: config.name,
      kind: "multisig",
      fastAddress: config.fastAddress,
      evmAddress: null,
      encryptedKey: null,
      encrypted: null,
      multisigConfig: stringifyMultiSigWalletConfig(config),
      isDefault: isFirst || setDefault,
      createdAt,
    });
  });
```

In the returned service object, add:

```ts
createMultiSig: (
  config: MultiSigWalletConfig,
  setDefault: boolean,
) => createMultiSig(handle, config, setDefault),
```

- [ ] **Step 3: Update `exportAccount` to refuse multisig rows**

Replace the body of `exportAccount` so it errors via
`WalletKindMismatchError` (defined in Task 10) when `row.kind ===
"multisig"`. Until Task 10 lands, throw a temporary error string. Add a
TODO comment to swap to the typed error in Task 10. (Or: do this update
in Task 10 instead of here. Recommendation: defer the export-error-on-multisig
code change to Task 10 to avoid temporary strings — leave Task 9's
`exportAccount` unchanged.)

- [ ] **Step 4: Write a smoke test**

Create `app/cli/tests/unit/account-store-multisig.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import Db from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { AccountStore } from "../../src/services/storage/account";
import { DatabaseService } from "../../src/services/storage/database";

const makeTestLayer = () => {
  const dir = mkdtempSync(join(tmpdir(), "fast-cli-test-"));
  const dbPath = join(dir, "fast.db");
  const sqlite = new Db(dbPath);
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: join(__dirname, "../../drizzle") });
  // Bind the test DB into DatabaseService:
  return Layer.succeed(DatabaseService, {
    query: <A>(fn: (db: typeof db) => A) => Effect.sync(() => fn(db)),
  } as never);
};

describe("AccountStore.createMultiSig", () => {
  it("inserts a multisig row and reads it back", async () => {
    const layer = Layer.merge(makeTestLayer(), AccountStore.Default);
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* AccountStore;
        const created = yield* store.createMultiSig(
          {
            version: 1,
            name: "treasury",
            signers: ["fast1aaaa", "fast1bbbb"],
            quorum: 2,
            configNonce: "0",
            fastAddress: "fast1xyzxyz",
            network: "testnet",
          },
          true,
        );
        const fetched = yield* store.get("treasury");
        return { created, fetched };
      }).pipe(Effect.provide(layer)),
    );
    expect(result.created.kind).toBe("multisig");
    expect(result.fetched.kind).toBe("multisig");
    if (result.fetched.kind !== "multisig") throw new Error("unreachable");
    expect(result.fetched.multisigConfig.quorum).toBe(2);
  });
});
```

If `DatabaseService.query` has a slightly different signature, adapt the
mock — read [app/cli/src/services/storage/database.ts](../../app/cli/src/services/storage/database.ts)
to match its actual `DatabaseShape`.

- [ ] **Step 5: Run test**

```bash
cd app/cli && pnpm exec vitest run tests/unit/account-store-multisig.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/cli/src/services/storage/account.ts \
        app/cli/tests/unit/account-store-multisig.test.ts
git commit -m "feat(cli): AccountStore.createMultiSig + tagged AccountInfo"
```

---

## Task 10: CLI — New error classes

**Files:**

- Modify: `app/cli/src/errors/account.ts`
- Modify: `app/cli/src/errors/index.ts`
- Modify: `app/cli/src/services/storage/account.ts` (export now errors on multisig)

- [ ] **Step 1: Add error classes**

Append to [app/cli/src/errors/account.ts](../../app/cli/src/errors/account.ts):

```ts
export class MultiSigConfigInvalidError extends Data.TaggedError(
  "MultiSigConfigInvalidError",
)<{ readonly reason: string }> {
  readonly exitCode = 2 as const;
  readonly errorCode = "MULTISIG_CONFIG_INVALID" as const;
  get message() {
    return `Invalid multisig config: ${this.reason}`;
  }
}

export class NotAMemberError extends Data.TaggedError("NotAMemberError")<{
  readonly walletName: string;
}> {
  readonly exitCode = 2 as const;
  readonly errorCode = "NOT_A_MEMBER" as const;
  get message() {
    return `You don't have a local account for any signer of multisig wallet "${this.walletName}".`;
  }
}

export class AmbiguousMemberError extends Data.TaggedError(
  "AmbiguousMemberError",
)<{ readonly walletName: string; readonly candidates: readonly string[] }> {
  readonly exitCode = 2 as const;
  readonly errorCode = "AMBIGUOUS_MEMBER" as const;
  get message() {
    return `You have keys for multiple signers of "${this.walletName}" (${this.candidates.join(", ")}). Pass --as <name> to choose one.`;
  }
}

export class AddressDerivationMismatchError extends Data.TaggedError(
  "AddressDerivationMismatchError",
)<{ readonly expected: string; readonly derived: string }> {
  readonly exitCode = 2 as const;
  readonly errorCode = "ADDRESS_DERIVATION_MISMATCH" as const;
  get message() {
    return `Wallet config integrity check failed: expected fast address ${this.expected}, derived ${this.derived}.`;
  }
}

export class AlreadyVotedError extends Data.TaggedError("AlreadyVotedError")<{
  readonly walletName: string;
  readonly txHash: string;
}> {
  readonly exitCode = 2 as const;
  readonly errorCode = "ALREADY_VOTED" as const;
  get message() {
    return `You have already signed transaction ${this.txHash} on wallet "${this.walletName}".`;
  }
}

export class WalletKindMismatchError extends Data.TaggedError(
  "WalletKindMismatchError",
)<{ readonly name: string; readonly expected: "single" | "multisig"; readonly hint?: string }> {
  readonly exitCode = 2 as const;
  readonly errorCode = "WALLET_KIND_MISMATCH" as const;
  get message() {
    const verb = this.expected === "single" ? "single-signer" : "multisig";
    return `"${this.name}" is not a ${verb} account.${this.hint ? ` ${this.hint}` : ""}`;
  }
}
```

- [ ] **Step 2: Update errors/index.ts ClientError union**

Add the new types to the imports and to the `ClientError` union in [app/cli/src/errors/index.ts](../../app/cli/src/errors/index.ts).

- [ ] **Step 3: Make `account export` error on multisig**

In `app/cli/src/services/storage/account.ts`, replace `exportAccount`:

```ts
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
    if (!row) return yield* Effect.fail(new AccountNotFoundError({ name }));
    if (row.kind === "multisig") {
      return yield* Effect.fail(
        new WalletKindMismatchError({
          name,
          expected: "single",
          hint: 'Use "fast multisig export" to export a wallet config.',
        }),
      );
    }
    if (row.encryptedKey === null) {
      return yield* Effect.fail(
        new DatabaseError({
          message: `account "${name}" has no encrypted key`,
          cause: null,
        }),
      );
    }

    const seed = yield* Effect.tryPromise({
      try: () =>
        loadSeed(new Uint8Array(row.encryptedKey!), password, row.encrypted ?? false),
      catch: (cause) => {
        if (cause instanceof WrongPasswordError) return cause;
        if (cause instanceof PasswordRequiredError) return cause;
        return new DatabaseError({ message: "Failed to load seed", cause });
      },
    });

    return { seed, entry: rowToInfo(row) };
  });
```

Add `WalletKindMismatchError` to the imports.

- [ ] **Step 4: Run existing tests to verify nothing broke**

```bash
cd app/cli && pnpm exec vitest run
```

Expected: existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add app/cli/src/errors/ app/cli/src/services/storage/account.ts
git commit -m "feat(cli): multisig error taxonomy + export refuses multisig"
```

---

## Task 11: CLI — SignerResolver service

**Files:**

- Create: `app/cli/src/services/signer-resolver.ts`
- Create: `app/cli/tests/unit/signer-resolver.test.ts`

The resolver maps an `AccountInfo` plus optional `--as <name>` to a
ready-to-use `Signer | MultiSigSigner`.

- [ ] **Step 1: Write the failing test**

Create `app/cli/tests/unit/signer-resolver.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { resolveSigner } from "../../src/services/signer-resolver";
import { NotAMemberError, AmbiguousMemberError } from "../../src/errors/index";

describe("resolveSigner", () => {
  // These tests use the same in-memory DB layer pattern as
  // account-store-multisig.test.ts. See Task 9 for the layer factory.
  // Pseudocode below; the implementer should adapt to the chosen
  // DatabaseService Layer construction.

  it("returns kind=single for a single-signer account", async () => {
    // Given: a single-signer account "alice" exists with password "pwd"
    // When: resolveSigner({ account: alice, password: "pwd" })
    // Then: result.kind === "single"; result.signer.getFastAddress() works
  });

  it("auto-picks the only matching local member for multisig", async () => {
    // Given: multisig "treasury" with signers [alicePub, bobPub], and
    //        only "alice" exists locally
    // When:  resolveSigner({ account: treasury, password: "pwd" })
    // Then:  result.kind === "multisig"; result.memberAccount.name === "alice"
  });

  it("fails AmbiguousMember if multiple local members and no --as", async () => {
    // Given: treasury with [alicePub, bobPub]; both "alice" and "bob"
    //        exist locally
    // When:  resolveSigner({ account: treasury }) without asMember
    // Then:  error AmbiguousMemberError with candidates ['alice','bob']
  });

  it("uses --as when specified and valid", async () => {
    // Given: treasury and both alice/bob locally
    // When:  resolveSigner({ account: treasury, asMember: "bob", password: "pwd-bob" })
    // Then:  result.memberAccount.name === "bob"
  });

  it("fails NotAMember when no local accounts match", async () => {
    // Given: treasury with [alicePub, bobPub]; only "carol" locally
    // When:  resolveSigner({ account: treasury })
    // Then:  error NotAMemberError
  });
});
```

The implementer should fill in the test bodies using the same in-memory
SQLite + AccountStore layer pattern from Task 9.

- [ ] **Step 2: Run tests to verify failure**

```bash
cd app/cli && pnpm exec vitest run tests/unit/signer-resolver.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `app/cli/src/services/signer-resolver.ts`:

```ts
import { fromFastAddress, MultiSigSigner, Signer } from "@fastxyz/sdk";
import { Effect } from "effect";
import {
  AmbiguousMemberError,
  NotAMemberError,
  PasswordRequiredError,
} from "../errors/index.js";
import { AccountStore, type AccountInfo } from "./storage/account.js";

export type ResolvedSigner =
  | {
      kind: "single";
      signer: Signer;
      account: AccountInfo & { kind: "single" };
    }
  | {
      kind: "multisig";
      signer: MultiSigSigner;
      account: AccountInfo & { kind: "multisig" };
      memberAccount: AccountInfo & { kind: "single" };
    };

export interface ResolveSignerOptions {
  readonly account: AccountInfo;
  readonly asMember?: string;
  readonly password: string | null;
}

export const resolveSigner = (opts: ResolveSignerOptions) =>
  Effect.gen(function* () {
    const accounts = yield* AccountStore;

    if (opts.account.kind === "single") {
      const { seed } = yield* accounts.export(opts.account.name, opts.password);
      const signer = new Signer(seed);
      return {
        kind: "single",
        signer,
        account: opts.account,
      } as ResolvedSigner;
    }

    // Multisig: find local members
    const config = opts.account.multisigConfig;
    const signerAddrs = new Set(config.signers);
    const localAccounts = yield* accounts.list();
    const candidates = localAccounts.filter(
      (a): a is AccountInfo & { kind: "single" } =>
        a.kind === "single" && signerAddrs.has(a.fastAddress),
    );

    if (candidates.length === 0) {
      return yield* Effect.fail(
        new NotAMemberError({ walletName: opts.account.name }),
      );
    }

    let chosen: AccountInfo & { kind: "single" };
    if (opts.asMember) {
      const found = candidates.find((c) => c.name === opts.asMember);
      if (!found) {
        return yield* Effect.fail(
          new AmbiguousMemberError({
            walletName: opts.account.name,
            candidates: candidates.map((c) => c.name),
          }),
        );
      }
      chosen = found;
    } else if (candidates.length > 1) {
      return yield* Effect.fail(
        new AmbiguousMemberError({
          walletName: opts.account.name,
          candidates: candidates.map((c) => c.name),
        }),
      );
    } else {
      chosen = candidates[0]!;
    }

    const { seed } = yield* accounts.export(chosen.name, opts.password);
    // Construct the on-wire MultiSigConfig (BCS shape) from the wallet
    // config's bech32 signers + decimal-string nonce/quorum.
    const signer = new MultiSigSigner({
      config: {
        authorized_signers: config.signers.map((s) => fromFastAddress(s)),
        quorum: BigInt(config.quorum),
        nonce: BigInt(config.configNonce),
      },
      secretKey: seed,
    });

    return {
      kind: "multisig",
      signer,
      account: opts.account,
      memberAccount: chosen,
    } as ResolvedSigner;
  });
```

- [ ] **Step 4: Verify tests pass**

```bash
cd app/cli && pnpm exec vitest run tests/unit/signer-resolver.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/cli/src/services/signer-resolver.ts \
        app/cli/tests/unit/signer-resolver.test.ts
git commit -m "feat(cli): signer-resolver maps account row to Signer or MultiSigSigner"
```

---

## Task 12: CLI — `multisig init` command

**Files:**

- Create: `app/cli/src/commands/multisig/init.ts`
- Create: `app/cli/src/commands/multisig/index.ts`
- Modify: `app/cli/src/cli.ts` (parser)
- Modify: `app/cli/src/main.ts` (dispatch)

`fast multisig init --signers a,b,c --quorum 2 --config-nonce 0 --name treasury`
derives the address, inserts the row.

- [ ] **Step 1: Add the parser to cli.ts**

In [app/cli/src/cli.ts](../../app/cli/src/cli.ts), add (placement: alongside other groups):

```ts
const multisigInitParser = command(
  "init",
  object({
    cmd: constant("multisig-init" as const),
    signers: option("--signers", string({ metavar: "ADDR_OR_NAME,..." }), {
      description: message`Comma-separated bech32 addresses or local account names`,
    }),
    quorum: option("--quorum", integer({ metavar: "N" })),
    configNonce: option("--config-nonce", string({ metavar: "U64" })),
    name: option("--name", string({ metavar: "ALIAS" })),
    network: optional(option("--network", string({ metavar: "NAME" }))),
    setDefault: withDefault(option("--set-default"), false),
  }),
  { description: message`Create a multisig wallet config` },
);

const multisigGroup = command(
  "multisig",
  or(
    multisigInitParser,
    // future: import, export, pending, vote
  ),
  { description: message`Multisig wallet operations` },
);
```

Add `multisigGroup` to the top-level `or(...)` of subcommands. Also add
`MultisigInitArgs = InferValue<typeof multisigInitParser>` export.

- [ ] **Step 2: Implement the command**

Create `app/cli/src/commands/multisig/init.ts`:

```ts
import { deriveMultiSigAddress, fromFastAddress } from "@fastxyz/sdk";
import { Effect, Schema } from "effect";
import type { MultisigInitArgs } from "../../cli.js";
import {
  AccountNotFoundError,
  MultiSigConfigInvalidError,
} from "../../errors/index.js";
import { MultiSigWalletConfigSchema } from "../../schemas/multisig-wallet.js";
import { ClientConfig } from "../../services/config/client.js";
import { Output } from "../../services/output.js";
import { AccountStore } from "../../services/storage/account.js";
import { NetworkConfigService } from "../../services/storage/network.js";
import type { Command } from "../index.js";

export const multisigInit: Command<MultisigInitArgs> = {
  cmd: "multisig-init",
  handler: (args) =>
    Effect.gen(function* () {
      const accounts = yield* AccountStore;
      const networks = yield* NetworkConfigService;
      const config = yield* ClientConfig;
      const output = yield* Output;

      // Resolve each --signers entry: either a fast1... address or a
      // local account name.
      const allLocal = yield* accounts.list();
      const localByName = new Map(allLocal.map((a) => [a.name, a]));
      const signerEntries = args.signers
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      const resolvedSigners: string[] = [];
      for (const entry of signerEntries) {
        if (entry.startsWith("fast1")) {
          resolvedSigners.push(entry);
        } else {
          const local = localByName.get(entry);
          if (!local) {
            return yield* Effect.fail(new AccountNotFoundError({ name: entry }));
          }
          resolvedSigners.push(local.fastAddress);
        }
      }

      // Sort lexicographically (canonical form) and dedupe-check.
      const sortedSigners = [...resolvedSigners].sort();
      if (new Set(sortedSigners).size !== sortedSigners.length) {
        return yield* Effect.fail(
          new MultiSigConfigInvalidError({ reason: "duplicate signers" }),
        );
      }

      const network = yield* networks.resolve(args.network ?? config.network);
      const networkName = args.network ?? config.network;

      // Derive the multisig fast address.
      const fastAddress = yield* Effect.tryPromise({
        try: () =>
          deriveMultiSigAddress({
            authorized_signers: sortedSigners.map((s) => fromFastAddress(s)),
            quorum: BigInt(args.quorum),
            nonce: BigInt(args.configNonce),
          }),
        catch: (cause) =>
          new MultiSigConfigInvalidError({ reason: String(cause) }),
      });

      // Validate via the schema (catches quorum bounds etc.).
      const walletConfig = yield* Schema.decodeUnknown(MultiSigWalletConfigSchema)({
        version: 1 as const,
        name: args.name,
        signers: sortedSigners,
        quorum: args.quorum,
        configNonce: args.configNonce,
        fastAddress,
        network: networkName,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new MultiSigConfigInvalidError({ reason: String(cause) }),
        ),
      );

      const created = yield* accounts.createMultiSig(walletConfig, args.setDefault);

      yield* output.humanLine(`Created multisig wallet "${walletConfig.name}".`);
      yield* output.humanLine(`  Fast address: ${fastAddress}`);
      yield* output.humanLine(`  Quorum:       ${args.quorum} of ${sortedSigners.length}`);
      yield* output.humanLine(`  Network:      ${networkName}`);
      yield* output.ok({
        name: walletConfig.name,
        fastAddress,
        quorum: args.quorum,
        signers: sortedSigners,
        configNonce: args.configNonce,
        network: networkName,
        isDefault: created.isDefault,
      });
      // Suppress unused var warning while network resolution stays at boundary
      void network;
    }),
};
```

Create `app/cli/src/commands/multisig/index.ts`:

```ts
export { multisigInit } from "./init.js";
```

- [ ] **Step 3: Wire into main.ts dispatch**

Add to the dispatch switch in [app/cli/src/main.ts](../../app/cli/src/main.ts):

```ts
case "multisig-init":
  return multisigInit.handler(args);
```

Add the import.

- [ ] **Step 4: Smoke test the command**

Build and run:

```bash
pnpm build
pnpm cli multisig init \
  --signers fast1aaaaa,fast1bbbbb \
  --quorum 2 --config-nonce 0 --name treasury
```

Inspect with:

```bash
pnpm cli account list
```

Expected: `treasury` shown with kind=multisig (display update is in
Task 19, but the row exists in the DB now).

- [ ] **Step 5: Commit**

```bash
git add app/cli/src/commands/multisig/init.ts \
        app/cli/src/commands/multisig/index.ts \
        app/cli/src/cli.ts app/cli/src/main.ts
git commit -m "feat(cli): multisig init command"
```

---

## Task 13: CLI — `multisig export` command

**Files:**

- Create: `app/cli/src/commands/multisig/export.ts`
- Modify: `app/cli/src/commands/multisig/index.ts`
- Modify: `app/cli/src/cli.ts`
- Modify: `app/cli/src/main.ts`

- [ ] **Step 1: Add parser**

In `cli.ts`:

```ts
const multisigExportParser = command(
  "export",
  object({
    cmd: constant("multisig-export" as const),
    name: argument(string({ metavar: "NAME" })),
    out: optional(option("--out", string({ metavar: "PATH" }))),
  }),
  { description: message`Export a multisig wallet config as JSON` },
);
```

Add to the `multisigGroup` `or(...)`.

- [ ] **Step 2: Implement**

Create `app/cli/src/commands/multisig/export.ts`:

```ts
import { Effect } from "effect";
import { writeFileSync } from "node:fs";
import type { MultisigExportArgs } from "../../cli.js";
import { WalletKindMismatchError } from "../../errors/index.js";
import { stringifyMultiSigWalletConfig } from "../../schemas/multisig-wallet.js";
import { Output } from "../../services/output.js";
import { AccountStore } from "../../services/storage/account.js";
import type { Command } from "../index.js";

export const multisigExport: Command<MultisigExportArgs> = {
  cmd: "multisig-export",
  handler: (args) =>
    Effect.gen(function* () {
      const accounts = yield* AccountStore;
      const output = yield* Output;
      const account = yield* accounts.get(args.name);
      if (account.kind !== "multisig") {
        return yield* Effect.fail(
          new WalletKindMismatchError({
            name: args.name,
            expected: "multisig",
            hint: 'Use "fast account export" for single-signer accounts.',
          }),
        );
      }
      const json = stringifyMultiSigWalletConfig(account.multisigConfig);
      if (args.out) {
        writeFileSync(args.out, json + "\n");
        yield* output.humanLine(`Wrote ${args.out}`);
        yield* output.ok({ path: args.out });
      } else {
        yield* output.humanLine(json);
        yield* output.ok(account.multisigConfig);
      }
    }),
};
```

Update `multisig/index.ts`:

```ts
export { multisigInit } from "./init.js";
export { multisigExport } from "./export.js";
```

Wire `multisig-export` case into `main.ts`.

- [ ] **Step 3: Smoke test**

```bash
pnpm build
pnpm cli multisig export treasury
pnpm cli multisig export treasury --out /tmp/treasury.json
cat /tmp/treasury.json
```

Expected: same canonical JSON in both invocations.

- [ ] **Step 4: Commit**

```bash
git add app/cli/src/commands/multisig/export.ts \
        app/cli/src/commands/multisig/index.ts \
        app/cli/src/cli.ts app/cli/src/main.ts
git commit -m "feat(cli): multisig export command"
```

---

## Task 14: CLI — `multisig import` command

**Files:**

- Create: `app/cli/src/commands/multisig/import.ts`
- Modify: `app/cli/src/commands/multisig/index.ts`
- Modify: `app/cli/src/cli.ts`
- Modify: `app/cli/src/main.ts`

Two input modes:

1. `--from <file.json>` — load + validate (recompute address must match
   `fastAddress` field).
2. Explicit `--signers --quorum --config-nonce` (with optional
   `--expect-address`) — symmetric with `init` but does not derive a
   default name; `--name` is required.

- [ ] **Step 1: Add parser**

In `cli.ts`:

```ts
const multisigImportParser = command(
  "import",
  merge(
    object({
      cmd: constant("multisig-import" as const),
      name: optional(option("--name", string({ metavar: "ALIAS" }))),
      network: optional(option("--network", string({ metavar: "NAME" }))),
      setDefault: withDefault(option("--set-default"), false),
    }),
    or(
      object({
        from: option("--from", string({ metavar: "FILE" })),
      }),
      object({
        signers: option("--signers", string({ metavar: "ADDR,..." })),
        quorum: option("--quorum", integer({ metavar: "N" })),
        configNonce: option("--config-nonce", string({ metavar: "U64" })),
        expectAddress: optional(option("--expect-address", string({ metavar: "ADDR" }))),
      }),
    ),
  ),
  { description: message`Import an existing multisig wallet` },
);
```

Add to `multisigGroup`.

- [ ] **Step 2: Implement**

Create `app/cli/src/commands/multisig/import.ts`:

```ts
import { deriveMultiSigAddress, fromFastAddress } from "@fastxyz/sdk";
import { Effect, Schema } from "effect";
import { readFileSync } from "node:fs";
import type { MultisigImportArgs } from "../../cli.js";
import {
  AddressDerivationMismatchError,
  InvalidUsageError,
  MultiSigConfigInvalidError,
} from "../../errors/index.js";
import {
  MultiSigWalletConfigSchema,
  parseMultiSigWalletConfig,
} from "../../schemas/multisig-wallet.js";
import { ClientConfig } from "../../services/config/client.js";
import { Output } from "../../services/output.js";
import { AccountStore } from "../../services/storage/account.js";
import type { Command } from "../index.js";

export const multisigImport: Command<MultisigImportArgs> = {
  cmd: "multisig-import",
  handler: (args) =>
    Effect.gen(function* () {
      const accounts = yield* AccountStore;
      const config = yield* ClientConfig;
      const output = yield* Output;

      const walletConfig = yield* "from" in args && args.from
        ? Effect.gen(function* () {
            const raw = readFileSync(args.from, "utf8");
            const parsed = yield* parseMultiSigWalletConfig(raw).pipe(
              Effect.mapError(
                (cause) =>
                  new MultiSigConfigInvalidError({ reason: String(cause) }),
              ),
            );
            // Verify the address derives correctly.
            const derived = yield* Effect.tryPromise({
              try: () =>
                deriveMultiSigAddress({
                  authorized_signers: parsed.signers.map((s) =>
                    fromFastAddress(s),
                  ),
                  quorum: BigInt(parsed.quorum),
                  nonce: BigInt(parsed.configNonce),
                }),
              catch: (cause) =>
                new MultiSigConfigInvalidError({ reason: String(cause) }),
            });
            if (derived !== parsed.fastAddress) {
              return yield* Effect.fail(
                new AddressDerivationMismatchError({
                  expected: parsed.fastAddress,
                  derived,
                }),
              );
            }
            const finalName = args.name ?? parsed.name;
            const finalNetwork = args.network ?? parsed.network;
            return { ...parsed, name: finalName, network: finalNetwork };
          })
        : Effect.gen(function* () {
            if (!args.name) {
              return yield* Effect.fail(
                new InvalidUsageError({
                  message: "--name is required when not using --from",
                }),
              );
            }
            const sortedSigners = args.signers
              .split(",")
              .map((s) => s.trim())
              .sort();
            const derived = yield* Effect.tryPromise({
              try: () =>
                deriveMultiSigAddress({
                  authorized_signers: sortedSigners.map((s) =>
                    fromFastAddress(s),
                  ),
                  quorum: BigInt(args.quorum),
                  nonce: BigInt(args.configNonce),
                }),
              catch: (cause) =>
                new MultiSigConfigInvalidError({ reason: String(cause) }),
            });
            if (args.expectAddress && args.expectAddress !== derived) {
              return yield* Effect.fail(
                new AddressDerivationMismatchError({
                  expected: args.expectAddress,
                  derived,
                }),
              );
            }
            const candidate = {
              version: 1 as const,
              name: args.name,
              signers: sortedSigners,
              quorum: args.quorum,
              configNonce: args.configNonce,
              fastAddress: derived,
              network: args.network ?? config.network,
            };
            return yield* Schema.decodeUnknown(MultiSigWalletConfigSchema)(
              candidate,
            ).pipe(
              Effect.mapError(
                (cause) =>
                  new MultiSigConfigInvalidError({ reason: String(cause) }),
              ),
            );
          });

      const created = yield* accounts.createMultiSig(walletConfig, args.setDefault);

      yield* output.humanLine(`Imported multisig wallet "${walletConfig.name}".`);
      yield* output.humanLine(`  Fast address: ${walletConfig.fastAddress}`);
      yield* output.humanLine(`  Quorum:       ${walletConfig.quorum} of ${walletConfig.signers.length}`);
      yield* output.ok({
        name: walletConfig.name,
        fastAddress: walletConfig.fastAddress,
        quorum: walletConfig.quorum,
        signers: walletConfig.signers,
        configNonce: walletConfig.configNonce,
        network: walletConfig.network,
        isDefault: created.isDefault,
      });
    }),
};
```

Update `multisig/index.ts` and `main.ts` dispatch.

- [ ] **Step 3: Smoke test the round-trip**

```bash
pnpm cli multisig export treasury --out /tmp/treasury.json
pnpm cli account delete treasury
pnpm cli multisig import --from /tmp/treasury.json
pnpm cli account list
```

Expected: `treasury` re-appears identically.

Test the explicit-flags path:

```bash
pnpm cli multisig import \
  --signers fast1aaaaa,fast1bbbbb \
  --quorum 2 --config-nonce 0 --name backup
```

Test mismatch rejection by hand-editing the JSON file's `fastAddress`
field and re-importing. Expected: `AddressDerivationMismatchError`.

- [ ] **Step 4: Commit**

```bash
git add app/cli/src/commands/multisig/import.ts \
        app/cli/src/commands/multisig/index.ts \
        app/cli/src/cli.ts app/cli/src/main.ts
git commit -m "feat(cli): multisig import command"
```

---

## Task 15: CLI — FastRpc wrapper for getPendingMultisigTransactions

**Files:**

- Modify: `app/cli/src/services/api/fast.ts`

The SDK's [FastProvider.getPendingMultisigTransactions](../../packages/fast-sdk/src/interface/provider.ts#L115)
already exists; the CLI's `FastRpc` service needs to expose it.

- [ ] **Step 1: Add to FastRpc**

In `app/cli/src/services/api/fast.ts`, add a method that proxies to the
provider's `getPendingMultisigTransactions`. Pattern: follow the same
shape as `getAccountInfo` etc. Read the file's existing helpers and
copy the pattern.

```ts
// inside the FastRpc service factory
getPendingMultisigTransactions: (params: GetPendingMultisigInputParams) =>
  Effect.tryPromise({
    try: () => provider.getPendingMultisigTransactions(params),
    catch: (cause) =>
      new FastSdkError({
        message: "getPendingMultisigTransactions failed",
        cause,
      }),
  }),
```

Add the input type to imports.

- [ ] **Step 2: Verify the project still builds**

```bash
pnpm --filter @fastxyz/cli build
```

Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add app/cli/src/services/api/fast.ts
git commit -m "feat(cli): FastRpc.getPendingMultisigTransactions"
```

---

## Task 16: CLI — `multisig pending` command

**Files:**

- Create: `app/cli/src/commands/multisig/pending.ts`
- Modify: `app/cli/src/commands/multisig/index.ts`
- Modify: `app/cli/src/cli.ts`
- Modify: `app/cli/src/main.ts`

- [ ] **Step 1: Add parser**

```ts
const multisigPendingParser = command(
  "pending",
  object({
    cmd: constant("multisig-pending" as const),
    asMember: optional(option("--as", string({ metavar: "NAME" }))),
  }),
  { description: message`List pending multisig transactions for the active wallet` },
);
```

Add to `multisigGroup`.

- [ ] **Step 2: Implement**

Create `app/cli/src/commands/multisig/pending.ts`:

```ts
import { fromFastAddress, toFastAddress, toHex } from "@fastxyz/sdk";
import { Effect } from "effect";
import type { MultisigPendingArgs } from "../../cli.js";
import { WalletKindMismatchError } from "../../errors/index.js";
import { FastRpc } from "../../services/api/fast.js";
import { ClientConfig } from "../../services/config/client.js";
import { Output } from "../../services/output.js";
import { AccountStore } from "../../services/storage/account.js";
import type { Command } from "../index.js";

const truncAddr = (addr: string) =>
  addr.length > 18 ? `${addr.slice(0, 10)}…${addr.slice(-4)}` : addr;

export const multisigPending: Command<MultisigPendingArgs> = {
  cmd: "multisig-pending",
  handler: (args) =>
    Effect.gen(function* () {
      const accounts = yield* AccountStore;
      const rpc = yield* FastRpc;
      const config = yield* ClientConfig;
      const output = yield* Output;

      const account = yield* accounts.resolveAccount(config.account);
      if (account.kind !== "multisig") {
        return yield* Effect.fail(
          new WalletKindMismatchError({
            name: account.name,
            expected: "multisig",
          }),
        );
      }

      const addressBytes = fromFastAddress(account.fastAddress);
      const pending = yield* rpc.getPendingMultisigTransactions({
        address: addressBytes,
      } as never);

      // Render. The exact response shape comes from the SDK's
      // GetPendingMultisigInput type — implementer should adapt to
      // the actual fields. Pseudo-code:
      const localByAddr = new Map(
        (yield* accounts.list()).map((a) => [a.fastAddress, a.name]),
      );
      const myMember = args.asMember
        ? (yield* accounts.get(args.asMember))
        : null;
      const myPubkey =
        myMember && myMember.kind === "single"
          ? // re-derive pubkey from the member's fast address
            fromFastAddress(myMember.fastAddress)
          : null;

      const list = pending as unknown as Array<{
        transactionHash: Uint8Array;
        signatures: Array<[Uint8Array, Uint8Array]>;
        nonce: bigint;
      }>;

      if (list.length === 0) {
        yield* output.humanLine("No pending multisig transactions.");
        yield* output.ok({ pending: [] });
        return;
      }

      for (const tx of list) {
        const signedBy = new Set(tx.signatures.map(([pk]) => toHex(pk)));
        const sortedSigners = [...account.multisigConfig.signers].sort();
        const grid = sortedSigners.map((s) => {
          const pkHex = toHex(fromFastAddress(s));
          const tick = signedBy.has(pkHex) ? "✓" : "✗";
          const label = localByAddr.get(s) ?? truncAddr(s);
          return `  ${tick} ${label}`;
        });
        yield* output.humanLine(`Tx ${toHex(tx.transactionHash)}`);
        yield* output.humanLine(`  Nonce: ${tx.nonce}`);
        yield* output.humanLine(`  Signed: ${signedBy.size}/${account.multisigConfig.quorum}`);
        for (const row of grid) yield* output.humanLine(row);
        if (myPubkey) {
          const youSigned = signedBy.has(toHex(myPubkey));
          yield* output.humanLine(
            `  Your vote: ${youSigned ? "submitted" : "still required"}`,
          );
        }
        yield* output.humanLine("");
      }

      yield* output.ok({
        pending: list.map((tx) => ({
          hash: toHex(tx.transactionHash),
          nonce: tx.nonce.toString(),
          signedCount: tx.signatures.length,
          quorum: account.multisigConfig.quorum,
        })),
      });
    }),
};
```

> Implementer note: `getPendingMultisigTransactions` response shape may
> differ from the pseudo-shape above. Read the actual return type from
> [packages/fast-sdk/src/interface/provider.ts:115](../../packages/fast-sdk/src/interface/provider.ts#L115)
> and adjust field names. The pattern (signatures grid + "have you signed")
> stays the same.

Update `multisig/index.ts` and `main.ts`.

- [ ] **Step 3: Smoke test against a node with pending tx**

This requires either a live node or an integration setup with a
fixtured pending tx. Defer to the integration test in Task 21; a
manual run against testnet can confirm end-to-end:

```bash
pnpm cli multisig pending --account treasury
```

Expected: empty list immediately after creation; populated after
running `send` from another cosigner (Task 17 + Task 18 unblock this).

- [ ] **Step 4: Commit**

```bash
git add app/cli/src/commands/multisig/pending.ts \
        app/cli/src/commands/multisig/index.ts \
        app/cli/src/cli.ts app/cli/src/main.ts
git commit -m "feat(cli): multisig pending command"
```

---

## Task 17: CLI — `multisig vote` command

**Files:**

- Create: `app/cli/src/commands/multisig/vote.ts`
- Modify: `app/cli/src/commands/multisig/index.ts`
- Modify: `app/cli/src/cli.ts`
- Modify: `app/cli/src/main.ts`

- [ ] **Step 1: Add parser**

```ts
const multisigVoteParser = command(
  "vote",
  object({
    cmd: constant("multisig-vote" as const),
    tx: optional(option("--tx", string({ metavar: "HASH" }))),
    asMember: optional(option("--as", string({ metavar: "NAME" }))),
    yes: withDefault(option("--yes"), false),
  }),
  { description: message`Sign a pending multisig transaction` },
);
```

Add to `multisigGroup`.

- [ ] **Step 2: Implement**

Create `app/cli/src/commands/multisig/vote.ts`:

```ts
import { fromHex, toHex } from "@fastxyz/sdk";
import { Effect } from "effect";
import type { MultisigVoteArgs } from "../../cli.js";
import {
  AlreadyVotedError,
  InvalidUsageError,
  WalletKindMismatchError,
} from "../../errors/index.js";
import { FastRpc } from "../../services/api/fast.js";
import { ClientConfig } from "../../services/config/client.js";
import { Output } from "../../services/output.js";
import { Prompt } from "../../services/prompt.js";
import { resolveSigner } from "../../services/signer-resolver.js";
import { AccountStore } from "../../services/storage/account.js";
import type { Command } from "../index.js";

export const multisigVote: Command<MultisigVoteArgs> = {
  cmd: "multisig-vote",
  handler: (args) =>
    Effect.gen(function* () {
      const accounts = yield* AccountStore;
      const rpc = yield* FastRpc;
      const config = yield* ClientConfig;
      const output = yield* Output;
      const prompt = yield* Prompt;

      const account = yield* accounts.resolveAccount(config.account);
      if (account.kind !== "multisig") {
        return yield* Effect.fail(
          new WalletKindMismatchError({
            name: account.name,
            expected: "multisig",
          }),
        );
      }

      const pending = (yield* rpc.getPendingMultisigTransactions({
        address: fromHex(`0x${account.fastAddress}`), // adapt: use fromFastAddress
      } as never)) as unknown as Array<{
        transaction: unknown; // VersionedTransaction
        transactionHash: Uint8Array;
        signatures: Array<[Uint8Array, Uint8Array]>;
      }>;

      if (pending.length === 0) {
        yield* output.humanLine("No pending transactions to vote on.");
        return;
      }

      let target: typeof pending[0];
      if (args.tx) {
        const want = args.tx.startsWith("0x") ? args.tx.slice(2) : args.tx;
        const found = pending.find(
          (p) => toHex(p.transactionHash).slice(2) === want,
        );
        if (!found) {
          return yield* Effect.fail(
            new InvalidUsageError({
              message: `pending transaction ${args.tx} not found`,
            }),
          );
        }
        target = found;
      } else if (pending.length === 1) {
        target = pending[0]!;
      } else {
        return yield* Effect.fail(
          new InvalidUsageError({
            message: `${pending.length} pending transactions; pass --tx <hash> to choose one`,
          }),
        );
      }

      // Resolve signer for this multisig as the chosen member
      const password = yield* (account.kind === "multisig"
        ? prompt.password()
        : Effect.succeed(null));
      const resolved = yield* resolveSigner({
        account,
        asMember: args.asMember,
        password,
      });
      if (resolved.kind !== "multisig") {
        return yield* Effect.fail(
          new WalletKindMismatchError({
            name: account.name,
            expected: "multisig",
          }),
        );
      }
      const myPub = await resolved.signer.getSignerPublicKey();
      const alreadySigned = target.signatures.some(
        ([pk]) => toHex(pk) === toHex(myPub),
      );
      if (alreadySigned) {
        return yield* Effect.fail(
          new AlreadyVotedError({
            walletName: account.name,
            txHash: toHex(target.transactionHash),
          }),
        );
      }

      // Display + confirm
      yield* output.humanLine(`About to sign tx ${toHex(target.transactionHash)} on "${account.name}"`);
      if (!config.nonInteractive && !config.json && !args.yes) {
        const ok = yield* prompt.confirm("Confirm?");
        if (!ok) return;
      }

      const envelope = yield* Effect.tryPromise({
        try: () => resolved.signer.signEnvelopeFor(target.transaction as never),
        catch: (cause) => ({ _tag: "SignError", cause }),
      });

      yield* rpc.submitTransaction(envelope as never);

      yield* output.humanLine(`Vote submitted.`);
      yield* output.ok({
        txHash: toHex(target.transactionHash),
        wallet: account.name,
        signedAs: resolved.memberAccount.name,
      });
    }),
};
```

> Adapt the response-type pseudo-shape to the actual SDK return type
> (read [packages/fast-sdk/src/interface/provider.ts:115](../../packages/fast-sdk/src/interface/provider.ts#L115)
> for the real `transaction` and `signatures` field names).

Update `multisig/index.ts` and `main.ts`.

- [ ] **Step 3: Build to verify**

```bash
pnpm --filter @fastxyz/cli build
```

Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add app/cli/src/commands/multisig/vote.ts \
        app/cli/src/commands/multisig/index.ts \
        app/cli/src/cli.ts app/cli/src/main.ts
git commit -m "feat(cli): multisig vote command"
```

---

## Task 18: CLI — Polymorphic `send`

**Files:**

- Modify: `app/cli/src/commands/send.ts`

The Fast→Fast branch of `send` (line ~294 in current send.ts) currently
constructs a `Signer` directly. Refactor to route through
`resolveSigner` so it works for either kind. EVM-bridging branches
remain single-signer-only (EVM bridge requires a private key).

- [ ] **Step 1: Refactor the Fast→Fast branch**

In [app/cli/src/commands/send.ts](../../app/cli/src/commands/send.ts),
locate the `else { // ── Fast → Fast` branch (around line 294). Replace
the `const signer = new Signer(seed)` plus `TransactionBuilder` usage
with a polymorphic dispatch:

```ts
} else {
  // ── Fast → Fast ─────────────────────────────────────────────────────
  const resolved = yield* resolveSigner({
    account: accountInfo,
    asMember: args.as,
    password: pwd,
  });

  // Build operation
  const recipientBytes = new Uint8Array(
    bech32m.fromWords(bech32m.decode(args.address).words),
  );
  const operation = {
    type: "TokenTransfer" as const,
    value: {
      tokenId: tokenInfo.fastTokenId,
      recipient: recipientBytes,
      amount: amountRaw,
      userData: null,
    },
  };

  let envelope: TransactionEnvelope;
  if (resolved.kind === "single") {
    const accountInfoRpc = yield* rpc.getAccountInfo({
      address: await resolved.signer.getPublicKey(),
      tokenBalancesFilter: null,
      stateKeyFilter: null,
      certificateByNonce: null,
    } as never);
    const nonce = (accountInfoRpc as any)?.nextNonce ?? 0n;
    envelope = yield* Effect.tryPromise({
      try: () =>
        new TransactionBuilder({
          networkId: network.networkId as any,
          signer: resolved.signer,
          nonce,
        })
          .addTokenTransfer(operation.value)
          .sign(),
      catch: (cause) =>
        new TransactionFailedError({
          message: "Failed to build transaction",
          cause,
        }),
    });
  } else {
    const senderBytes = await resolved.signer.getDerivedAddressBytes();
    const accountInfoRpc = yield* rpc.getAccountInfo({
      address: senderBytes,
      tokenBalancesFilter: null,
      stateKeyFilter: null,
      certificateByNonce: null,
    } as never);
    const nonce = (accountInfoRpc as any)?.nextNonce ?? 0n;
    envelope = yield* Effect.tryPromise({
      try: () =>
        resolved.signer.signTransaction({
          networkId: network.networkId as any,
          nonce,
          operations: [operation],
        }),
      catch: (cause) =>
        new TransactionFailedError({
          message: "Failed to sign multisig transaction",
          cause,
        }),
    });
  }

  // Submit
  const submitResult = yield* rpc.submitTransaction(envelope);

  // Branch on result type
  if (submitResult && (submitResult as any).type === "IncompleteMultiSig") {
    yield* output.humanLine(
      `Submitted as multisig partial: 1/${(resolved.kind === "multisig" ? resolved.account.multisigConfig.quorum : 1)} signatures collected.`,
    );
    yield* output.humanLine(
      `Cosigners can run \`fast multisig pending\` to view, \`fast multisig vote\` to sign.`,
    );
    yield* output.ok({
      status: "incomplete-multisig",
      wallet: accountInfo.name,
    });
    return;
  }

  // Otherwise compute hash and record (existing path)
  // ... (keep existing hash + history record code)
}
```

> Note: the actual `submitResult` type discriminator may be different —
> read [packages/fast-sdk/src/core/proxy.ts](../../packages/fast-sdk/src/core/proxy.ts)
> to confirm. Adapt the `if (... === "IncompleteMultiSig")` check.

Add `--as` flag to the send parser in `cli.ts` (it currently has only
`--account`):

```ts
// in send parser object():
as: optional(option("--as", string({ metavar: "NAME" }))),
```

- [ ] **Step 2: Build + smoke test**

```bash
pnpm --filter @fastxyz/cli build
pnpm cli send fast1xxxx... 1 --account alice    # single-signer (existing)
pnpm cli send fast1xxxx... 1 --account treasury # multisig: prints "incomplete-multisig"
```

Expected: single-signer path unchanged; multisig path emits the partial
submission message.

- [ ] **Step 3: Commit**

```bash
git add app/cli/src/commands/send.ts app/cli/src/cli.ts
git commit -m "feat(cli): polymorphic send for single + multisig"
```

---

## Task 19: CLI — `account list` shows kind

**Files:**

- Modify: `app/cli/src/commands/account/list.ts`

- [ ] **Step 1: Read existing list command**

```bash
cat app/cli/src/commands/account/list.ts
```

It currently renders a table with columns `Name | Fast Address | EVM
Address | Default`. Add a `Kind` column.

- [ ] **Step 2: Update render**

Modify the table construction to include a `Kind` column. For
`account.kind === "multisig"`, render `multisig N-of-M` where N is
`quorum` and M is `signers.length`. For `kind === "single"`, render
`single` (or just leave the EVM address). Multisig rows have no EVM
address — render `—`.

- [ ] **Step 3: Smoke test**

```bash
pnpm cli account create --name alice
pnpm cli multisig init --signers alice,fast1bbbbb --quorum 2 --config-nonce 0 --name treasury
pnpm cli account list
```

Expected: two rows; treasury shows `multisig 2-of-2`, no EVM address.

- [ ] **Step 4: Commit**

```bash
git add app/cli/src/commands/account/list.ts
git commit -m "feat(cli): account list shows multisig kind"
```

---

## Task 20: CLI — Final wiring sanity check

**Files:** none new; verification step.

- [ ] **Step 1: Verify all commands appear in `--help`**

```bash
pnpm build
pnpm cli --help
pnpm cli multisig --help
pnpm cli multisig init --help
pnpm cli multisig export --help
pnpm cli multisig import --help
pnpm cli multisig pending --help
pnpm cli multisig vote --help
```

Expected: each prints its own help text without parser errors.

- [ ] **Step 2: Run full test suite**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 3: Commit (if any wiring fixes were needed)**

```bash
git add -p
git commit -m "fix(cli): wiring fixes for multisig commands"
```

If nothing changed, skip the commit.

---

## Task 21: Integration test — 2-of-3 happy path

**Files:**

- Create: `app/cli/tests/integration/multisig-happy-path.test.ts`

This test stands up a temporary `~/.fast` directory, pre-populates three
single-signer keystores, creates a multisig wallet, simulates the
proxy interaction with stubs, and verifies the end-to-end flow.

The proxy interaction can be stubbed at the `FastRpc` service boundary
(replace `submitTransaction` and `getPendingMultisigTransactions` with
in-memory state).

- [ ] **Step 1: Write the integration test**

```ts
import { describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
// ... set up an in-memory FastRpc that:
//   - submitTransaction first call: returns IncompleteMultiSig, stores tx
//   - getPendingMultisigTransactions: returns the stored tx with
//     accumulated signatures
//   - submitTransaction second call (vote): aggregates and returns Success
//
// Use AccountStore + signer-resolver as before.

describe("multisig 2-of-3 happy path", () => {
  it("init → send → vote → success", async () => {
    // 1. Create three single-signer accounts: alice, bob, carol
    // 2. multisig init --signers alice,bob,carol --quorum 2 --name treasury
    // 3. send 100 tokens from treasury (initiator: alice)
    //    → expect IncompleteMultiSig response
    // 4. vote on the pending tx (--as bob)
    //    → expect Success response
    // 5. assert: history table has the success cert; no second
    //    pending tx remains
  });

  it("vote refuses double-sign", async () => {
    // After alice initiates, alice runs vote --as alice
    // → expect AlreadyVotedError
  });

  it("send against multisig with no local member key fails clearly", async () => {
    // multisig with [stranger1, stranger2] (no local key holders)
    // send from this multisig → NotAMemberError
  });
});
```

The implementer should flesh out the test with the actual stubs.
Reference: [app/cli/tests/unit/account-store-multisig.test.ts](../../app/cli/tests/unit/account-store-multisig.test.ts)
for layer construction, and the existing fast-sdk integration tests
([packages/fast-sdk/tests/integration/](../../packages/fast-sdk/tests/integration/))
for the FastRpc-stub pattern.

- [ ] **Step 2: Run the integration test**

```bash
cd app/cli && pnpm exec vitest run tests/integration/
```

Expected: all three cases pass.

- [ ] **Step 3: Commit**

```bash
git add app/cli/tests/integration/multisig-happy-path.test.ts
git commit -m "test(cli): multisig 2-of-3 integration happy path"
```

---

## Done

At this point Phase 1 is complete: a working N-of-M multisig wallet
end-to-end using `fast multisig init/import/export/pending/vote` and
`fast send`.

**Next:** Write a Phase 2 plan for token operations (`fast token
create/mint/burn/manage`). Each is a thin operation builder reusing
`signer-resolver` and the polymorphic dispatch shape established in
Task 18.
