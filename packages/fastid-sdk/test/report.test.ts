import { describe, expect, it, vi } from "vitest";

import {
  IdClient,
  IndeterminateReportSubmissionError,
  InvalidReportError,
  KeySigner,
  LocalVerificationError,
  ReportBodyTooLargeError,
  ReportCiphertextTooLargeError,
  ReportConfigError,
  ReportRejectedError,
  REPORT_BODY_LIMIT,
} from "../src/index.js";
import { toHex } from "../src/address.js";
import {
  attributionMessage,
  formatReceivedHour,
  hourUnixSecs,
} from "../src/report-wire.js";
import { serializeReportEnvelope } from "../src/report.js";
import { verifyStrict } from "../src/verify.js";

const RECIPIENT_KEY =
  "5b29957b1a098438c42d313606bca96da23cdfaa0cf15983e9fed5dda0d2255b";
const SENTINEL = "SENTINEL report content must be sealed";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function harness(reportResponse: Response = json({ status: "stored" })) {
  const signer = await KeySigner.fromPrivateKey("01".repeat(32));
  const originalSign = signer.sign.bind(signer);
  const sign = vi.spyOn(signer, "sign");
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith("/api/report/config")) {
        return json({
          areas: ["claim", "profile", "other"],
          hpke: {
            suite: "DhkemX25519HkdfSha256/HkdfSha256/Aes256Gcm",
            info: "fast.xyz/key-handover/v1",
          },
          recipients: [
            { key_id: "test-recipient", public_key: RECIPIENT_KEY },
          ],
        });
      }
      if (url.endsWith("/api/report")) return reportResponse;
      throw new Error(`unexpected URL ${url}`);
    },
  );
  const client = new IdClient({
    network: "fast:testnet",
    signer,
    fetchImpl: fetchImpl as typeof fetch,
    provider: {} as never,
  });
  return { client, signer, sign, originalSign, calls, fetchImpl };
}

function reportPosts(calls: Array<{ url: string; init?: RequestInit }>) {
  return calls.filter(({ url }) => url.endsWith("/api/report"));
}

