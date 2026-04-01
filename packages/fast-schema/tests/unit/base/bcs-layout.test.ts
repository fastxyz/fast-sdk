import { describe, expect, it } from "vitest";
import { bcsSchema } from "../../../src/index.ts";

describe("BCS layout primitives", () => {
  it("PublicKeyBytes: serialize/parse 32 bytes", () => {
    const key = Array.from({ length: 32 }, (_, i) => i);
    const bytes = bcsSchema.PublicKeyBytes.serialize(key).toBytes();
    expect(bytes).toBeInstanceOf(Uint8Array);
    const parsed = bcsSchema.PublicKeyBytes.parse(bytes);
    expect(parsed).toEqual(key);
  });

  it("Amount (u256): serialize/parse", () => {
    const val = 123456789n;
    const bytes = bcsSchema.Amount.serialize(val).toBytes();
    const parsed = bcsSchema.Amount.parse(bytes);
    expect(BigInt(parsed)).toBe(val);
  });

  it("Nonce (u64): serialize/parse", () => {
    const val = 42n;
    const bytes = bcsSchema.Nonce.serialize(val).toBytes();
    const parsed = bcsSchema.Nonce.parse(bytes);
    expect(BigInt(parsed)).toBe(val);
  });

  it("Signature: serialize/parse 64 bytes", () => {
    const sig = Array.from({ length: 64 }, (_, i) => i % 256);
    const bytes = bcsSchema.Signature.serialize(sig).toBytes();
    const parsed = bcsSchema.Signature.parse(bytes);
    expect(parsed).toEqual(sig);
  });
});

describe("BCS layout structs", () => {
  const addr = Array.from({ length: 32 }, () => 1);
  const tokenId = Array.from({ length: 32 }, () => 0x11);

  it("TokenTransfer: round-trip", () => {
    const data = {
      token_id: tokenId,
      recipient: addr,
      amount: 1000n,
      user_data: null,
    };
    const bytes = bcsSchema.TokenTransfer.serialize(data).toBytes();
    const parsed = bcsSchema.TokenTransfer.parse(bytes);
    expect(parsed.token_id).toEqual(tokenId);
    expect(parsed.recipient).toEqual(addr);
    expect(BigInt(parsed.amount)).toBe(1000n);
    expect(parsed.user_data).toBeNull();
  });

  it("Mint: round-trip", () => {
    const data = { token_id: tokenId, recipient: addr, amount: 500n };
    const bytes = bcsSchema.Mint.serialize(data).toBytes();
    const parsed = bcsSchema.Mint.parse(bytes);
    expect(BigInt(parsed.amount)).toBe(500n);
  });

  it("Burn: round-trip", () => {
    const data = { token_id: tokenId, amount: 100n };
    const bytes = bcsSchema.Burn.serialize(data).toBytes();
    const parsed = bcsSchema.Burn.parse(bytes);
    expect(BigInt(parsed.amount)).toBe(100n);
  });

  it("StateInitialization: round-trip", () => {
    const key = Array.from({ length: 32 }, () => 0x22);
    const state = Array.from({ length: 32 }, () => 0xaa);
    const data = { key, initial_state: state };
    const bytes = bcsSchema.StateInitialization.serialize(data).toBytes();
    const parsed = bcsSchema.StateInitialization.parse(bytes);
    expect(parsed.key).toEqual(key);
    expect(parsed.initial_state).toEqual(state);
  });
});

describe("BCS layout enums", () => {
  const tokenId = Array.from({ length: 32 }, () => 0x11);

  it("Operation: TokenTransfer payload", () => {
    const addr = Array.from({ length: 32 }, () => 1);
    const op = {
      TokenTransfer: {
        token_id: tokenId,
        recipient: addr,
        amount: 1000n,
        user_data: null,
      },
    };
    const bytes = bcsSchema.Operation.serialize(op).toBytes();
    const parsed = bcsSchema.Operation.parse(bytes);
    expect(parsed).toHaveProperty("TokenTransfer");
  });

  it("Operation: LeaveCommittee unit variant", () => {
    const op = { LeaveCommittee: [] as const };
    const bytes = bcsSchema.Operation.serialize(op).toBytes();
    const parsed = bcsSchema.Operation.parse(bytes);
    expect(parsed).toHaveProperty("LeaveCommittee");
  });

  it("ClaimType: Batch with multiple operations", () => {
    const burn = { Burn: { token_id: tokenId, amount: 100n } };
    const leave = { LeaveCommittee: [] as const };
    const batch = { Batch: [burn, leave] };
    const bytes = bcsSchema.ClaimType.serialize(batch).toBytes();
    const parsed = bcsSchema.ClaimType.parse(bytes);
    expect(parsed).toHaveProperty("Batch");
    expect((parsed as { Batch: unknown[] }).Batch).toHaveLength(2);
  });
});

describe("BCS layout VersionedTransaction", () => {
  it("full transaction round-trip", () => {
    const addr = Array.from({ length: 32 }, () => 1);
    const tokenId = Array.from({ length: 32 }, () => 0x11);
    const tx = {
      Release20260319: {
        network_id: "fast:testnet",
        sender: addr,
        nonce: 5n,
        timestamp_nanos: 1000000000000n,
        claim: {
          Burn: { token_id: tokenId, amount: 100n },
        },
        archival: false,
        fee_token: null,
      },
    };
    const bytes = bcsSchema.VersionedTransaction.serialize(tx).toBytes();
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);

    const parsed = bcsSchema.VersionedTransaction.parse(bytes);
    const inner = (parsed as { Release20260319: Record<string, unknown> })
      .Release20260319;
    expect(inner.network_id).toBe("fast:testnet");
    expect(BigInt(inner.nonce as number | bigint)).toBe(5n);
    expect(inner.archival).toBe(false);
  });
});
