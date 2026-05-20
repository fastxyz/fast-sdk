import { describe, expect, it } from "vitest";
import { KeyHandoverAgent } from "../src/agent.ts";

const now = () => new Date("2026-05-20T12:00:00Z");

describe("agent (structure)", () => {
  it("generateAuthRequest returns url, fingerprint and 5-minute expiry", async () => {
    const agent = new KeyHandoverAgent({ now, walletBaseUrl: "https://x/authorize" });
    const req = await agent.generateAuthRequest({ requester: "demo" });
    expect(req.auth_url.startsWith("https://x/authorize?data=")).toBe(true);
    expect(req.request_fingerprint).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(req.request_expires_at).toBe("2026-05-20T12:05:00Z");
  });

  it("signWithHandle throws for unknown handle", async () => {
    const agent = new KeyHandoverAgent({ now });
    await expect(
      agent.signWithHandle({
        authorization_handle: "bogus",
        message: new Uint8Array([1]),
      }),
    ).rejects.toThrow(/UNKNOWN_OR_DISPOSED_HANDLE/);
  });

  it("getHandleInfo returns null for unknown handle", () => {
    const agent = new KeyHandoverAgent({ now });
    expect(agent.getHandleInfo("bogus")).toBeNull();
  });
});
