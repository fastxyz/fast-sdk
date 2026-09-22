import { describe, expect, it, vi } from "vitest";

import {
  FeeUnavailableError,
  IdClient,
  IndeterminateSubmissionError,
  InvalidPendingRegistrationError,
  InvalidSignerError,
  KeySigner,
  LocalVerificationError,
  NameUnavailableError,
  NonceConflictError,
  PendingNetworkMismatchError,
  PreSubmitError,
  RegistrationPendingError,
  RegistrationTerminalError,
  SigningError,
  type PendingRegistration,
  type Signer,
  type TerminalRegistrationDisposition,
} from "../src/index.js";
import * as publicApi from "../src/index.js";
import { classifyPreflight } from "../src/claim-preflight.js";

const TOKEN_ID = "11".repeat(32);
const CLAIM_TX_ID = "22".repeat(32);
const SIGNER_ADDRESS =
  "fast132yw8ht5p8cetl2jmvknewjawt9xwzdlrk2pyxlnwjyqrdq0dawqkehkfr";
const OTHER_ADDRESS =
  "fast1rsxfj84yhsskpr6g5ll2td7pkk3dnlsfwldsmawca4922qn3dqvqsxelzv";

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
        [
          TOKEN_ID,
          { token_name: "testUSDC", decimals: 6, update_id: 3 },
        ],
      ],
    },
  });
}

function eligible(): Response {
  return json({
    network: "fast:testnet",
    available: true,
    taken: false,
    skeleton_conflict: false,
    reserved: false,
  });
}

interface ProviderHarness {
  getAccountInfo: ReturnType<typeof vi.fn>;
  submitTransaction: ReturnType<typeof vi.fn>;
}

function settledProvider(): ProviderHarness {
  return {
    getAccountInfo: vi.fn(async () => ({ nextNonce: 5n })),
    submitTransaction: vi.fn(async (envelope: { transaction: unknown }) => ({
      type: "Success",
      value: { envelope: { transaction: envelope.transaction } },
    })),
  };
}

interface HarnessOptions {
  registration?: Response[];
  availability?: Response;
  networkInfo?: Response;
  links?: unknown;
  identity?: unknown;
  identityResponse?: Response;
  identityError?: unknown;
  resolved?: unknown;
  provider?: ProviderHarness;
  signer?: Signer;
}

async function harness(options: HarnessOptions = {}) {
  const signer = options.signer ?? (await KeySigner.fromPrivateKey("01".repeat(32)));
  const sign = vi.spyOn(signer, "sign");
  const provider = options.provider ?? settledProvider();
  const registration = [...(options.registration ?? [json({ status: "applied", disposition: "fresh" })])];
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes("/api/availability?")) return options.availability ?? eligible();
    if (url.endsWith("/proxy-rest/v1/network-info")) {
      return options.networkInfo ?? feeNetworkInfo();
    }
    if (url.includes("/proxy-rest/v1/tokens?")) return feeTokenMeta();
    if (url.endsWith(`/api/links/${encodeURIComponent(signer.address)}`)) {
      return json(
        options.links ?? {
          address: signer.address,
          network: "fast:testnet",
          links: [],
        },
      );
    }
    if (url.endsWith(`/${encodeURIComponent(signer.address)}/identity.json`)) {
      if (options.identityError !== undefined) throw options.identityError;
      return (
        options.identityResponse ??
        json(options.identity ?? { network: "fast:testnet", address: signer.address })
      );
    }
    if (url.endsWith(`/${encodeURIComponent(signer.address)}/id.json`)) {
      return json(
        options.resolved ?? {
          id: `https://testnet.id.fast.xyz/${signer.address}`,
          network: "fast:testnet",
          address: signer.address,
          imported_works: [],
        },
      );
    }
    if (url.endsWith("/api/claim") || url.endsWith("/api/revoke")) {
      return registration.shift() ?? json({ status: "applied", disposition: "replay" });
    }
    throw new Error(`unexpected URL ${url}`);
  });
  const client = new IdClient({
    network: "fast:testnet",
    signer,
    fetchImpl: fetchImpl as typeof fetch,
    provider: provider as never,
  });
  return { client, signer, sign, provider, fetchImpl, calls };
}

