import { describe, expect, it } from "vitest";
import { generateKeyPair } from "../../src/wallet/key-handover/crypto/hpke";
import { PendingStore } from "../../src/wallet/key-handover/state/pending";

async function fakeKey() {
  return (await generateKeyPair()).privateKey;
}

describe("state/pending", () => {
  it("stores and reads a single pending record", async () => {
    const store = new PendingStore();
    const key = await fakeKey();
    store.set({
      hpkePrivateKey: key,
      requestPayloadBytes: new Uint8Array([1]),
      fingerprint: "ABCD-EFGH",
      expiresAt: "2026-05-20T12:05:00Z",
    });
    expect(store.peek()?.fingerprint).toBe("ABCD-EFGH");
  });

  it("a new request overwrites the previous pending record", async () => {
    const store = new PendingStore();
    store.set({
      hpkePrivateKey: await fakeKey(),
      requestPayloadBytes: new Uint8Array([1]),
      fingerprint: "AAAA-AAAA",
      expiresAt: "2026-05-20T12:05:00Z",
    });
    store.set({
      hpkePrivateKey: await fakeKey(),
      requestPayloadBytes: new Uint8Array([2]),
      fingerprint: "BBBB-BBBB",
      expiresAt: "2026-05-20T12:06:00Z",
    });
    expect(store.peek()?.fingerprint).toBe("BBBB-BBBB");
  });

  it("transitions pending → consuming and rejects double-consume", async () => {
    const store = new PendingStore(() => new Date("2026-05-20T12:00:00Z"));
    store.set({
      hpkePrivateKey: await fakeKey(),
      requestPayloadBytes: new Uint8Array([1]),
      fingerprint: "ABCD-EFGH",
      expiresAt: "2026-05-20T12:05:00Z",
    });
    store.beginConsuming();
    expect(() => store.beginConsuming()).toThrow();
  });

  it("deletes when expired on beginConsuming", async () => {
    const store = new PendingStore(() => new Date("2026-05-20T12:06:00Z"));
    store.set({
      hpkePrivateKey: await fakeKey(),
      requestPayloadBytes: new Uint8Array([1]),
      fingerprint: "ABCD-EFGH",
      expiresAt: "2026-05-20T12:05:00Z",
    });
    expect(() => store.beginConsuming()).toThrow();
    expect(store.peek()).toBeNull();
  });

  it("returns to pending and counts failures, deletes after 3", async () => {
    const store = new PendingStore(() => new Date("2026-05-20T12:00:00Z"));
    const seed = {
      hpkePrivateKey: await fakeKey(),
      requestPayloadBytes: new Uint8Array([1]),
      fingerprint: "ABCD-EFGH",
      expiresAt: "2026-05-20T12:05:00Z",
    };
    store.set(seed);
    store.beginConsuming();
    expect(store.recordFailure()).toBe(false);
    store.beginConsuming();
    expect(store.recordFailure()).toBe(false);
    store.beginConsuming();
    expect(store.recordFailure()).toBe(true);
    expect(store.peek()).toBeNull();
  });

  it("clears the record on success", async () => {
    const store = new PendingStore();
    store.set({
      hpkePrivateKey: await fakeKey(),
      requestPayloadBytes: new Uint8Array([1]),
      fingerprint: "ABCD-EFGH",
      expiresAt: "2026-05-20T12:05:00Z",
    });
    store.clear();
    expect(store.peek()).toBeNull();
  });
});
