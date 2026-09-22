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
});
