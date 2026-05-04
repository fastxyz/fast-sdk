/**
 * Compile-only checks for TransactionBuilder<V> type narrowing.
 * The body of these "tests" never executes — the assertions are entirely
 * at the TypeScript layer via @ts-expect-error.
 *
 * `tsc --noEmit` running over the tests directory verifies the
 * @ts-expect-error comments are satisfied. vitest's runtime sees them
 * as no-ops because the test bodies don't await/throw.
 */
import { describe, it } from "vitest";
import { TransactionBuilder } from "../src/interface/transaction.ts";
import type { Signer } from "../src/interface/signer.ts";

const signer = {} as Signer;
const nonce = 0n;
const networkId = "fast:testnet" as const;

describe("TransactionBuilder<V> type narrowing (compile-time)", () => {
  it("Release20260319 builder rejects addEscrow at compile time", () => {
    const builder = new TransactionBuilder({
      version: "Release20260319",
      networkId,
      signer,
      nonce,
    });
    // @ts-expect-error — addEscrow narrows to never on TransactionBuilder<'Release20260319'>
    builder.addEscrow({} as never);
  });

  it("Release20260407 builder accepts addEscrow at compile time", () => {
    const builder = new TransactionBuilder({
      version: "Release20260407",
      networkId,
      signer,
      nonce,
    });
    // No @ts-expect-error — should compile cleanly:
    builder.addEscrow({} as never);
  });

  it("default version (no version param) defaults to latest and supports Escrow", () => {
    const builder = new TransactionBuilder({ networkId, signer, nonce });
    // No @ts-expect-error — default V = LatestTransactionVersion:
    builder.addEscrow({} as never);
  });
});
