import { describe, expect, it, vi } from "vitest";

import {
  FeeUnavailableError,
  IdClient,
  InvalidProofInputError,
  KeySigner,
  LocalVerificationError,
  OAuthProofTimeoutError,
  OAuthProofUnavailableError,
  RegistrationPendingError,
  WebsiteVerificationPendingError,
  XSettlementNotAuthorizedError,
  type PendingRegistration,
  type Signer,
} from "../src/index.js";
import {
  encodeSocialCommitMessage,
  encodeSocialIntentMessage,
  encodeSocialProofMessage,
} from "../src/proofs.js";

/*
 * Audited proof wires (2026-09-11):
 *
 * WEBSITE — publish the signer's canonical fast1 address as a standalone token at
 * `https://<canonical-host>/.well-known/fastid`. Registration is paid first and may answer
 * `pending_external_check`; only an owner-links read for this address/network and exact
 * `(website, host)` with `status:"verified"` finishes the poll. The SDK never performs arbitrary
 * website egress itself.
 *
 * GITHUB / ORCID — the owner opens `/claim/{provider}` in a browser and connects the SAME wallet
 * identity as the SDK signer on the same network. The SDK never starts OAuth or receives its
 * callback, code, token, cookie, or authenticated identity. It polls the existence-only
 * `GET /api/oauth/proof-available?address=<64hex>&kind=<provider>&value=<canonical-value>`; the host
 * supplies network server-side. Only the exact JSON `{available:true}` permits the Task 7 pipeline,
 * and settle rechecks it immediately because false/error proves no usable receipt.
 *
 * X — advertised intent support signs `fastid-social-intent-v1`; an enabled X kind without that
 * advertisement signs the legacy `fastid-social-proof-v2` wire and uses `/proof`. Both bind the
 * address, network, kind, value, challenge expiry/nonce, and optional replacement nonce.
 * The returned proof_url is opaque and is embedded byte-for-byte in the frozen proof post.
 * `/verify` receives exactly `{proof_nonce,post_url}`. Only `settlement:"committed"` licenses the
 * paid claim; `"applied"` is already settled; an absent/unknown tag fails closed. A legacy receipt
 * requires a locally verified `fastid-social-commit-v1` signature and confirmed `/commit` response
 * before payment.
 */

const TOKEN_ID = "11".repeat(32);
const PROOF_NONCE = "99".repeat(16);
const SERVER_NONCE = "33".repeat(32);
const PROOF_URL = "https://testnet.id.fast.xyz/p/x?fast-id-proof=Aa%2FB%3D";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function feeNetworkInfo(): Response {
  return json({
    data: {
      network_id: "fast:testnet",
      fees: {
        default: TOKEN_ID,
        entries: [{ token_id: TOKEN_ID, fixed_amount: "7" }],
      },
    },
  });
}

function feeTokenMeta(): Response {
  return json({
    data: {
      requested_token_metadata: [
        [TOKEN_ID, { token_name: "testUSDC", decimals: 6, update_id: 3 }],
      ],
    },
  });
}

function settledProvider() {
  return {
    getAccountInfo: vi.fn(async () => ({ nextNonce: 5n })),
    submitTransaction: vi.fn(async (envelope: { transaction: unknown }) => ({
      type: "Success",
      value: { envelope: { transaction: envelope.transaction } },
    })),
  };
}

interface HarnessOptions {
  signer?: Signer;
  route?: (
    url: string,
    init: RequestInit | undefined,
    signer: Signer,
  ) => Response | Promise<Response> | undefined;
}

async function harness(options: HarnessOptions = {}) {
  const signer = options.signer ?? (await KeySigner.fromPrivateKey("01".repeat(32)));
  const sign = vi.spyOn(signer, "sign");
  const provider = settledProvider();
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const routed = await options.route?.(url, init, signer);
    if (routed) return routed;
    if (url.includes("/api/property/claimed?")) return json({ claimed: false });
    if (url.endsWith("/api/social/kinds")) {
      return json({ kinds: ["x"], intent_kinds: ["x"] });
    }
    if (url.endsWith("/proxy-rest/v1/network-info")) return feeNetworkInfo();
    if (url.includes("/proxy-rest/v1/tokens?")) return feeTokenMeta();
    if (url.endsWith("/api/claim")) {
      return json({ status: "verified_external_link", disposition: "fresh" });
    }
    throw new Error(`unexpected URL ${url}`);
  });
  const client = new IdClient({
    network: "fast:testnet",
    signer,
    fetchImpl: fetchImpl as typeof fetch,
    provider: provider as never,
  });
  return { client, signer, sign, provider, calls };
}

function bodyOf(call: { init?: RequestInit }): Record<string, unknown> {
  return JSON.parse(String(call.init?.body)) as Record<string, unknown>;
}

describe("proof wire encoders", () => {
  it("matches the independently generated X intent and commit golden bytes", () => {
    const common = {
      address: new Uint8Array(32).fill(0x11),
      network: "fast:testnet",
      kind: "x",
      value: "yourhandle",
      expiryUnixSecs: 1_767_225_600n,
      serverNonce: new Uint8Array(32).fill(0x33),
    };
    expect(Buffer.from(encodeSocialIntentMessage(common)).toString("hex")).toBe(
      "6661737469642d736f6369616c2d696e74656e742d763111111111111111111111111111111111111111111111111111111111111111110c666173743a746573746e65740178000a796f757268616e646c65000000006955b900333333333333333333333333333333333333333333333333333333333333333300",
    );
    expect(
      Buffer.from(
        encodeSocialCommitMessage({
          ...common,
          proofNonce: new Uint8Array(16).fill(0x99),
        }),
      ).toString("hex"),
    ).toBe(
      "6661737469642d736f6369616c2d636f6d6d69742d763111111111111111111111111111111111111111111111111111111111111111110c666173743a746573746e65740178000a796f757268616e646c65000000006955b900333333333333333333333333333333333333333333333333333333333333333399999999999999999999999999999999",
    );
    expect(Buffer.from(encodeSocialProofMessage(common)).toString("hex")).toBe(
      "6661737469642d736f6369616c2d70726f6f662d763211111111111111111111111111111111111111111111111111111111111111110c666173743a746573746e65740178000a796f757268616e646c65000000006955b900333333333333333333333333333333333333333333333333333333333333333300",
    );
  });
});

