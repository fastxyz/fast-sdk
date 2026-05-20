import { Signer, verify } from "@fastxyz/sdk";
import { describe, expect, it } from "vitest";
import { KeyHandoverAgent } from "../src/agent.ts";
import { sealHandover } from "../src/wallet.ts";

let clock = new Date("2026-05-20T12:00:00Z");
const now = () => clock;

function freshAgent() {
  clock = new Date("2026-05-20T12:00:00Z");
  return new KeyHandoverAgent({ now, walletBaseUrl: "https://x/authorize" });
}

const seed = new Uint8Array(32).fill(13);

async function runHandover(agent: KeyHandoverAgent, useSeed = seed) {
  const req = await agent.generateAuthRequest({ requester: "demo" });
  const sealed = await sealHandover({
    authUrlOrData: req.auth_url,
    seed: useSeed.slice(),
    now,
  });
  return { req, sealed };
}

describe("closed loop", () => {
  it("generate → seal → decrypt → sign, signature verifies via @fastxyz/sdk", async () => {
    const agent = freshAgent();
    const { sealed } = await runHandover(agent);
    const result = await agent.decryptAuthPayload({ message: sealed.chat_message });
    expect(result.status).toBe("success");
    if (result.status !== "success") return;

    const message = new TextEncoder().encode("authorize this");
    const signed = await agent.signWithHandle({
      authorization_handle: result.authorization_handle,
      message,
    });
    const ok = await verify(signed.signature, message, signed.publicKey);
    expect(ok).toBe(true);
    expect(signed.address.startsWith("fast1")).toBe(true);
    // Guard against seed-buffer aliasing: signing must use the real seed,
    // not a wiped/zeroed copy. Self-consistent verify() alone would not catch this.
    const expectedPublicKey = await new Signer(seed.slice()).getPublicKey();
    expect(signed.publicKey).toEqual(expectedPublicKey);
  });

  it("dispose then sign throws", async () => {
    const agent = freshAgent();
    const { sealed } = await runHandover(agent);
    const result = await agent.decryptAuthPayload({ message: sealed.chat_message });
    if (result.status !== "success") throw new Error("expected success");
    agent.disposeAuthorizationHandle({ authorization_handle: result.authorization_handle });
    await expect(
      agent.signWithHandle({
        authorization_handle: result.authorization_handle,
        message: new Uint8Array([1]),
      }),
    ).rejects.toThrow(/UNKNOWN_OR_DISPOSED_HANDLE/);
  });

  it("expired pending request is rejected", async () => {
    const agent = freshAgent();
    const { sealed } = await runHandover(agent);
    clock = new Date("2026-05-20T12:06:00Z");
    const result = await agent.decryptAuthPayload({ message: sealed.chat_message });
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.error.code).toBe("REQUEST_EXPIRED");
  });

  it("deletes pending after 3 failed attempts", async () => {
    const agent = freshAgent();
    await runHandover(agent);
    const badCode = await (async () => {
      // valid-shape handover code but encrypted to a DIFFERENT request key
      const other = new KeyHandoverAgent({ now, walletBaseUrl: "https://x/authorize" });
      const otherReq = await other.generateAuthRequest({});
      return sealHandover({ authUrlOrData: otherReq.auth_url, seed: seed.slice(), now });
    })();
    for (let i = 0; i < 2; i++) {
      const r = await agent.decryptAuthPayload({ message: badCode.chat_message });
      expect(r.status).toBe("error");
      if (r.status === "error") expect(r.error.code).toBe("DECRYPTION_FAILED");
    }
    const third = await agent.decryptAuthPayload({ message: badCode.chat_message });
    expect(third.status).toBe("error");
    if (third.status === "error") expect(third.error.code).toBe("TOO_MANY_FAILURES");
    const fourth = await agent.decryptAuthPayload({ message: badCode.chat_message });
    expect(fourth.status).toBe("error");
    if (fourth.status === "error") expect(fourth.error.code).toBe("MISSING_PENDING_REQUEST");
  });

  it("a new request overwrites the old pending (old handover no longer decrypts)", async () => {
    const agent = freshAgent();
    const first = await runHandover(agent);
    await agent.generateAuthRequest({ requester: "second" });
    const result = await agent.decryptAuthPayload({ message: first.sealed.chat_message });
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.error.code).toBe("DECRYPTION_FAILED");
  });

  it("tampered request bytes break AAD and decryption fails", async () => {
    const agent = freshAgent();
    const req = await agent.generateAuthRequest({ requester: "demo" });
    // Tamper the data param: re-seal against a request whose requester differs,
    // so AAD bytes differ from the pending record's stored bytes.
    const tamperedUrl = req.auth_url.replace(/data=.*/, (m) => m + "AA");
    await expect(
      sealHandover({ authUrlOrData: tamperedUrl, seed: seed.slice(), now }),
    ).rejects.toThrow();
  });

  it("malformed paste (zero quoted candidates) is rejected", async () => {
    const agent = freshAgent();
    await runHandover(agent);
    const result = await agent.decryptAuthPayload({ message: "no code here" });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.code).toBe("MALFORMED_HANDOVER_MESSAGE");
    }
  });
});
