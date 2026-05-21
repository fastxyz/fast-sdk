import { describe, expect, it } from "vitest";
import { KeyHandoverAgent } from "../../src/wallet/key-handover/agent";

const now = () => new Date("2026-05-20T12:00:00Z");

describe("agent (structure)", () => {
  it("generateAuthRequest returns url, fingerprint and 5-minute expiry", async () => {
    const agent = new KeyHandoverAgent({ now, walletBaseUrl: "https://x/authorize" });
    const req = await agent.generateAuthRequest({ requester: "demo" });
    expect(req.auth_url.startsWith("https://x/authorize?data=")).toBe(true);
    expect(req.request_fingerprint).toMatch(/^\d{6}$/);
    expect(req.request_expires_at).toBe("2026-05-20T12:05:00Z");
  });

  it("decryptAuthPayload returns private_key hex on success", async () => {
    const { sealHandover } = await import("../../src/wallet/key-handover/wallet");
    const agent = new KeyHandoverAgent({ now, walletBaseUrl: "https://x/authorize" });
    const req = await agent.generateAuthRequest({ requester: "demo" });
    const seed = new Uint8Array(32).fill(7);
    const sealed = await sealHandover({ authUrlOrData: req.auth_url, seed: seed.slice(), now });
    const result = await agent.decryptAuthPayload({ message: sealed.chat_message });
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.private_key).toMatch(/^[0-9a-f]{64}$/);
  });
});