function registrationCalls(calls: Array<{ url: string; init?: RequestInit }>) {
  return calls.filter(({ url }) => url.endsWith("/api/claim") || url.endsWith("/api/revoke"));
}

function pending(overrides: Partial<PendingRegistration> = {}): PendingRegistration {
  return {
    op: "claim",
    network: "fast:testnet",
    addressHex: "33".repeat(32),
    name: "alice.smith",
    nonce: "5",
    txIdHex: "44".repeat(32),
    ...overrides,
  };
}

describe("claim preflight", () => {
  it("classifies only a complete same-network free snapshot as eligible", () => {
    expect(
      classifyPreflight(
        {
          network: "fast:testnet",
          available: true,
          taken: false,
          skeleton_conflict: false,
          reserved: false,
        },
        "fast:testnet",
      ),
    ).toBe("eligible");
    expect(
      classifyPreflight(
        {
          network: "fast:testnet",
          available: true,
          skeleton_conflict: false,
          reserved: false,
        },
        "fast:testnet",
      ),
    ).toBe("eligible");
    expect(
      classifyPreflight(
        {
          network: "fast:mainnet",
          available: true,
          taken: false,
          skeleton_conflict: false,
          reserved: false,
        },
        "fast:testnet",
      ),
    ).toBe("indeterminate");
    expect(
      classifyPreflight(
        {
          network: "fast:testnet",
          available: true,
          taken: true,
          skeleton_conflict: false,
          reserved: false,
        },
        "fast:testnet",
      ),
    ).toBe("indeterminate");
    expect(
      classifyPreflight(
        {
          network: "fast:testnet",
          available: false,
          taken: false,
          skeleton_conflict: false,
          reserved: true,
        },
        "fast:testnet",
      ),
    ).toBe("reservation_unresolved");
  });

  it("blocks an unavailable name before fee, signer, or provider calls", async () => {
    const h = await harness({
      availability: json({
        network: "fast:testnet",
        available: false,
        taken: false,
        skeleton_conflict: false,
        reserved: true,
      }),
    });
    await expect(h.client.claimName("alice.smith")).rejects.toBeInstanceOf(
      NameUnavailableError,
    );
    expect(h.sign).not.toHaveBeenCalled();
    expect(h.provider.getAccountInfo).not.toHaveBeenCalled();
    expect(h.provider.submitTransaction).not.toHaveBeenCalled();
    expect(h.calls.some(({ url }) => url.includes("/proxy-rest/"))).toBe(false);
  });

  it("blocks an already-named signer before availability, fee, or paid calls", async () => {
    const signer = await KeySigner.fromPrivateKey("01".repeat(32));
    const h = await harness({
      signer,
      identity: {
        network: "fast:testnet",
        address: signer.address,
        name: "alice.one",
        name_claim_tx: CLAIM_TX_ID,
      },
    });

    await expect(h.client.claimName("bob.two")).rejects.toMatchObject({
      name: "NameUnavailableError",
      verdict: "address_already_named",
    } satisfies Partial<NameUnavailableError>);
    expect(h.calls.some(({ url }) => url.includes("/api/availability?"))).toBe(false);
    expect(h.calls.some(({ url }) => url.includes("/proxy-rest/"))).toBe(false);
    expect(h.sign).not.toHaveBeenCalled();
    expect(h.provider.getAccountInfo).not.toHaveBeenCalled();
    expect(h.provider.submitTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ["transport failure", { identityError: new TypeError("connection reset") }],
    ["invalid HTTP status", { identityResponse: json({ error: "busy" }, 503) }],
    ["malformed successful payload", {
      identityResponse: new Response("not JSON", { status: 200 }),
    }],
    ["wrong account", {
      identity: {
        network: "fast:testnet",
        address: OTHER_ADDRESS,
        name: "alice.one",
        name_claim_tx: CLAIM_TX_ID,
      },
    }],
    ["wrong network", {
      identity: {
        network: "fast:mainnet",
        address: SIGNER_ADDRESS,
        name: "alice.one",
        name_claim_tx: CLAIM_TX_ID,
      },
    }],
  ] as const)("fails closed on identity %s", async (_label, options) => {
    const h = await harness(options);

    let error: unknown;
    try {
      await h.client.claimName("alice.smith");
    } catch (cause) {
      error = cause;
    }
    expect(error).toBeInstanceOf(PreSubmitError);
    expect(error).not.toBeInstanceOf(IndeterminateSubmissionError);
    expect((error as Error & { cause?: unknown }).cause).toBeDefined();
    expect(h.calls.some(({ url }) => url.includes("/api/availability?"))).toBe(false);
    expect(h.calls.some(({ url }) => url.includes("/proxy-rest/"))).toBe(false);
    expect(h.sign).not.toHaveBeenCalled();
    expect(h.provider.getAccountInfo).not.toHaveBeenCalled();
    expect(h.provider.submitTransaction).not.toHaveBeenCalled();
    expect(registrationCalls(h.calls)).toHaveLength(0);
  });

  it("continues for a valid same-network unnamed identity", async () => {
    const h = await harness();

    await expect(h.client.claimName("alice.smith")).resolves.toMatchObject({
      registration: "registered",
    });
    expect(h.calls.some(({ url }) => url.includes("/api/availability?"))).toBe(true);
    expect(h.provider.submitTransaction).toHaveBeenCalledTimes(1);
  });

  it("fails closed on an unavailable authoritative fee", async () => {
    const h = await harness({ networkInfo: json({ data: { network_id: "fast:mainnet" } }) });
    await expect(h.client.claimName("alice.smith")).rejects.toBeInstanceOf(
      FeeUnavailableError,
    );
    expect(h.sign).not.toHaveBeenCalled();
    expect(h.provider.getAccountInfo).not.toHaveBeenCalled();
    expect(h.provider.submitTransaction).not.toHaveBeenCalled();
  });

  it("locally rejects a signature made by the wrong key before provider submission", async () => {
    const declared = await KeySigner.fromPrivateKey("02".repeat(32));
    const wrong = await KeySigner.fromPrivateKey("03".repeat(32));
    const signer: Signer = {
      address: declared.address,
      signerHex: declared.signerHex,
      publicKey: declared.publicKey,
      sign: vi.fn((bytes: Uint8Array) => wrong.sign(bytes)),
    };
    const h = await harness({ signer });

    await expect(h.client.claimName("alice.smith")).rejects.toBeInstanceOf(
      LocalVerificationError,
    );
    expect(h.provider.submitTransaction).not.toHaveBeenCalled();
    expect(registrationCalls(h.calls)).toHaveLength(0);
  });

  it("rejects an incoherent signer tuple before fee, signing, provider, or HTTP I/O", async () => {
    const declared = await KeySigner.fromPrivateKey("02".repeat(32));
    const other = await KeySigner.fromPrivateKey("03".repeat(32));
    const signer: Signer = {
      address: declared.address,
      signerHex: other.signerHex,
      publicKey: declared.publicKey,
      sign: vi.fn((bytes: Uint8Array) => declared.sign(bytes)),
    };
    const fetchImpl = vi.fn<typeof fetch>();
    const provider = settledProvider();
    expect(
      () =>
        new IdClient({
          network: "fast:testnet",
          signer,
          fetchImpl,
          provider: provider as never,
        }),
    ).toThrow(InvalidSignerError);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(signer.sign).not.toHaveBeenCalled();
    expect(provider.getAccountInfo).not.toHaveBeenCalled();
    expect(provider.submitTransaction).not.toHaveBeenCalled();
  });
});

describe("public money-path surface", () => {
  it("does not export internal settlement services", () => {
    expect(Object.hasOwn(publicApi, "ClaimService")).toBe(false);
    expect(Object.hasOwn(publicApi, "ProofService")).toBe(false);
    expect(Object.hasOwn(publicApi, "submitSignedClaim")).toBe(false);
    expect(Object.hasOwn(publicApi, "buildExternalClaimBytes")).toBe(false);
    expect(Object.hasOwn(IdClient.prototype, "claimProperty")).toBe(false);
  });
});

describe("paid settlement and free registration", () => {
  it("claims a name and registers the exact frozen 64-hex wire", async () => {
    const h = await harness();
    const result = await h.client.claimName("alice.smith");
    const writes = registrationCalls(h.calls);

    expect(result).toMatchObject({
      nonce: "5",
      profileUrl: "https://testnet.id.fast.xyz/alice.smith",
      registration: "registered",
    });
    expect(result.txIdHex).toMatch(/^[0-9a-f]{64}$/);
    expect(h.sign).toHaveBeenCalledTimes(1);
    expect(h.provider.getAccountInfo).toHaveBeenCalledTimes(1);
    expect(h.provider.submitTransaction).toHaveBeenCalledTimes(1);
    expect(writes).toHaveLength(1);
    expect(writes[0].url).toBe("https://testnet.id.fast.xyz/api/claim");
    expect(JSON.parse(String(writes[0].init?.body))).toEqual({
      address: h.signer.signerHex,
      nonce: "5",
      tx_id: result.txIdHex,
      network: "fast:testnet",
    });
    expect(h.signer.address).not.toBe(h.signer.signerHex);
  });

  it("retains a complete pending record after settlement when registration is transient", async () => {
    const h = await harness({ registration: [json({ error: "later" }, 500), json({ status: "applied" })] });
    let held: PendingRegistration | undefined;
    try {
      await h.client.claimName("alice.smith");
    } catch (error) {
      expect(error).toBeInstanceOf(RegistrationPendingError);
      held = (error as RegistrationPendingError).pending;
    }
    expect(held).toMatchObject({
      op: "claim",
      network: "fast:testnet",
      addressHex: h.signer.signerHex,
      name: "alice.smith",
      nonce: "5",
    });
    expect(held?.txIdHex).toMatch(/^[0-9a-f]{64}$/);

    h.sign.mockClear();
    h.provider.getAccountInfo.mockClear();
    h.provider.submitTransaction.mockClear();
    const retried = await h.client.retryRegistration(held!);
    expect(retried.registration).toBe("registered");
    expect(h.sign).not.toHaveBeenCalled();
    expect(h.provider.getAccountInfo).not.toHaveBeenCalled();
    expect(h.provider.submitTransaction).not.toHaveBeenCalled();
    expect(registrationCalls(h.calls).map(({ url }) => url)).toEqual([
      "https://testnet.id.fast.xyz/api/claim",
      "https://testnet.id.fast.xyz/api/claim",
    ]);
  });

  it("surfaces a provider timeout and non-success result as indeterminate and never registers", async () => {
    for (const outcome of ["timeout", "incomplete"] as const) {
      let submittedEnvelope: unknown;
      const submitTransaction =
        outcome === "timeout"
          ? vi.fn(async (envelope: unknown) => {
              submittedEnvelope = envelope;
              throw new Error("timeout after dispatch");
            })
          : vi.fn(async (envelope: unknown) => {
              submittedEnvelope = envelope;
              return { type: "IncompleteVerifierSigs" };
            });
      const h = await harness({
        provider: {
          getAccountInfo: vi.fn(async () => ({ nextNonce: 5n })),
          submitTransaction,
        },
      });
      const error = await h.client.claimName("alice.smith").catch((cause) => cause);
      expect(error).toBeInstanceOf(IndeterminateSubmissionError);
      if (!(error instanceof IndeterminateSubmissionError)) throw new Error("expected indeterminate submission error");
      expect(error).toMatchObject({
        nonce: 5n,
        txIdHex: expect.stringMatching(/^[0-9a-f]{64}$/),
        recoveryEnvelope: expect.objectContaining({ transaction: expect.anything() }),
      });
      expect(error.recoveryEnvelope).toEqual(submittedEnvelope);
      expect(registrationCalls(h.calls)).toHaveLength(0);
    }
  });

  it("surfaces a definitive nonce conflict without registering", async () => {
    const h = await harness({
      provider: {
        getAccountInfo: vi.fn(async () => ({ nextNonce: 5n })),
        submitTransaction: vi.fn(async () => {
          throw { _tag: "UnexpectedNonceError", expectedNonce: 9n };
        }),
      },
    });
    await expect(h.client.claimName("alice.smith")).rejects.toMatchObject({
      name: "NonceConflictError",
      expectedNonce: 9n,
    } satisfies Partial<NonceConflictError>);
    expect(registrationCalls(h.calls)).toHaveLength(0);
  });
});

describe("registration result matrix", () => {
  it.each<[string, Response, TerminalRegistrationDisposition]>([
    ["rejected", json({ status: "rejected", reason: "reserved" }), "rejected"],
    ["conflict", json({ status: "rejected", reason: "taken" }, 409), "conflict"],
    ["invalid", json({ reason: "bad claim" }, 422), "invalid"],
  ])("treats %s as terminal after payment", async (_label, response, disposition) => {
    const h = await harness({ registration: [response] });
    await expect(h.client.retryRegistration(pending())).rejects.toMatchObject({
      name: "RegistrationTerminalError",
      disposition,
      feeSpent: true,
    } satisfies Partial<RegistrationTerminalError>);
  });

  it.each([
    ["pending", json({ status: "pending_external_check" })],
    ["503", json({ error: "busy" }, 503)],
    ["generic 500", json({ error: "later" }, 500)],
    ["unknown 200", json({ status: "future_status" })],
  ])("retains %s for registration-only retry", async (_label, response) => {
    const record = pending();
    const h = await harness({ registration: [response] });
    await expect(h.client.retryRegistration(record)).rejects.toMatchObject({
      name: "RegistrationPendingError",
      pending: record,
    } satisfies Partial<RegistrationPendingError>);
  });

  it.each(["applied", "verified_external_link"])(
    "accepts %s as terminal success",
    async (status) => {
      const h = await harness({ registration: [json({ status })] });
      await expect(h.client.retryRegistration(pending())).resolves.toMatchObject({
        registration: "registered",
      });
    },
  );

  it("retains a revoke when the server returns the claim-only verified status", async () => {
    const record: PendingRegistration = {
      op: "revoke",
      network: "fast:testnet",
      addressHex: "33".repeat(32),
      kind: "github",
      value: "octocat",
      nonce: "5",
      txIdHex: "44".repeat(32),
    };
    const h = await harness({
      registration: [json({ status: "verified_external_link" })],
    });

    await expect(h.client.retryRegistration(record)).rejects.toMatchObject({
      name: "RegistrationPendingError",
      pending: record,
    } satisfies Partial<RegistrationPendingError>);
    expect(registrationCalls(h.calls).map(({ url }) => url)).toEqual([
      "https://testnet.id.fast.xyz/api/revoke",
    ]);
    expect(h.sign).not.toHaveBeenCalled();
    expect(h.provider.getAccountInfo).not.toHaveBeenCalled();
    expect(h.provider.submitTransaction).not.toHaveBeenCalled();
  });

  it("retains a settled record when the registration transport fails", async () => {
    const record = pending();
    const h = await harness();
    h.fetchImpl.mockImplementationOnce(async () => {
      throw new TypeError("connection reset");
    });
    await expect(h.client.retryRegistration(record)).rejects.toMatchObject({
      name: "RegistrationPendingError",
      pending: record,
    } satisfies Partial<RegistrationPendingError>);
  });

  it("retains a settled record when a successful response body cannot be read", async () => {
    const record = pending();
    const unreadable = {
      ok: true,
      status: 200,
      text: vi.fn(async () => {
        throw new TypeError("response stream failed");
      }),
    } as unknown as Response;
    const h = await harness({ registration: [unreadable] });
    await expect(h.client.retryRegistration(record)).rejects.toMatchObject({
      name: "RegistrationPendingError",
      pending: record,
    } satisfies Partial<RegistrationPendingError>);
  });
});

describe("operation- and network-bound retry", () => {
  it("snapshots every caller-owned pending field before registration I/O", async () => {
    const h = await harness();
    const reads = new Map<string, number>();
    const values = {
      op: "claim",
      network: "fast:testnet",
      addressHex: "33".repeat(32),
      name: "alice.smith",
      kind: "name",
      value: "alice.smith",
      nonce: "5",
      txIdHex: "44".repeat(32),
    } as const;
    const descriptors = Object.fromEntries(
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
    const callerOwned = Object.defineProperties({}, descriptors);

    await expect(
      h.client.retryRegistration(callerOwned as PendingRegistration),
    ).resolves.toMatchObject({
      txIdHex: values.txIdHex,
      nonce: values.nonce,
      profileUrl: "https://testnet.id.fast.xyz/alice.smith",
      registration: "registered",
      outcome: "applied",
    });

    expect(Object.fromEntries(reads)).toEqual(
      Object.fromEntries(Object.keys(values).map((name) => [name, 1])),
    );
    expect(registrationCalls(h.calls)).toHaveLength(1);
    expect(registrationCalls(h.calls)[0].url).toBe(
      "https://testnet.id.fast.xyz/api/claim",
    );
    expect(JSON.parse(String(registrationCalls(h.calls)[0].init?.body))).toEqual({
      address: values.addressHex,
      nonce: values.nonce,
      tx_id: values.txIdHex,
      network: values.network,
    });
    expect(h.sign).not.toHaveBeenCalled();
    expect(h.provider.getAccountInfo).not.toHaveBeenCalled();
    expect(h.provider.submitTransaction).not.toHaveBeenCalled();
  });

  it("rejects an unsupported persisted operation before any POST or paid call", async () => {
    const h = await harness();
    await expect(
      h.client.retryRegistration(pending({ op: "delete" as never })),
    ).rejects.toBeInstanceOf(InvalidPendingRegistrationError);
    expect(registrationCalls(h.calls)).toHaveLength(0);
    expect(h.sign).not.toHaveBeenCalled();
    expect(h.provider.getAccountInfo).not.toHaveBeenCalled();
    expect(h.provider.submitTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ["address", { addressHex: "AA".repeat(32) }],
    ["transaction id", { txIdHex: `0x${"44".repeat(32)}` }],
    ["empty nonce", { nonce: "" }],
    ["signed nonce", { nonce: "+5" }],
    ["nonce above i64::MAX", { nonce: "9223372036854775808" }],
    ["optional name", { name: 7 }],
    ["optional kind", { kind: "email" }],
    ["optional value", { value: false }],
  ])("rejects a malformed persisted %s before registration I/O", async (_label, overrides) => {
    const h = await harness();
    await expect(
      h.client.retryRegistration({ ...pending(), ...overrides } as never),
    ).rejects.toBeInstanceOf(InvalidPendingRegistrationError);
    expect(registrationCalls(h.calls)).toHaveLength(0);
    expect(h.sign).not.toHaveBeenCalled();
    expect(h.provider.getAccountInfo).not.toHaveBeenCalled();
    expect(h.provider.submitTransaction).not.toHaveBeenCalled();
  });

  it("uses operation-neutral signature diagnostics across SDK write paths", () => {
    expect(new SigningError().message).toBe("the signer did not produce a signature");
    expect(new LocalVerificationError().message).toBe(
      "the locally produced signature did not verify; refusing submission",
    );
  });

  it("retries a settled revoke only through /api/revoke with zero signing/provider calls", async () => {
    const signer = await KeySigner.fromPrivateKey("01".repeat(32));
    const h = await harness({
      signer,
      links: {
        address: signer.address,
        network: "fast:testnet",
        links: [
          {
            kind: "website",
            value: "example.com",
            status: "verified",
            claim_tx: CLAIM_TX_ID,
            publicly_visible: true,
          },
        ],
      },
      registration: [json({ error: "later" }, 500), json({ status: "applied" })],
    });
    let held: PendingRegistration | undefined;
    try {
      await h.client.revoke("website", "example.com");
    } catch (error) {
      expect(error).toBeInstanceOf(RegistrationPendingError);
      held = (error as RegistrationPendingError).pending;
    }
    expect(held).toMatchObject({
      op: "revoke",
      kind: "website",
      value: "example.com",
      network: "fast:testnet",
    });

    h.sign.mockClear();
    h.provider.getAccountInfo.mockClear();
    h.provider.submitTransaction.mockClear();
    await h.client.retryRegistration(held!);
    expect(h.sign).not.toHaveBeenCalled();
    expect(h.provider.getAccountInfo).not.toHaveBeenCalled();
    expect(h.provider.submitTransaction).not.toHaveBeenCalled();
    expect(registrationCalls(h.calls).map(({ url }) => url)).toEqual([
      "https://testnet.id.fast.xyz/api/revoke",
      "https://testnet.id.fast.xyz/api/revoke",
    ]);
  });

  it("resolves the active name claim transaction before revoking a name", async () => {
    const signer = await KeySigner.fromPrivateKey("01".repeat(32));
    const h = await harness({
      signer,
      identity: {
        network: "fast:testnet",
        address: signer.address,
        name: "alice.smith",
        name_claim_tx: CLAIM_TX_ID,
      },
    });

    await expect(h.client.revoke("name", "alice.smith")).resolves.toMatchObject({
      registration: "registered",
    });
    expect(h.calls.some(({ url }) => url.endsWith(`/${encodeURIComponent(signer.address)}/identity.json`))).toBe(true);
    expect(h.calls.some(({ url }) => url.includes("/api/links/"))).toBe(false);
    expect(h.provider.submitTransaction).toHaveBeenCalledTimes(1);
  });

  it("resolves the exact imported work transaction before revoking a DOI", async () => {
    const signer = await KeySigner.fromPrivateKey("01".repeat(32));
    const h = await harness({
      signer,
      resolved: {
        id: `https://testnet.id.fast.xyz/${signer.address}`,
        network: "fast:testnet",
        address: signer.address,
        verified_properties: [],
        signed_content_status: "available",
        signed_content: [],
        imported_works: [
          {
            doi: "10.1145/example",
            provenance: "self-asserted",
            claim_tx: CLAIM_TX_ID,
          },
        ],
        note: "",
      },
    });

    await expect(h.client.revoke("work", "10.1145/example")).resolves.toMatchObject({
      registration: "registered",
    });
    expect(h.calls.some(({ url }) => url.endsWith(`/${encodeURIComponent(signer.address)}/id.json`))).toBe(true);
    expect(h.provider.submitTransaction).toHaveBeenCalledTimes(1);
  });

  it("does not pay when an ownership read is incoherent or has a malformed claim transaction", async () => {
    const signer = await KeySigner.fromPrivateKey("01".repeat(32));
    for (const links of [
      {
        address: (await KeySigner.fromPrivateKey("02".repeat(32))).address,
        network: "fast:testnet",
        links: [{ kind: "website", value: "example.com", status: "verified", claim_tx: CLAIM_TX_ID, publicly_visible: true }],
      },
      {
        address: signer.address,
        network: "fast:mainnet",
        links: [{ kind: "website", value: "example.com", status: "verified", claim_tx: CLAIM_TX_ID, publicly_visible: true }],
      },
      {
        address: signer.address,
        network: "fast:testnet",
        links: [{ kind: "website", value: "example.com", status: "verified", claim_tx: "not-hex", publicly_visible: true }],
      },
      {
        address: signer.address,
        network: "fast:testnet",
        links: [{ kind: "website", value: "example.com", status: "future", claim_tx: CLAIM_TX_ID, publicly_visible: true }],
      },
      {
        address: signer.address,
        network: "fast:testnet",
        links: [{ kind: "website", value: "example.com", claim_tx: CLAIM_TX_ID, publicly_visible: true }],
      },
    ]) {
      const h = await harness({ signer, links });
      await expect(h.client.revoke("website", "example.com")).rejects.toMatchObject({
        name: "ClaimNotHeldError",
      });
      expect(h.sign).not.toHaveBeenCalled();
      expect(h.provider.getAccountInfo).not.toHaveBeenCalled();
      expect(h.provider.submitTransaction).not.toHaveBeenCalled();
    }
  });

  it("allows an owner to revoke a stale but still active external link", async () => {
    const signer = await KeySigner.fromPrivateKey("01".repeat(32));
    const h = await harness({
      signer,
      links: {
        address: signer.address,
        network: "fast:testnet",
        links: [
          {
            kind: "website",
            value: "example.com",
            status: "stale",
            claim_tx: CLAIM_TX_ID,
            publicly_visible: false,
          },
        ],
      },
    });

    await expect(h.client.revoke("website", "example.com")).resolves.toMatchObject({
      registration: "registered",
    });
    expect(h.provider.submitTransaction).toHaveBeenCalledTimes(1);
  });

  it("refuses a foreign-network pending record before any POST or provider/signing call", async () => {
    const h = await harness();
    await expect(
      h.client.retryRegistration(pending({ network: "fast:mainnet" })),
    ).rejects.toBeInstanceOf(PendingNetworkMismatchError);
    expect(registrationCalls(h.calls)).toHaveLength(0);
    expect(h.sign).not.toHaveBeenCalled();
    expect(h.provider.getAccountInfo).not.toHaveBeenCalled();
    expect(h.provider.submitTransaction).not.toHaveBeenCalled();
  });
});
