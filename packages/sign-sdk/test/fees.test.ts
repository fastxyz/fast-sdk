// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  assertFeePolicy,
  assertFeeSnapshotUnchanged,
  feeTokenForState,
  resolveClaimFee,
} from "../src/internal/fees.js";

describe("fee authorization", () => {
  it("fails closed when the authoritative schedule is unavailable", async () => {
    const unavailable = await resolveClaimFee("fast:testnet", {
      networkInfo: async () => { throw new Error("offline"); },
      tokenMeta: async () => { throw new Error("unused"); },
    });
    expect(unavailable).toEqual({ kind: "unavailable" });
    expect(() => feeTokenForState(unavailable)).toThrow(/unavailable/i);
    expect(() => assertFeePolicy("fast:testnet", unavailable, {
      tokenId: null,
      maxAtomicAmount: "0",
    })).toThrow(/unavailable/i);
  });

  it("rejects fee schedule drift after authorization", () => {
    const authorized = { kind: "none" } as const;
    expect(() => assertFeeSnapshotUnchanged("fast:testnet", authorized, {
      kind: "quoted",
      tokenId: "11".repeat(32),
      symbol: "FAST",
      decimals: 9,
      atomicAmount: "1",
      updateId: 1,
    })).toThrow(/changed/i);
  });

  it("uses the validated fee amount when token metadata mutates the response", async () => {
    const tokenId = "11".repeat(32);
    const entry = { token_id: tokenId, fixed_amount: "7" };
    const state = await resolveClaimFee("fast:testnet", {
      networkInfo: async () => ({
        data: { network_id: "fast:testnet", fees: { default: tokenId, entries: [entry] } },
      }),
      tokenMeta: async () => {
        entry.fixed_amount = "0";
        return { data: { requested_token_metadata: [[tokenId, { token_name: "FAST", decimals: 6 }]] } };
      },
    });

    expect(state).toMatchObject({ kind: "quoted", tokenId, atomicAmount: "7" });
  });

  it("reads a fee amount getter only once", async () => {
    const tokenId = "11".repeat(32);
    let amountReads = 0;
    const entry = {
      token_id: tokenId,
      get fixed_amount() { return ++amountReads === 1 ? "7" : "0"; },
    };
    const state = await resolveClaimFee("fast:testnet", {
      networkInfo: async () => ({
        data: { network_id: "fast:testnet", fees: { default: tokenId, entries: [entry] } },
      }),
      tokenMeta: async () => ({
        data: { requested_token_metadata: [[tokenId, { token_name: "FAST", decimals: 6 }]] },
      }),
    });

    expect(state).toMatchObject({ kind: "quoted", tokenId, atomicAmount: "7" });
    expect(amountReads).toBe(1);
  });

  it("uses one fee schedule snapshot before deciding whether a fee is due", async () => {
    const tokenId = "11".repeat(32);
    let defaultReads = 0;
    let entriesReads = 0;
    const fees = {
      get default() { return ++defaultReads === 1 ? tokenId : ""; },
      get entries() {
        return ++entriesReads === 1 ? [{ token_id: tokenId, fixed_amount: "7" }] : [];
      },
    };
    const state = await resolveClaimFee("fast:testnet", {
      networkInfo: async () => ({ data: { network_id: "fast:testnet", fees } }),
      tokenMeta: async () => ({
        data: { requested_token_metadata: [[tokenId, { token_name: "FAST", decimals: 6 }]] },
      }),
    });

    expect(state).toMatchObject({ kind: "quoted", tokenId, atomicAmount: "7" });
    expect(() => assertFeePolicy("fast:testnet", state, { tokenId: null, maxAtomicAmount: "0" }))
      .toThrow(/fee token/i);
    expect(defaultReads).toBe(1);
    expect(entriesReads).toBe(1);
  });

  it("fails closed when the fee schedule contains duplicate token entries", async () => {
    const duplicateEntry = { token_id: "11".repeat(32), fixed_amount: "7" };
    await expect(resolveClaimFee("fast:testnet", {
      networkInfo: async () => ({
        data: { network_id: "fast:testnet", fees: { default: duplicateEntry.token_id, entries: [duplicateEntry, duplicateEntry] } },
      }),
      tokenMeta: async () => ({ data: { requested_token_metadata: [] } }),
    })).resolves.toEqual({ kind: "unavailable" });
  });

  it.each(["identical", "conflicting"] as const)("fails closed when token metadata is duplicated (%s)", async (kind) => {
    const rows = [
      ["11".repeat(32), { token_name: "FAST", decimals: 9, update_id: 1 }],
      ["11".repeat(32), { token_name: kind === "conflicting" ? "OTHER" : "FAST", decimals: 9, update_id: 1 }],
    ];
    await expect(resolveClaimFee("fast:testnet", {
      networkInfo: async () => ({
        data: { network_id: "fast:testnet", fees: { default: "11".repeat(32), entries: [{ token_id: "11".repeat(32), fixed_amount: "7" }] } },
      }),
      tokenMeta: async () => ({ data: { requested_token_metadata: rows } }),
    })).resolves.toEqual({ kind: "unavailable" });
  });
});
