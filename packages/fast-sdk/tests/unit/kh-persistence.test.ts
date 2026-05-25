import { describe, expect, it } from "vitest";
import { KeyHandoverAgent } from "../../src/wallet/key-handover/agent";
import { sealHandover } from "../../src/wallet/key-handover/wallet";
import { encodeBase64Url } from "../../src/wallet/key-handover/crypto/base64url";
import { encodeHandoverCode } from "../../src/wallet/key-handover/protocol/handover";

let clock = new Date("2026-05-20T12:00:00Z");
const now = () => clock;

function freshAgent() {
  clock = new Date("2026-05-20T12:00:00Z");
  return new KeyHandoverAgent({ now, walletBaseUrl: "https://x/authorize" });
}

const seed = new Uint8Array(32).fill(42);

async function generateAndSeal(agent: KeyHandoverAgent, useSeed = seed) {
  const req = await agent.generateAuthRequest({ requester: "test" });
  const sealed = await sealHandover({ authUrlOrData: req.auth_url, seed: useSeed.slice(), now });
  return { req, sealed };
}

describe("persistence: exportPending / restore", () => {
  it("exportPending returns null when no pending", async () => {
    const agent = freshAgent();
    expect(await agent.exportPending()).toBeNull();
  });

  it("generate → export → restore → decrypt round-trip equals direct decrypt", async () => {
    const agentDirect = freshAgent();
    const { req, sealed } = await generateAndSeal(agentDirect);

    const agentRestored = freshAgent();
    await agentRestored.generateAuthRequest({ requester: "test" });
    const agentForExport = freshAgent();
    const { sealed: sealedForExport } = await generateAndSeal(agentForExport);
    const state = await agentForExport.exportPending();
    expect(state).not.toBeNull();

    const agentFromState = await KeyHandoverAgent.restore(state!, { now, walletBaseUrl: "https://x/authorize" });
    const resultRestored = await agentFromState.decryptAuthPayload({ message: sealedForExport.chat_message });

    const resultDirect = await agentForExport.exportPending();
    // agentForExport's pending was consumed by decryptAuthPayload on restored agent?
    // Actually let's do the round-trip properly: one agent generates, exports, then we restore and decrypt
    const agentGen = freshAgent();
    const { sealed: sealedRt } = await generateAndSeal(agentGen);
    const stateRt = await agentGen.exportPending();
    expect(stateRt).not.toBeNull();

    const agentRt = await KeyHandoverAgent.restore(stateRt!, { now });
    const result = await agentRt.decryptAuthPayload({ message: sealedRt.chat_message });
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.private_key).toMatch(/^[0-9a-f]{64}$/);

    // Also verify direct decrypt on the original agent gives same key
    const agentDirect2 = freshAgent();
    const { sealed: sealedD } = await generateAndSeal(agentDirect2);
    const resultDirect2 = await agentDirect2.decryptAuthPayload({ message: sealedD.chat_message });
    expect(resultDirect2.status).toBe("success");
    if (resultDirect2.status !== "success") return;
    // Both decrypt from the same seed — keys match
    expect(result.private_key).toBe(resultDirect2.private_key);
  });

  it("exportPending is idempotent (two calls return equal values)", async () => {
    const agent = freshAgent();
    await agent.generateAuthRequest({ requester: "test" });
    const first = await agent.exportPending();
    const second = await agent.exportPending();
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first!.fingerprint).toBe(second!.fingerprint);
    expect(first!.request_payload).toBe(second!.request_payload);
    expect(first!.expires_at).toBe(second!.expires_at);
    expect(first!.failure_count).toBe(second!.failure_count);
    expect(first!.hpke_private_key_jwk).toEqual(second!.hpke_private_key_jwk);
  });

  it("restore throws on unsupported version", async () => {
    const agent = freshAgent();
    await agent.generateAuthRequest({ requester: "test" });
    const state = await agent.exportPending();
    expect(state).not.toBeNull();
    await expect(
      KeyHandoverAgent.restore({ ...state!, v: 2 as unknown as 1 }),
    ).rejects.toThrow("unsupported serialized pending version");
  });

  it("restore preserves failure_count: tampered code still triggers recordFailure (first 2 keep pending)", async () => {
    const agent = freshAgent();
    const { sealed: goodSealed } = await generateAndSeal(agent);
    const state = await agent.exportPending();
    expect(state).not.toBeNull();

    // Seal against a different key so decryption fails
    const otherAgent = freshAgent();
    const { sealed: badSealed } = await generateAndSeal(otherAgent);

    const restored = await KeyHandoverAgent.restore(state!, { now });
    const r1 = await restored.decryptAuthPayload({ message: badSealed.chat_message });
    expect(r1.status).toBe("error");
    if (r1.status === "error") expect(r1.error.code).toBe("DECRYPTION_FAILED");

    // After first failure, pending still exists
    const stateAfterOne = await restored.exportPending();
    expect(stateAfterOne).not.toBeNull();
    expect(stateAfterOne!.failure_count).toBe(1);

    const r2 = await restored.decryptAuthPayload({ message: badSealed.chat_message });
    expect(r2.status).toBe("error");
    if (r2.status === "error") expect(r2.error.code).toBe("DECRYPTION_FAILED");

    const stateAfterTwo = await restored.exportPending();
    expect(stateAfterTwo).not.toBeNull();
    expect(stateAfterTwo!.failure_count).toBe(2);
  });

  it("restore preserves failure_count: 3 consecutive failures clear pending", async () => {
    const agent = freshAgent();
    await generateAndSeal(agent);
    const state = await agent.exportPending();
    expect(state).not.toBeNull();

    const otherAgent = freshAgent();
    const { sealed: badSealed } = await generateAndSeal(otherAgent);

    const restored = await KeyHandoverAgent.restore(state!, { now });

    for (let i = 0; i < 2; i++) {
      const r = await restored.decryptAuthPayload({ message: badSealed.chat_message });
      expect(r.status).toBe("error");
      if (r.status === "error") expect(r.error.code).toBe("DECRYPTION_FAILED");
    }

    const r3 = await restored.decryptAuthPayload({ message: badSealed.chat_message });
    expect(r3.status).toBe("error");
    if (r3.status === "error") expect(r3.error.code).toBe("TOO_MANY_FAILURES");

    expect(await restored.exportPending()).toBeNull();
  });

  it("§4.6 fix: bare base64url with invalid JSON → INVALID_HANDOVER_CODE", async () => {
    const agent = freshAgent();
    await agent.generateAuthRequest({ requester: "test" });
    // Valid base64url but decodes to non-JSON (raw bytes from seed, not a handover JSON)
    const notJson = encodeBase64Url(new Uint8Array(32).fill(0xff));
    const result = await agent.decryptAuthPayload({ message: notJson });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.code).toBe("INVALID_HANDOVER_CODE");
    }
  });

  it("§4.6 fix: plain text with no quotes → MALFORMED_HANDOVER_MESSAGE", async () => {
    const agent = freshAgent();
    await agent.generateAuthRequest({ requester: "test" });
    const result = await agent.decryptAuthPayload({ message: "no code here at all" });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.code).toBe("MALFORMED_HANDOVER_MESSAGE");
    }
  });
});
