import { describe, expect, it } from "vitest";
import { HandleVault } from "../../src/wallet/key-handover/state/handles";

const seed = new Uint8Array(32).fill(8);

describe("state/handles", () => {
  it("stores a seed and returns an opaque handle plus info", async () => {
    const vault = new HandleVault(30 * 60 * 1000, () => new Date("2026-05-20T12:00:00Z"));
    const { handle, info } = await vault.store(seed.slice());
    expect(handle.length).toBeGreaterThan(20);
    expect(info.address.startsWith("fast1")).toBe(true);
    expect(info.publicKey).toHaveLength(32);
    expect(info.createdAt).toBe("2026-05-20T12:00:00.000Z");
  });

  it("reads back the seed for a valid handle", async () => {
    const vault = new HandleVault(30 * 60 * 1000, () => new Date("2026-05-20T12:00:00Z"));
    const { handle } = await vault.store(seed.slice());
    expect(vault.getSeed(handle)).toEqual(seed);
  });

  it("returns null info for unknown handle", () => {
    const vault = new HandleVault();
    expect(vault.getInfo("nope")).toBeNull();
  });

  it("disposing wipes and rejects future reads", async () => {
    const vault = new HandleVault(30 * 60 * 1000, () => new Date("2026-05-20T12:00:00Z"));
    const { handle } = await vault.store(seed.slice());
    vault.dispose(handle);
    expect(vault.getSeed(handle)).toBeNull();
    expect(vault.getInfo(handle)).toBeNull();
  });

  it("TTL expiry rejects reads", async () => {
    let t = new Date("2026-05-20T12:00:00Z");
    const vault = new HandleVault(1000, () => t);
    const { handle } = await vault.store(seed.slice());
    t = new Date("2026-05-20T12:00:02Z");
    expect(vault.getSeed(handle)).toBeNull();
  });
});