describe("sealed reports", () => {
  // Private index-fixture crossing coverage runs in fast-id's id-sdk gate.

  it("fetches config first and sends the exact anonymous sealed envelope", async () => {
    const h = await harness();
    const at = new Date();
    await expect(
      h.client.submitReport({
        area: "claim",
        whatHappened: SENTINEL,
        whatExpected: "A stored result",
        severity: "blocked",
        page: "/claim",
        attribution: "anonymous",
        at,
      }),
    ).resolves.toEqual({ status: "stored" });

    expect(h.calls.map(({ url }) => url)).toEqual([
      "https://testnet.id.fast.xyz/api/report/config",
      "https://testnet.id.fast.xyz/api/report",
    ]);
    const serialized = String(reportPosts(h.calls)[0].init?.body);
    expect(new TextEncoder().encode(serialized).byteLength).toBeLessThanOrEqual(
      REPORT_BODY_LIMIT,
    );
    expect(serialized).not.toContain(SENTINEL);
    expect(serialized).not.toContain("A stored result");
    const envelope = JSON.parse(serialized) as Record<string, unknown>;
    expect(Object.keys(envelope).sort()).toEqual([
      "area",
      "attribution",
      "received_hour",
      "seals",
      "v",
    ]);
    expect(envelope).toMatchObject({
      v: 1,
      area: "claim",
      received_hour: formatReceivedHour(at),
      attribution: "anonymous",
    });
    expect(h.sign).not.toHaveBeenCalled();
  });

  it("snapshots every caller-owned report field before asynchronous work", async () => {
    const h = await harness();
    const reads = new Map<string, number>();
    const values = {
      area: "claim",
      whatHappened: SENTINEL,
      whatExpected: "A stored result",
      severity: "blocked",
      page: "/claim",
      attribution: "anonymous",
      connectionId: "connection-7",
      viewport: "1440x900",
      locale: "pt-BR",
      at: new Date(),
    } as const;
    const input = Object.fromEntries(
      Object.entries(values).map(([name, value]) => [
        name,
        {
          enumerable: true,
          get() {
            reads.set(name, (reads.get(name) ?? 0) + 1);
            return value;
          },
        },
      ]),
    );
    const callerOwned = Object.defineProperties({}, input);

    await expect(h.client.submitReport(callerOwned as never)).resolves.toEqual({
      status: "stored",
    });

    expect(Object.fromEntries(reads)).toEqual(
      Object.fromEntries(Object.keys(values).map((name) => [name, 1])),
    );
    const envelope = JSON.parse(
      String(reportPosts(h.calls)[0].init?.body),
    ) as Record<string, unknown>;
    expect(envelope).toMatchObject({ area: "claim", attribution: "anonymous" });
    expect(h.sign).not.toHaveBeenCalled();
  });

  it.each([
    ["rejected body", json({ status: "rejected" })],
    ["extended acknowledgement", json({ status: "stored", unexpected: true })],
    ["empty body", new Response("", { status: 200 })],
    ["accepted status", json({ status: "stored" }, 202)],
    ["no-content status", new Response(null, { status: 204 })],
  ])("keeps an unexpected successful %s indeterminate without retry", async (_case, response) => {
    const h = await harness(response);

    await expect(
      h.client.submitReport({
        area: "claim",
        whatHappened: "submission result unknown",
        whatExpected: "stored acknowledgement",
        severity: "blocked",
        page: "/report",
        attribution: "anonymous",
      }),
    ).rejects.toBeInstanceOf(IndeterminateReportSubmissionError);
    expect(reportPosts(h.calls)).toHaveLength(1);
  });

  it.each([500, 502, 503, 599])("treats report HTTP %s as indeterminate without retry", async (status) => {
    const h = await harness(json({ error: "upstream failure" }, status));

    await expect(
      h.client.submitReport({
        area: "claim",
        whatHappened: "report response was ambiguous",
        whatExpected: "stored acknowledgement",
        severity: "blocked",
        page: "/report",
        attribution: "anonymous",
      }),
    ).rejects.toMatchObject({
      name: "IndeterminateReportSubmissionError",
      mayHaveStored: true,
    });
    expect(reportPosts(h.calls)).toHaveLength(1);
  });

  it("keeps an explicit report HTTP 4xx rejection definitive", async () => {
    const h = await harness(json({ error: "invalid report" }, 422));

    await expect(
      h.client.submitReport({
        area: "claim",
        whatHappened: "report was explicitly rejected",
        whatExpected: "rejected acknowledgement",
        severity: "blocked",
        page: "/report",
        attribution: "anonymous",
      }),
    ).rejects.toMatchObject({
      name: "ReportRejectedError",
      status: 422,
    } satisfies Partial<ReportRejectedError>);
    expect(reportPosts(h.calls)).toHaveLength(1);
  });

  it("rejects an unknown runtime attribution before config, sealing, or signing", async () => {
    const h = await harness();
    await expect(
      h.client.submitReport({
        area: "claim",
        whatHappened: "bad attribution discriminant",
        whatExpected: "rejected",
        severity: "blocked",
        page: "/claim",
        attribution: "anonmous",
      } as never),
    ).rejects.toMatchObject({ name: "InvalidReportError" });
    expect(h.calls).toHaveLength(0);
    expect(h.sign).not.toHaveBeenCalled();
  });

  it("rejects malformed JavaScript input with a typed error before any I/O", async () => {
    const valid = {
      area: "claim",
      whatHappened: "broken",
      whatExpected: "fixed",
      severity: "blocked",
      page: "/claim",
      attribution: "anonymous",
    };
    for (const input of [
      null,
      { ...valid, area: null },
      { ...valid, whatHappened: null },
      { ...valid, whatExpected: null },
      { ...valid, severity: "urgent" },
      { ...valid, page: null },
      { ...valid, connectionId: 7 },
      { ...valid, viewport: false },
      { ...valid, locale: [] },
      { ...valid, at: 1 },
    ]) {
      const h = await harness();
      await expect(h.client.submitReport(input as never)).rejects.toMatchObject({
        name: "InvalidReportError",
        message: expect.stringMatching(/report input.*protocol limits/i),
      });
      expect(h.calls).toHaveLength(0);
      expect(h.sign).not.toHaveBeenCalled();
    }
  });

  it("rejects report hours outside the backend acceptance window before I/O", async () => {
    const currentHour = Date.parse(formatReceivedHour(new Date()));
    for (const at of [
      new Date(currentHour - 2 * 60 * 60 * 1_000),
      new Date(currentHour + 2 * 60 * 60 * 1_000),
    ]) {
      const h = await harness();
      await expect(
        h.client.submitReport({
          area: "claim",
          whatHappened: "broken",
          whatExpected: "fixed",
          severity: "blocked",
          page: "/claim",
          attribution: "anonymous",
          at,
        }),
      ).rejects.toMatchObject({
        name: "InvalidReportError",
        message: expect.stringMatching(/hour.*window/i),
      });
      expect(h.calls).toHaveLength(0);
      expect(h.sign).not.toHaveBeenCalled();
    }
  });

  it("signs attribution over the exact seals and locally verifies it", async () => {
    const h = await harness();
    await h.client.submitReport({
      area: "profile",
      whatHappened: SENTINEL,
      whatExpected: "fixed",
      severity: "annoying",
      page: "/profile/edit",
      connectionId: "connection-7",
      viewport: "1440x900",
      locale: "pt-BR",
      attribution: "signed",
    });
    const envelope = JSON.parse(
      String(reportPosts(h.calls)[0].init?.body),
    ) as {
      area: string;
      received_hour: string;
      seals: Array<{
        recipient_key_id: string;
        enc: string;
        ciphertext: string;
      }>;
      attribution: {
        signed: { signer_addr: string; signature: string };
      };
    };
    expect(envelope.attribution).toEqual({
      signed: {
        signer_addr: h.signer.signerHex,
        signature: expect.stringMatching(/^[0-9a-f]{128}$/),
      },
    });
    const message = attributionMessage(
      envelope.area,
      hourUnixSecs(envelope.received_hour),
      envelope.seals,
    );
    expect(
      verifyStrict(
        message,
        envelope.attribution.signed.signature,
        h.signer.publicKey,
      ),
    ).toBe(true);
    expect(h.sign).toHaveBeenCalledTimes(1);
  });

  it("measures the exact serialized envelope and refuses a body above the backend limit", () => {
    expect(() =>
      serializeReportEnvelope({
        v: 1,
        area: "x".repeat(REPORT_BODY_LIMIT),
        received_hour: "2026-09-14T14:00:00Z",
        seals: [],
        attribution: "anonymous",
      }),
    ).toThrowError(expect.objectContaining({
      name: "ReportBodyTooLargeError",
      limit: REPORT_BODY_LIMIT,
    } satisfies Partial<ReportBodyTooLargeError>));
  });

  it("refuses a ciphertext above the backend per-seal limit", async () => {
    const h = await harness();
    await expect(
      h.client.submitReport({
        area: "claim",
        whatHappened: "short",
        whatExpected: "",
        severity: "blocked",
        page: "/claim",
        connectionId: "x".repeat(70_000),
        attribution: "signed",
      }),
    ).rejects.toMatchObject({
      name: "ReportCiphertextTooLargeError",
      limit: 64 * 1024,
    } satisfies Partial<ReportCiphertextTooLargeError>);
    expect(h.calls.filter(({ url }) => url.endsWith("/api/report/config"))).toHaveLength(1);
    expect(reportPosts(h.calls)).toHaveLength(0);
    expect(h.sign).not.toHaveBeenCalled();
  });

  it("rejects plaintext that cannot fit before invoking HPKE", async () => {
    const h = await harness();
    h.fetchImpl.mockImplementationOnce(async () =>
      json({
        areas: ["claim"],
        hpke: {
          suite: "DhkemX25519HkdfSha256/HkdfSha256/Aes256Gcm",
          info: "fast.xyz/key-handover/v1",
        },
        recipients: [{ key_id: "unusable-key", public_key: "00".repeat(32) }],
      }),
    );

    await expect(
      h.client.submitReport({
        area: "claim",
        whatHappened: "short",
        whatExpected: "",
        severity: "blocked",
        page: "/claim",
        connectionId: "x".repeat(70_000),
        attribution: "signed",
      }),
    ).rejects.toBeInstanceOf(ReportCiphertextTooLargeError);
    expect(h.sign).not.toHaveBeenCalled();
    expect(reportPosts(h.calls)).toHaveLength(0);
  });

  it("reports malformed successful configuration responses without an HTTP status failure", async () => {
    const h = await harness();
    h.fetchImpl.mockImplementationOnce(async () =>
      new Response("{", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      h.client.submitReport({
        area: "claim",
        whatHappened: "short",
        whatExpected: "fixed",
        severity: "blocked",
        page: "/claim",
        attribution: "anonymous",
      }),
    ).rejects.toMatchObject({
      name: "ReportConfigError",
      status: undefined,
      message: "report configuration is unavailable or malformed",
    } satisfies Partial<ReportConfigError>);
    expect(h.sign).not.toHaveBeenCalled();
    expect(reportPosts(h.calls)).toHaveLength(0);
  });

  it("refuses a wrong-key signed attribution before the report POST", async () => {
    const h = await harness();
    const wrong = await KeySigner.fromPrivateKey("02".repeat(32));
    h.sign.mockImplementationOnce((bytes) => wrong.sign(bytes));
    await expect(
      h.client.submitReport({
        area: "claim",
        whatHappened: "short",
        whatExpected: "",
        severity: "blocked",
        page: "/claim",
        attribution: "signed",
      }),
    ).rejects.toBeInstanceOf(LocalVerificationError);
    expect(reportPosts(h.calls)).toHaveLength(0);
  });

  it("fails closed when the server advertises a different HPKE contract", async () => {
    const h = await harness();
    h.fetchImpl.mockImplementationOnce(async () =>
      json({
        areas: ["claim"],
        hpke: { suite: "different", info: "different" },
        recipients: [
          { key_id: "test-recipient", public_key: RECIPIENT_KEY },
        ],
      }),
    );
    await expect(
      h.client.submitReport({
        area: "claim",
        whatHappened: "short",
        whatExpected: "",
        severity: "blocked",
        page: "/claim",
        attribution: "anonymous",
      }),
    ).rejects.toBeInstanceOf(ReportConfigError);
    expect(h.sign).not.toHaveBeenCalled();
    expect(reportPosts(h.calls)).toHaveLength(0);
  });

  it("rejects recipient counts and key IDs outside the backend wire limits", async () => {
    for (const recipients of [
      Array.from({ length: 9 }, (_, index) => ({
        key_id: `recipient-${index}`,
        public_key: RECIPIENT_KEY,
      })),
      [{ key_id: "", public_key: RECIPIENT_KEY }],
      [{ key_id: "a".repeat(65), public_key: RECIPIENT_KEY }],
      [{ key_id: "not\nvisible", public_key: RECIPIENT_KEY }],
      [{ key_id: "with space", public_key: RECIPIENT_KEY }],
      [{ key_id: "não-ascii", public_key: RECIPIENT_KEY }],
    ]) {
      const h = await harness();
      h.fetchImpl.mockImplementationOnce(async () =>
        json({
          areas: ["claim"],
          hpke: {
            suite: "DhkemX25519HkdfSha256/HkdfSha256/Aes256Gcm",
            info: "fast.xyz/key-handover/v1",
          },
          recipients,
        }),
      );
      await expect(
        h.client.submitReport({
          area: "claim",
          whatHappened: "short",
          whatExpected: "fixed",
          severity: "blocked",
          page: "/claim",
          attribution: "anonymous",
        }),
      ).rejects.toBeInstanceOf(ReportConfigError);
      expect(reportPosts(h.calls)).toHaveLength(0);
    }
  });
});

describe("share links", () => {
  it("builds profile, id.json, and Open Graph URLs on the selected network", async () => {
    const h = await harness();
    expect(h.client.share.profileUrl("alice.smith")).toBe(
      "https://testnet.id.fast.xyz/alice.smith",
    );
    expect(h.client.share.idJsonUrl("alice.smith")).toBe(
      "https://testnet.id.fast.xyz/alice.smith/id.json",
    );
    expect(h.client.share.ogImageUrl("alice.smith")).toBe(
      "https://testnet.id.fast.xyz/alice.smith/opengraph-image",
    );
  });
});