describe("browser-bound OAuth proofs", () => {
  it("rejects a non-OAuth provider locally before proof or payment I/O", async () => {
    const h = await harness();

    expect(() => h.client.oauthClaimInstructions("website" as never)).toThrow(
      InvalidProofInputError,
    );
    await expect(
      h.client.waitForOAuthProof("website" as never, "example.org", {
        timeoutMs: 100,
        intervalMs: 0,
      }),
    ).rejects.toBeInstanceOf(InvalidProofInputError);
    await expect(
      h.client.settleOAuthClaim("website" as never, "example.org"),
    ).rejects.toBeInstanceOf(InvalidProofInputError);
    expect(h.calls).toEqual([]);
    expect(h.sign).not.toHaveBeenCalled();
    expect(h.provider.getAccountInfo).not.toHaveBeenCalled();
    expect(h.provider.submitTransaction).not.toHaveBeenCalled();
  });

  it("returns browser instructions and polls the known canonical identity to available", async () => {
    let probes = 0;
    const h = await harness({
      route: (url) => {
        if (url.includes("/api/oauth/proof-available?")) {
          probes += 1;
          return json({ available: probes === 2 });
        }
      },
    });
    const instructions = h.client.oauthClaimInstructions("github");
    expect(instructions.url).toBe("https://testnet.id.fast.xyz/claim/github");
    expect(instructions.instructions).toMatch(/same wallet/i);
    expect(instructions.instructions).toMatch(/browser/i);

    await expect(
      h.client.waitForOAuthProof("github", "https://github.com/OctoCat", {
        timeoutMs: 100,
        intervalMs: 0,
      }),
    ).resolves.toMatchObject({
      available: true,
      provider: "github",
      value: "octocat",
      addressHex: h.signer.signerHex,
      network: "fast:testnet",
    });
    const probesSeen = h.calls.filter(({ url }) => url.includes("proof-available"));
    expect(probesSeen).toHaveLength(2);
    expect(probesSeen[0].url).toBe(
      `https://testnet.id.fast.xyz/api/oauth/proof-available?address=${h.signer.signerHex}&kind=github&value=octocat`,
    );
  });

  it("snapshots OAuth wait options before the first proof probe", async () => {
    const originalController = new AbortController();
    const replacementController = new AbortController();
    replacementController.abort();
    const options = {
      timeoutMs: 100,
      intervalMs: 0,
      signal: originalController.signal,
    };
    let probes = 0;
    const h = await harness({
      route: (url) => {
        if (!url.includes("/api/oauth/proof-available?")) return undefined;
        probes += 1;
        if (probes === 1) {
          options.timeoutMs = 0;
          options.intervalMs = Number.POSITIVE_INFINITY;
          options.signal = replacementController.signal;
          return json({ available: false });
        }
        return json({ available: true });
      },
    });

    await expect(
      h.client.waitForOAuthProof("github", "octocat", options),
    ).resolves.toMatchObject({ available: true, value: "octocat" });
    expect(probes).toBe(2);
  });

  it("times out without treating false as authority to sign or submit", async () => {
    const h = await harness({
      route: (url) =>
        url.includes("/api/oauth/proof-available?") ? json({ available: false }) : undefined,
    });
    await expect(
      h.client.waitForOAuthProof("orcid", "0000-0002-1825-0097", {
        timeoutMs: 1,
        intervalMs: 2,
      }),
    ).rejects.toBeInstanceOf(OAuthProofTimeoutError);
    expect(h.sign).not.toHaveBeenCalled();
    expect(h.provider.getAccountInfo).not.toHaveBeenCalled();
    expect(h.provider.submitTransaction).not.toHaveBeenCalled();
  });

  it("cancels polling without opening the paid pipeline", async () => {
    const controller = new AbortController();
    const h = await harness({
      route: (url) => {
        if (!url.includes("/api/oauth/proof-available?")) return undefined;
        controller.abort();
        return json({ available: false });
      },
    });
    await expect(
      h.client.waitForOAuthProof("github", "octocat", {
        timeoutMs: 100,
        intervalMs: 10,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "ProofWaitCancelledError" });
    expect(h.sign).not.toHaveBeenCalled();
    expect(h.provider.submitTransaction).not.toHaveBeenCalled();
  });

  it("honors cancellation even when an in-flight probe resolves available", async () => {
    const controller = new AbortController();
    const h = await harness({
      route: (url) => {
        if (!url.includes("/api/oauth/proof-available?")) return undefined;
        controller.abort();
        return json({ available: true });
      },
    });
    await expect(
      h.client.waitForOAuthProof("github", "octocat", {
        timeoutMs: 100,
        intervalMs: 0,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "ProofWaitCancelledError" });
    expect(h.sign).not.toHaveBeenCalled();
    expect(h.provider.submitTransaction).not.toHaveBeenCalled();
  });

  it("does not lose cancellation before the bounded-work listener is installed", async () => {
    const controller = new AbortController();
    const nativeAdd = controller.signal.addEventListener.bind(controller.signal);
    vi.spyOn(controller.signal, "addEventListener").mockImplementation(
      (type, listener, options) => {
        controller.abort();
        nativeAdd(type, listener, options);
      },
    );
    const h = await harness({
      route: (url) => {
        if (url.endsWith("/api/claim")) {
          return json({ status: "pending_external_check" });
        }
        if (url.includes("/api/links/")) return new Promise<Response>(() => {});
        return undefined;
      },
    });
    const pending = h.client.claimWebsite("example.org").verifyAndSettle({
      timeoutMs: 20,
      intervalMs: 0,
      signal: controller.signal,
    });
    const observed = await Promise.race([
      pending.then(
        () => "resolved",
        (error: unknown) => (error as Error).name,
      ),
      new Promise<string>((resolve) => setTimeout(() => resolve("hung"), 5)),
    ]);

    expect(observed).toBe("RegistrationPendingError");
  });

  it("does not lose cancellation before the interval listener is installed", async () => {
    let registrations = 0;
    const controller = new AbortController();
    const nativeAdd = controller.signal.addEventListener.bind(controller.signal);
    vi.spyOn(controller.signal, "addEventListener").mockImplementation(
      (type, listener, options) => {
        registrations += 1;
        if (registrations === 2) controller.abort();
        nativeAdd(type, listener, options);
      },
    );
    const h = await harness({
      route: (url) =>
        url.includes("/api/oauth/proof-available?") ? json({ available: false }) : undefined,
    });
    const pending = h.client.waitForOAuthProof("github", "octocat", {
      timeoutMs: 100,
      intervalMs: 20,
      signal: controller.signal,
    });
    const observed = await Promise.race([
      pending.then(
        () => "resolved",
        (error: unknown) => (error as Error).name,
      ),
      new Promise<string>((resolve) => setTimeout(() => resolve("hung"), 5)),
    ]);
    await pending.catch(() => undefined);

    expect(observed).toBe("ProofWaitCancelledError");
  });

  it("removes completed interval abort listeners instead of accumulating them", async () => {
    const controller = new AbortController();
    const added = vi.spyOn(controller.signal, "addEventListener");
    const removed = vi.spyOn(controller.signal, "removeEventListener");
    let probes = 0;
    const h = await harness({
      route: (url) => {
        if (url.includes("/api/oauth/proof-available?")) {
          probes += 1;
          return json({ available: probes === 2 });
        }
      },
    });

    await h.client.waitForOAuthProof("github", "octocat", {
      timeoutMs: 100,
      intervalMs: 1,
      signal: controller.signal,
    });

    expect(removed.mock.calls.length).toBe(added.mock.calls.length);
  });

  it("times out a proof probe whose fetch never settles", async () => {
    const h = await harness({
      route: (url) =>
        url.includes("/api/oauth/proof-available?")
          ? new Promise<Response>(() => {})
          : undefined,
    });
    await expect(
      h.client.waitForOAuthProof("github", "octocat", {
        timeoutMs: 5,
        intervalMs: 0,
      }),
    ).rejects.toBeInstanceOf(OAuthProofTimeoutError);
    expect(h.sign).not.toHaveBeenCalled();
    expect(h.provider.submitTransaction).not.toHaveBeenCalled();
  });

  it("rejects invalid wait bounds before performing I/O", async () => {
    const h = await harness();
    await expect(
      h.client.waitForOAuthProof("github", "octocat", {
        timeoutMs: Number.POSITIVE_INFINITY,
        intervalMs: 0,
      }),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      h.client.waitForOAuthProof("github", "octocat", {
        timeoutMs: Number.MAX_SAFE_INTEGER,
        intervalMs: 0,
      }),
    ).rejects.toBeInstanceOf(RangeError);
    expect(h.calls).toHaveLength(0);
  });

  it("rechecks proof availability immediately before the existing paid pipeline", async () => {
    const h = await harness({
      route: (url) =>
        url.includes("/api/oauth/proof-available?") ? json({ available: true }) : undefined,
    });
    const result = await h.client.settleOAuthClaim("github", "OctoCat");
    expect(result.outcome).toBe("verified");
    expect(h.sign).toHaveBeenCalledTimes(1);
    expect(h.provider.submitTransaction).toHaveBeenCalledTimes(1);
    const registration = h.calls.find(({ url }) => url.endsWith("/api/claim"));
    expect(bodyOf(registration!)).toEqual({
      address: h.signer.signerHex,
      nonce: "5",
      tx_id: result.txIdHex,
      network: "fast:testnet",
    });
  });

  it("single-flights concurrent OAuth settlement for one canonical provider identity", async () => {
    const h = await harness({
      route: (url) =>
        url.includes("/api/oauth/proof-available?") ? json({ available: true }) : undefined,
    });

    const [first, second] = await Promise.all([
      h.client.settleOAuthClaim("github", "OctoCat"),
      h.client.settleOAuthClaim("github", "https://github.com/octocat"),
    ]);

    expect(second).toEqual(first);
    expect(h.sign).toHaveBeenCalledTimes(1);
    expect(h.provider.getAccountInfo).toHaveBeenCalledTimes(1);
    expect(h.provider.submitTransaction).toHaveBeenCalledTimes(1);
    expect(h.calls.filter(({ url }) => url.endsWith("/api/claim"))).toHaveLength(1);
  });

  it("permits a fresh OAuth settlement after this client confirms a matching revocation", async () => {
    const claimTx = "aa".repeat(32);
    const h = await harness({
      route: (url) => {
        if (url.includes("/api/oauth/proof-available?")) {
          return json({ available: true });
        }
        if (url.includes("/api/links/")) {
          return json({
            address: h.signer.address,
            network: "fast:testnet",
            links: [
              {
                kind: "github",
                value: "octocat",
                status: "verified",
                claim_tx: claimTx,
                publicly_visible: true,
              },
            ],
          });
        }
        if (url.endsWith("/api/revoke")) return json({ status: "applied" });
      },
    });

    const first = await h.client.settleOAuthClaim("github", "octocat");
    await expect(h.client.revoke("github", "octocat")).resolves.toMatchObject({
      registration: "registered",
      outcome: "applied",
    });
    const reclaimed = await h.client.settleOAuthClaim("github", "octocat");

    expect(reclaimed.txIdHex).not.toBe(first.txIdHex);
    expect(h.provider.submitTransaction).toHaveBeenCalledTimes(3);
    expect(h.calls.filter(({ url }) => url.endsWith("/api/claim"))).toHaveLength(2);
  });

  it("invalidates OAuth settlement only after a pending matching revocation is registered", async () => {
    const claimTx = "aa".repeat(32);
    let revokeRegistrations = 0;
    const h = await harness({
      route: (url) => {
        if (url.includes("/api/oauth/proof-available?")) {
          return json({ available: true });
        }
        if (url.includes("/api/links/")) {
          return json({
            address: h.signer.address,
            network: "fast:testnet",
            links: [
              {
                kind: "github",
                value: "octocat",
                status: "verified",
                claim_tx: claimTx,
                publicly_visible: true,
              },
            ],
          });
        }
        if (url.endsWith("/api/revoke")) {
          revokeRegistrations += 1;
          return revokeRegistrations === 1
            ? json({ error: "later" }, 500)
            : json({ status: "applied" });
        }
      },
    });

    const first = await h.client.settleOAuthClaim("github", "octocat");
    let pending: PendingRegistration | undefined;
    try {
      await h.client.revoke("github", "octocat");
    } catch (error) {
      expect(error).toBeInstanceOf(RegistrationPendingError);
      pending = (error as RegistrationPendingError).pending;
    }
    expect(pending).toMatchObject({ op: "revoke", kind: "github", value: "octocat" });
    expect(await h.client.settleOAuthClaim("github", "octocat")).toBe(first);

    await expect(h.client.retryRegistration(pending!)).resolves.toMatchObject({
      registration: "registered",
      outcome: "applied",
    });
    const reclaimed = await h.client.settleOAuthClaim("github", "octocat");

    expect(reclaimed.txIdHex).not.toBe(first.txIdHex);
    expect(h.provider.submitTransaction).toHaveBeenCalledTimes(3);
    expect(h.calls.filter(({ url }) => url.endsWith("/api/claim"))).toHaveLength(2);
  });

  it("retains OAuth settlement when revoke registration returns a claim-only status", async () => {
    const claimTx = "aa".repeat(32);
    let revokeRegistrations = 0;
    const h = await harness({
      route: (url) => {
        if (url.includes("/api/oauth/proof-available?")) {
          return json({ available: true });
        }
        if (url.includes("/api/links/")) {
          return json({
            address: h.signer.address,
            network: "fast:testnet",
            links: [
              {
                kind: "github",
                value: "octocat",
                status: "verified",
                claim_tx: claimTx,
                publicly_visible: true,
              },
            ],
          });
        }
        if (url.endsWith("/api/revoke")) {
          revokeRegistrations += 1;
          return revokeRegistrations === 1
            ? json({ error: "later" }, 500)
            : json({ status: "verified_external_link" });
        }
      },
    });

    const first = await h.client.settleOAuthClaim("github", "octocat");
    let pending: PendingRegistration | undefined;
    try {
      await h.client.revoke("github", "octocat");
    } catch (error) {
      expect(error).toBeInstanceOf(RegistrationPendingError);
      pending = (error as RegistrationPendingError).pending;
    }

    await expect(h.client.retryRegistration(pending!)).rejects.toBeInstanceOf(
      RegistrationPendingError,
    );
    const cached = await h.client.settleOAuthClaim("github", "octocat");

    expect(cached).toBe(first);
    expect(h.provider.submitTransaction).toHaveBeenCalledTimes(2);
    expect(h.calls.filter(({ url }) => url.endsWith("/api/claim"))).toHaveLength(1);
  });

  it("does not trust caller-supplied pending metadata to invalidate an OAuth settlement", async () => {
    const claimTx = "bb".repeat(32);
    let revokeRegistrations = 0;
    const h = await harness({
      route: (url) => {
        if (url.includes("/api/oauth/proof-available?")) {
          return json({ available: true });
        }
        if (url.includes("/api/links/")) {
          return json({
            address: h.signer.address,
            network: "fast:testnet",
            links: [
              {
                kind: "website",
                value: "example.org",
                status: "verified",
                claim_tx: claimTx,
                publicly_visible: true,
              },
            ],
          });
        }
        if (url.endsWith("/api/revoke")) {
          revokeRegistrations += 1;
          return revokeRegistrations === 1
            ? json({ error: "later" }, 500)
            : json({ status: "applied" });
        }
      },
    });

    const first = await h.client.settleOAuthClaim("github", "octocat");
    let pending: PendingRegistration | undefined;
    try {
      await h.client.revoke("website", "example.org");
    } catch (error) {
      expect(error).toBeInstanceOf(RegistrationPendingError);
      pending = (error as RegistrationPendingError).pending;
    }
    expect(pending).toMatchObject({ op: "revoke", kind: "website" });

    await h.client.retryRegistration({
      ...pending!,
      kind: "github",
      value: "octocat",
    });
    const cached = await h.client.settleOAuthClaim("github", "octocat");

    expect(cached).toBe(first);
    expect(h.provider.submitTransaction).toHaveBeenCalledTimes(2);
    expect(h.calls.filter(({ url }) => url.endsWith("/api/claim"))).toHaveLength(1);
  });

  it("allows OAuth settlement to retry after a failure proven to occur before submission", async () => {
    let available = false;
    const h = await harness({
      route: (url) => {
        if (url.includes("/api/oauth/proof-available?")) {
          const answer = json({ available });
          available = true;
          return answer;
        }
      },
    });

    await expect(h.client.settleOAuthClaim("github", "octocat")).rejects.toBeInstanceOf(
      OAuthProofUnavailableError,
    );
    await expect(h.client.settleOAuthClaim("github", "octocat")).resolves.toMatchObject({
      outcome: "verified",
    });
    expect(h.provider.submitTransaction).toHaveBeenCalledTimes(1);
  });

  it("retains an indeterminate OAuth submission so retry cannot pay again", async () => {
    const h = await harness({
      route: (url) =>
        url.includes("/api/oauth/proof-available?") ? json({ available: true }) : undefined,
    });
    h.provider.submitTransaction.mockRejectedValueOnce(new Error("connection closed"));

    const first = h.client.settleOAuthClaim("github", "octocat");
    await expect(first).rejects.toMatchObject({
      name: "IndeterminateSubmissionError",
      mayHavePaid: true,
    });
    await expect(h.client.settleOAuthClaim("github", "octocat")).rejects.toBe(
      await first.catch((error) => error),
    );
    expect(h.provider.submitTransaction).toHaveBeenCalledTimes(1);
  });

  it("refuses settlement when the immediate proof recheck is absent", async () => {
    const h = await harness({
      route: (url) =>
        url.includes("/api/oauth/proof-available?") ? json({ available: false }) : undefined,
    });
    await expect(h.client.settleOAuthClaim("github", "octocat")).rejects.toBeInstanceOf(
      OAuthProofUnavailableError,
    );
    expect(h.sign).not.toHaveBeenCalled();
    expect(h.provider.getAccountInfo).not.toHaveBeenCalled();
    expect(h.provider.submitTransaction).not.toHaveBeenCalled();
  });

  it("does not accept a truthy but non-boolean proof answer", async () => {
    const h = await harness({
      route: (url) =>
        url.includes("/api/oauth/proof-available?") ? json({ available: "true" }) : undefined,
    });
    await expect(h.client.settleOAuthClaim("github", "octocat")).rejects.toBeInstanceOf(
      OAuthProofUnavailableError,
    );
    expect(h.sign).not.toHaveBeenCalled();
    expect(h.provider.submitTransaction).not.toHaveBeenCalled();
  });

});

describe("website proof", () => {
  it("returns a terminal verified registration without an owner-links poll", async () => {
    const h = await harness();
    await expect(
      h.client.claimWebsite("example.org").verifyAndSettle(),
    ).resolves.toMatchObject({ registration: "registered", outcome: "verified" });
    expect(h.calls.some(({ url }) => url.includes("/api/links/"))).toBe(false);
    expect(h.provider.submitTransaction).toHaveBeenCalledTimes(1);
  });

  it("single-flights concurrent and repeated calls on one website instruction", async () => {
    let registeredTx = "";
    const h = await harness({
      route: (url, init, signer) => {
        if (url.endsWith("/api/claim")) {
          registeredTx = String(bodyOf({ init }).tx_id);
          return json({ status: "pending_external_check" });
        }
        if (url.endsWith(`/api/links/${encodeURIComponent(signer.address)}`)) {
          return json({
            address: signer.address,
            network: "fast:testnet",
            links: [
              {
                kind: "website",
                value: "example.org",
                status: "verified",
                claim_tx: registeredTx,
                publicly_visible: true,
              },
            ],
          });
        }
      },
    });
    const claim = h.client.claimWebsite("example.org");
    const options = { timeoutMs: 100, intervalMs: 0 };
    const [first, second] = await Promise.all([
      claim.verifyAndSettle(options),
      claim.verifyAndSettle(options),
    ]);
    const third = await claim.verifyAndSettle(options);

    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(h.provider.submitTransaction).toHaveBeenCalledTimes(1);
  });

  it("honors a pre-aborted website wait before signing or settlement", async () => {
    const controller = new AbortController();
    controller.abort();
    const h = await harness();
    await expect(
      h.client.claimWebsite("example.org").verifyAndSettle({
        timeoutMs: 100,
        intervalMs: 0,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "ProofWaitCancelledError" });
    expect(h.sign).not.toHaveBeenCalled();
    expect(h.provider.getAccountInfo).not.toHaveBeenCalled();
    expect(h.provider.submitTransaction).not.toHaveBeenCalled();
  });

  it("retries a website settlement after a failure proven to precede payment", async () => {
    let feeReads = 0;
    const h = await harness({
      route: (url) => {
        if (url.endsWith("/proxy-rest/v1/network-info")) {
          feeReads += 1;
          if (feeReads === 1) {
            return json({ data: { network_id: "fast:testnet" } });
          }
        }
      },
    });
    const claim = h.client.claimWebsite("example.org");

    await expect(claim.verifyAndSettle()).rejects.toBeInstanceOf(
      FeeUnavailableError,
    );
    await expect(claim.verifyAndSettle()).resolves.toMatchObject({
      registration: "registered",
      outcome: "verified",
    });
    expect(feeReads).toBe(2);
    expect(h.provider.submitTransaction).toHaveBeenCalledTimes(1);
  });

  it("returns paid website recovery when a later wait is already cancelled", async () => {
    const h = await harness({
      route: (url) =>
        url.endsWith("/api/claim")
          ? json({ status: "pending_external_check" })
          : undefined,
    });
    const claim = h.client.claimWebsite("example.org");
    let paidRecovery: unknown;
    try {
      await claim.verifyAndSettle({ timeoutMs: 5, intervalMs: 0 });
    } catch (cause) {
      paidRecovery = cause;
    }
    expect(paidRecovery).toBeInstanceOf(RegistrationPendingError);

    const controller = new AbortController();
    controller.abort();
    await expect(
      claim.verifyAndSettle({
        timeoutMs: 100,
        intervalMs: 0,
        signal: controller.signal,
      }),
    ).rejects.toBe(paidRecovery);
    expect(h.provider.submitTransaction).toHaveBeenCalledTimes(1);
  });

  it("snapshots website wait bounds before paid settlement resumes", async () => {
    const options = { timeoutMs: 5, intervalMs: 0 };
    const h = await harness({
      route: (url) => {
        if (!url.endsWith("/api/claim")) return undefined;
        options.timeoutMs = Number.POSITIVE_INFINITY;
        return json({ status: "pending_external_check" });
      },
    });

    await expect(
      h.client.claimWebsite("example.org").verifyAndSettle(options),
    ).rejects.toBeInstanceOf(RegistrationPendingError);
    expect(h.provider.submitTransaction).toHaveBeenCalledTimes(1);
  });

  it("returns the exact artifact and reconciles pending registration by polling owner links", async () => {
    let linksReads = 0;
    let registeredTx = "";
    const h = await harness({
      route: (url, init, signer) => {
        if (url.endsWith("/api/claim")) {
          registeredTx = String(bodyOf({ init }).tx_id);
          return json({ status: "pending_external_check" });
        }
        if (url.endsWith(`/api/links/${encodeURIComponent(signer.address)}`)) {
          linksReads += 1;
          return json({
            address: signer.address,
            network: "fast:testnet",
            links:
              linksReads === 1
                ? []
                : [
                    {
                      kind: "website",
                      value: "example.org",
                      status: "verified",
                      claim_tx:
                        linksReads === 2
                          ? registeredTx === "22".repeat(32)
                            ? "23".repeat(32)
                            : "22".repeat(32)
                          : registeredTx,
                      publicly_visible: true,
                    },
                  ],
          });
        }
      },
    });
    const claim = h.client.claimWebsite("https://EXAMPLE.org/path");
    expect(claim).toMatchObject({
      host: "example.org",
      proofUrl: "https://example.org/.well-known/fastid",
      proofText: `${h.signer.address}\n`,
    });
    await expect(
      claim.verifyAndSettle({ timeoutMs: 100, intervalMs: 0 }),
    ).resolves.toMatchObject({ registration: "registered", outcome: "verified" });
    expect(linksReads).toBe(3);
    expect(h.provider.submitTransaction).toHaveBeenCalledTimes(1);
  });

  it("times out a hanging website ownership read without another payment", async () => {
    const h = await harness({
      route: (url) => {
        if (url.endsWith("/api/claim")) return json({ status: "pending_external_check" });
        if (url.includes("/api/links/")) return new Promise<Response>(() => {});
      },
    });
    await expect(
      h.client.claimWebsite("example.org").verifyAndSettle({ timeoutMs: 5, intervalMs: 0 }),
    ).rejects.toBeInstanceOf(RegistrationPendingError);
    expect(h.provider.submitTransaction).toHaveBeenCalledTimes(1);
  });

  it("retries only website verification after payment without settling again", async () => {
    let proofAvailable = false;
    let registeredTx = "";
    const h = await harness({
      route: (url, init, signer) => {
        if (url.endsWith("/api/claim")) {
          registeredTx = String(bodyOf({ init }).tx_id);
          return json({ status: "applied" });
        }
        if (url.endsWith(`/api/links/${encodeURIComponent(signer.address)}`)) {
          return json({
            address: signer.address,
            network: "fast:testnet",
            links: proofAvailable
              ? [
                  {
                    kind: "website",
                    value: "example.org",
                    status: "verified",
                    claim_tx: registeredTx,
                    publicly_visible: true,
                  },
                ]
              : [],
          });
        }
      },
    });
    const claim = h.client.claimWebsite("example.org");

    await expect(
      claim.verifyAndSettle({ timeoutMs: 5, intervalMs: 0 }),
    ).rejects.toBeInstanceOf(WebsiteVerificationPendingError);
    proofAvailable = true;
    await expect(
      claim.verifyAndSettle({ timeoutMs: 100, intervalMs: 0 }),
    ).resolves.toMatchObject({ registration: "registered", outcome: "verified" });

    expect(h.provider.getAccountInfo).toHaveBeenCalledTimes(1);
    expect(h.provider.submitTransaction).toHaveBeenCalledTimes(1);
    expect(h.calls.filter(({ url }) => url.endsWith("/api/claim"))).toHaveLength(1);
  });
});

describe("X proof and settlement gate", () => {
  async function xHarness(
    verifyBody: unknown,
    protocol: unknown = "intent-v1",
    commitStatus = 200,
    commitBody: unknown = { committed: true },
  ) {
    return harness({
      route: (url) => {
        if (url.endsWith("/api/profile/challenge")) {
          return json({ expiry: 1_767_225_600, server_nonce: SERVER_NONCE });
        }
        if (url.endsWith("/api/social/x/intent")) {
          return json({
            proof_url: PROOF_URL,
            nonce: PROOF_NONCE,
            expires_at: "2099-01-01T00:00:00Z",
            ...(protocol === undefined ? {} : { protocol }),
          });
        }
        if (url.endsWith("/api/social/x/verify")) return json(verifyBody);
        if (url.endsWith("/api/social/x/commit")) {
          return json(commitStatus === 200 ? commitBody : {}, commitStatus);
        }
      },
    });
  }

  it("fails closed on X availability discovery before challenge or signing", async () => {
    for (const capability of [{ kinds: [] as string[], intent_kinds: ["x"] }, null]) {
      const h = await harness({
        route: (url) =>
          url.endsWith("/api/social/kinds") ? json(capability) : undefined,
      });
      await expect(h.client.startXClaim("yourhandle")).rejects.toMatchObject({
        name: "ProofProtocolError",
      });
      expect(h.calls.some(({ url }) => url.endsWith("/api/profile/challenge"))).toBe(false);
      expect(h.sign).not.toHaveBeenCalled();
      expect(h.provider.submitTransaction).not.toHaveBeenCalled();
    }
  });

  it.each([
    ["missing", { kinds: ["x"] }],
    ["empty", { kinds: ["x"], intent_kinds: [] as string[] }],
    ["malformed", { kinds: ["x"], intent_kinds: "x" }],
  ])("uses the legacy proof route when intent capability is %s", async (_label, capability) => {
    const h = await harness({
      route: (url) => {
        if (url.endsWith("/api/social/kinds")) return json(capability);
        if (url.endsWith("/api/profile/challenge")) {
          return json({ expiry: 1_767_225_600, server_nonce: SERVER_NONCE });
        }
        if (url.endsWith("/api/social/x/proof")) {
          return json({
            proof_url: PROOF_URL,
            nonce: PROOF_NONCE,
            expires_at: "2099-01-01T00:00:00Z",
          });
        }
      },
    });

    await expect(h.client.startXClaim("yourhandle")).resolves.toMatchObject({
      status: "issued",
      proofUrl: PROOF_URL,
    });
    expect(h.calls.some(({ url }) => url.endsWith("/api/social/x/proof"))).toBe(true);
    expect(h.calls.some(({ url }) => url.endsWith("/api/social/x/intent"))).toBe(false);
    expect(h.sign).toHaveBeenCalledTimes(1);
  });

  it("refuses a free intent signature that does not verify against the declared signer", async () => {
    const declared = await KeySigner.fromPrivateKey("02".repeat(32));
    const wrong = await KeySigner.fromPrivateKey("03".repeat(32));
    const signer: Signer = {
      address: declared.address,
      signerHex: declared.signerHex,
      publicKey: declared.publicKey,
      sign: vi.fn((bytes: Uint8Array) => wrong.sign(bytes)),
    };
    const h = await harness({
      signer,
      route: (url) =>
        url.endsWith("/api/profile/challenge")
          ? json({ expiry: 1_767_225_600, server_nonce: SERVER_NONCE })
          : undefined,
    });
    await expect(h.client.startXClaim("yourhandle")).rejects.toBeInstanceOf(
      LocalVerificationError,
    );
    expect(h.calls.some(({ url }) => url.endsWith("/api/social/x/intent"))).toBe(false);
    expect(h.provider.submitTransaction).not.toHaveBeenCalled();
  });

  it("returns an already-settled intent without entering the paid pipeline", async () => {
    const h = await harness({
      route: (url) => {
        if (url.endsWith("/api/profile/challenge")) {
          return json({ expiry: 1_767_225_600, server_nonce: SERVER_NONCE });
        }
        if (url.endsWith("/api/social/x/intent")) {
          return json({ settlement: "applied" });
        }
      },
    });
    await expect(h.client.startXClaim("yourhandle")).resolves.toEqual({
      status: "already-settled",
    });
    expect(h.provider.getAccountInfo).not.toHaveBeenCalled();
    expect(h.provider.submitTransaction).not.toHaveBeenCalled();
  });

  it.each([undefined, "intent-v2"])(
    "does not trust an applied intent without the exact protocol (%s)",
    async (protocol) => {
      const h = await harness({
        route: (url) => {
          if (url.endsWith("/api/profile/challenge")) {
            return json({ expiry: 1_767_225_600, server_nonce: SERVER_NONCE });
          }
          if (url.endsWith("/api/social/x/intent")) {
            return json({
              proof_url: PROOF_URL,
              nonce: PROOF_NONCE,
              expires_at: "2099-01-01T00:00:00Z",
              ...(protocol === undefined ? {} : { protocol }),
              settlement: "applied",
            });
          }
        },
      });

      await expect(h.client.startXClaim("yourhandle")).resolves.toMatchObject({
        status: "issued",
        handle: "yourhandle",
      });
      expect(h.provider.getAccountInfo).not.toHaveBeenCalled();
      expect(h.provider.submitTransaction).not.toHaveBeenCalled();
    },
  );

  it("treats an unknown X intent protocol as legacy and requires a confirmed commit", async () => {
    const h = await xHarness({ verified: true }, "intent-v2");
    const start = await h.client.startXClaim("yourhandle");
    if (start.status !== "issued") throw new Error("expected issued session");
    await start.verifyPost("https://x.com/yourhandle/status/123");
    h.sign.mockClear();
    await expect(start.settle()).resolves.toMatchObject({ outcome: "verified" });
    expect(h.calls.some(({ url }) => url.endsWith("/api/social/x/commit"))).toBe(true);
    expect(h.sign).toHaveBeenCalledTimes(2); // free commit plus paid claim
    expect(h.provider.submitTransaction).toHaveBeenCalledTimes(1);
  });

  it("keeps the issued URL byte-identical and pays only after a committed verification", async () => {
    const h = await xHarness({ verified: true, settlement: "committed" });
    const start = await h.client.startXClaim("@YourHandle");
    expect(start.status).toBe("issued");
    if (start.status !== "issued") throw new Error("expected issued session");
    expect(start.getProofPost()).toEqual({
      text: `One identity across the Fast Network. Linking this account to my Fast ID:\n\n${PROOF_URL}`,
      composerUrl: `https://x.com/intent/post?text=${encodeURIComponent(`One identity across the Fast Network. Linking this account to my Fast ID:\n\n${PROOF_URL}`).replace(/%20/g, "+")}`,
    });
    await expect(start.verifyPost("https://x.com/yourhandle/status/123")).resolves.toEqual({
      verified: true,
      settlement: "committed",
    });
    h.sign.mockClear();
    await expect(start.settle()).resolves.toMatchObject({ outcome: "verified" });
    expect(h.sign).toHaveBeenCalledTimes(1);
    expect(h.provider.submitTransaction).toHaveBeenCalledTimes(1);
  });

  it("freezes an issued X session so its verified handle cannot be rebound", async () => {
    const h = await xHarness({ verified: true, settlement: "committed" });
    const start = await h.client.startXClaim("yourhandle");
    if (start.status !== "issued") throw new Error("expected issued session");

    expect(Object.isFrozen(start)).toBe(true);
    expect(Reflect.set(start, "handle", "anotherhandle")).toBe(false);
    expect(start.handle).toBe("yourhandle");
    await start.verifyPost("https://x.com/yourhandle/status/123");
    h.sign.mockClear();
    await expect(start.settle()).resolves.toMatchObject({ outcome: "verified" });
    expect(h.provider.submitTransaction).toHaveBeenCalledTimes(1);
  });

  it("single-flights repeated settlement calls so one verified session can pay only once", async () => {
    const h = await xHarness({ verified: true, settlement: "committed" });
    const start = await h.client.startXClaim("yourhandle");
    if (start.status !== "issued") throw new Error("expected issued session");
    await start.verifyPost("https://x.com/yourhandle/status/123");
    h.sign.mockClear();

    const [first, second] = await Promise.all([start.settle(), start.settle()]);
    const third = await start.settle();
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(h.sign).toHaveBeenCalledTimes(1);
    expect(h.provider.submitTransaction).toHaveBeenCalledTimes(1);
  });

  it("retries X settlement after a failure proven to precede payment", async () => {
    let feeReads = 0;
    const h = await harness({
      route: (url) => {
        if (url.endsWith("/api/profile/challenge")) {
          return json({ expiry: 1_767_225_600, server_nonce: SERVER_NONCE });
        }
        if (url.endsWith("/api/social/x/intent")) {
          return json({
            proof_url: PROOF_URL,
            nonce: PROOF_NONCE,
            expires_at: "2099-01-01T00:00:00Z",
            protocol: "intent-v1",
          });
        }
        if (url.endsWith("/api/social/x/verify")) {
          return json({ verified: true, settlement: "committed" });
        }
        if (url.endsWith("/proxy-rest/v1/network-info")) {
          feeReads += 1;
          if (feeReads === 1) {
            return json({ data: { network_id: "fast:testnet" } });
          }
        }
      },
    });
    const start = await h.client.startXClaim("yourhandle");
    if (start.status !== "issued") throw new Error("expected issued session");
    await start.verifyPost("https://x.com/yourhandle/status/123");

    await expect(start.settle()).rejects.toBeInstanceOf(FeeUnavailableError);
    await expect(start.settle()).resolves.toMatchObject({
      registration: "registered",
      outcome: "verified",
    });
    expect(feeReads).toBe(2);
    expect(h.provider.submitTransaction).toHaveBeenCalledTimes(1);
  });

  it("retains paid X recovery across a later failed verification", async () => {
    let verifyCalls = 0;
    const h = await harness({
      route: (url) => {
        if (url.endsWith("/api/profile/challenge")) {
          return json({ expiry: 1_767_225_600, server_nonce: SERVER_NONCE });
        }
        if (url.endsWith("/api/social/x/intent")) {
          return json({
            proof_url: PROOF_URL,
            nonce: PROOF_NONCE,
            expires_at: "2099-01-01T00:00:00Z",
            protocol: "intent-v1",
          });
        }
        if (url.endsWith("/api/social/x/verify")) {
          verifyCalls += 1;
          return verifyCalls === 1
            ? json({ verified: true, settlement: "committed" })
            : json({}, 503);
        }
        if (url.endsWith("/api/claim")) {
          return json({ status: "pending_external_check" });
        }
      },
    });
    const start = await h.client.startXClaim("yourhandle");
    if (start.status !== "issued") throw new Error("expected issued session");
    await start.verifyPost("https://x.com/yourhandle/status/123");
    let paidRecovery: unknown;
    try {
      await start.settle();
    } catch (cause) {
      paidRecovery = cause;
    }
    expect(paidRecovery).toBeInstanceOf(RegistrationPendingError);

    await expect(
      start.verifyPost("https://x.com/yourhandle/status/123"),
    ).resolves.toMatchObject({ verified: false, status: "retry" });
    await expect(start.settle()).rejects.toBe(paidRecovery);
    expect(h.provider.submitTransaction).toHaveBeenCalledTimes(1);
  });

  it("lets terminal applied verification supersede cached paid X recovery", async () => {
    let verifyCalls = 0;
    const h = await harness({
      route: (url) => {
        if (url.endsWith("/api/profile/challenge")) {
          return json({ expiry: 1_767_225_600, server_nonce: SERVER_NONCE });
        }
        if (url.endsWith("/api/social/x/intent")) {
          return json({
            proof_url: PROOF_URL,
            nonce: PROOF_NONCE,
            expires_at: "2099-01-01T00:00:00Z",
            protocol: "intent-v1",
          });
        }
        if (url.endsWith("/api/social/x/verify")) {
          verifyCalls += 1;
          if (verifyCalls === 1) {
            return json({ verified: true, settlement: "committed" });
          }
          if (verifyCalls === 2) {
            return json({ verified: true, settlement: "applied" });
          }
          return json({}, 503);
        }
        if (url.endsWith("/api/claim")) {
          throw new TypeError("registration response lost");
        }
      },
    });
    const start = await h.client.startXClaim("yourhandle");
    if (start.status !== "issued") throw new Error("expected issued session");
    await start.verifyPost("https://x.com/yourhandle/status/123");
    await expect(start.settle()).rejects.toBeInstanceOf(RegistrationPendingError);
    const signerCalls = h.sign.mock.calls.length;
    const accountCalls = h.provider.getAccountInfo.mock.calls.length;
    const submissionCalls = h.provider.submitTransaction.mock.calls.length;

    await expect(
      start.verifyPost("https://x.com/yourhandle/status/123"),
    ).resolves.toEqual({ verified: true, settlement: "applied" });
    await expect(
      start.verifyPost("https://x.com/yourhandle/status/123"),
    ).resolves.toMatchObject({ verified: false, status: "retry" });
    await expect(start.settle()).resolves.toEqual({ status: "already-settled" });

    expect(h.sign).toHaveBeenCalledTimes(signerCalls);
    expect(h.provider.getAccountInfo).toHaveBeenCalledTimes(accountCalls);
    expect(h.provider.submitTransaction).toHaveBeenCalledTimes(submissionCalls);
    expect(submissionCalls).toBe(1);
  });

  it("treats applied as complete and performs no paid signing or provider calls", async () => {
    const h = await xHarness({ verified: true, settlement: "applied" });
    const start = await h.client.startXClaim("yourhandle");
    if (start.status !== "issued") throw new Error("expected issued session");
    await start.verifyPost("https://x.com/yourhandle/status/123");
    h.sign.mockClear();
    await expect(start.settle()).resolves.toEqual({ status: "already-settled" });
    expect(h.sign).not.toHaveBeenCalled();
    expect(h.provider.getAccountInfo).not.toHaveBeenCalled();
    expect(h.provider.submitTransaction).not.toHaveBeenCalled();
  });

  it("retains terminal applied state across a later failed verification", async () => {
    let verifyCalls = 0;
    const h = await harness({
      route: (url) => {
        if (url.endsWith("/api/profile/challenge")) {
          return json({ expiry: 1_767_225_600, server_nonce: SERVER_NONCE });
        }
        if (url.endsWith("/api/social/x/intent")) {
          return json({
            proof_url: PROOF_URL,
            nonce: PROOF_NONCE,
            expires_at: "2099-01-01T00:00:00Z",
            protocol: "intent-v1",
          });
        }
        if (url.endsWith("/api/social/x/verify")) {
          verifyCalls += 1;
          return verifyCalls === 1
            ? json({ verified: true, settlement: "applied" })
            : json({}, 503);
        }
      },
    });
    const start = await h.client.startXClaim("yourhandle");
    if (start.status !== "issued") throw new Error("expected issued session");

    await expect(
      start.verifyPost("https://x.com/yourhandle/status/123"),
    ).resolves.toEqual({ verified: true, settlement: "applied" });
    await expect(
      start.verifyPost("https://x.com/yourhandle/status/123"),
    ).resolves.toMatchObject({ verified: false, status: "retry" });
    await expect(start.settle()).resolves.toEqual({ status: "already-settled" });
    expect(h.provider.getAccountInfo).not.toHaveBeenCalled();
    expect(h.provider.submitTransaction).not.toHaveBeenCalled();
  });

  it.each([undefined, "future-state"])(
    "refuses an absent or unknown settlement tag (%s) without a paid claim",
    async (settlement) => {
      const h = await xHarness({
        verified: true,
        ...(settlement ? { settlement } : {}),
      });
      const start = await h.client.startXClaim("yourhandle");
      if (start.status !== "issued") throw new Error("expected issued session");
      await start.verifyPost("https://x.com/yourhandle/status/123");
      h.sign.mockClear();
      await expect(start.settle()).rejects.toBeInstanceOf(XSettlementNotAuthorizedError);
      expect(h.sign).not.toHaveBeenCalled();
      expect(h.provider.submitTransaction).not.toHaveBeenCalled();
    },
  );

  it("requires a confirmed legacy commit and never reaches paid settlement when commit fails", async () => {
    const h = await xHarness({ verified: true }, null, 409);
    const start = await h.client.startXClaim("yourhandle");
    if (start.status !== "issued") throw new Error("expected issued session");
    await start.verifyPost("https://x.com/yourhandle/status/123");
    h.sign.mockClear();
    await expect(start.settle()).rejects.toBeInstanceOf(XSettlementNotAuthorizedError);
    expect(h.sign).toHaveBeenCalledTimes(1); // free commit message only
    expect(h.provider.getAccountInfo).not.toHaveBeenCalled();
    expect(h.provider.submitTransaction).not.toHaveBeenCalled();
  });

  it("requires committed true to be the exact legacy commit response", async () => {
    const h = await xHarness(
      { verified: true },
      null,
      200,
      { committed: true, error: "not committed" },
    );
    const start = await h.client.startXClaim("yourhandle");
    if (start.status !== "issued") throw new Error("expected issued session");
    await start.verifyPost("https://x.com/yourhandle/status/123");
    h.sign.mockClear();

    await expect(start.settle()).rejects.toBeInstanceOf(
      XSettlementNotAuthorizedError,
    );
    expect(h.sign).toHaveBeenCalledTimes(1);
    expect(h.provider.getAccountInfo).not.toHaveBeenCalled();
    expect(h.provider.submitTransaction).not.toHaveBeenCalled();
  });

  it("does not expose mutable X verification state to callers", async () => {
    const h = await xHarness({ verified: true }, null, 409);
    const start = await h.client.startXClaim("yourhandle");
    if (start.status !== "issued") throw new Error("expected issued session");
    const result = await start.verifyPost("https://x.com/yourhandle/status/123");
    if (!result.verified) throw new Error("expected verified proof");
    result.settlement = "committed";
    h.sign.mockClear();

    await expect(start.settle()).rejects.toBeInstanceOf(
      XSettlementNotAuthorizedError,
    );
    expect(h.calls.some(({ url }) => url.endsWith("/api/social/x/commit"))).toBe(
      true,
    );
    expect(h.sign).toHaveBeenCalledTimes(1);
    expect(h.provider.getAccountInfo).not.toHaveBeenCalled();
    expect(h.provider.submitTransaction).not.toHaveBeenCalled();
  });

  it.each(["committed", "applied"] as const)(
    "requires legacy /commit when /verify contradictorily reports %s",
    async (settlement) => {
      const h = await harness({
        route: (url) => {
          if (url.endsWith("/api/social/kinds")) {
            return json({ kinds: ["x"], intent_kinds: [] });
          }
          if (url.endsWith("/api/profile/challenge")) {
            return json({ expiry: 1_767_225_600, server_nonce: SERVER_NONCE });
          }
          if (url.endsWith("/api/social/x/proof")) {
            return json({
              proof_url: PROOF_URL,
              nonce: PROOF_NONCE,
              expires_at: "2099-01-01T00:00:00Z",
            });
          }
          if (url.endsWith("/api/social/x/verify")) {
            return json({ verified: true, settlement });
          }
          if (url.endsWith("/api/social/x/commit")) return json({}, 409);
        },
      });
      const start = await h.client.startXClaim("yourhandle");
      if (start.status !== "issued") throw new Error("expected issued session");
      await start.verifyPost("https://x.com/yourhandle/status/123");
      h.sign.mockClear();

      await expect(start.settle()).rejects.toBeInstanceOf(XSettlementNotAuthorizedError);
      expect(h.calls.some(({ url }) => url.endsWith("/api/social/x/commit"))).toBe(true);
      expect(h.sign).toHaveBeenCalledTimes(1); // free commit message only
      expect(h.provider.getAccountInfo).not.toHaveBeenCalled();
      expect(h.provider.submitTransaction).not.toHaveBeenCalled();
    },
  );
});
