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
