import { describe, expect, it, vi } from "vitest";

import {
  IdClient,
  KeySigner,
  InvalidProfileError,
  LocalVerificationError,
  ProfileChallengeError,
  ProfileReadError,
  PropertyAlreadyClaimedError,
  ProfileUnauthorizedError,
} from "../src/index.js";
import { encodeProfileMessage } from "../src/profile-message.js";
import { verifyStrict } from "../src/verify.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function canonicalProfileId(address: string): string {
  return `https://testnet.id.fast.xyz/${address}`;
}

interface ProfileHarnessOptions {
  putStatus?: number;
  signerPrivateKey?: string;
}

async function profileHarness(options: ProfileHarnessOptions = {}) {
  const signer = await KeySigner.fromPrivateKey(
    options.signerPrivateKey ?? "01".repeat(32),
  );
  const originalSign = signer.sign.bind(signer);
  const sign = vi.spyOn(signer, "sign");
  let profilePut: FormData | undefined;
  const calls: string[] = [];
  const fetchImpl = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith(`/${encodeURIComponent(signer.address)}/id.json`)) {
        return json({
          id: canonicalProfileId(signer.address),
          network: "fast:testnet",
          address: signer.address,
          profile: {
            display_name: "Stored name",
            bio: "Stored bio",
            avatar: `avatars/${"aa".repeat(32)}.png`,
          },
          verified_properties: [],
          signed_content_status: "available",
          signed_content: [],
          imported_works: [],
          note: "",
        });
      }
      if (url.endsWith("/api/profile/challenge")) {
        return json({ server_nonce: "33".repeat(32), expiry: 1_900_000_000 });
      }
      if (url.endsWith("/api/profile")) {
        profilePut = init?.body as FormData;
        return new Response(
          options.putStatus === 422 ? "field too long" : "",
          { status: options.putStatus ?? 200 },
        );
      }
      throw new Error(`unexpected URL ${url}`);
    },
  );
  const client = new IdClient({
    network: "fast:testnet",
    signer,
    fetchImpl: fetchImpl as typeof fetch,
    provider: {} as never,
  });
  return {
    client,
    signer,
    sign,
    originalSign,
    calls,
    profilePut: () => profilePut,
    fetchImpl,
  };
}

describe("profile updates", () => {
  it.each([
    null,
    [],
    { displayName: 7 },
    { bio: null },
    { avatar: { bytes: [1, 2], type: "image/png", name: "avatar.png" } },
  ])("rejects malformed JavaScript input before any I/O", async (input) => {
    const h = await profileHarness();

    await expect(h.client.updateProfile(input as never)).rejects.toBeInstanceOf(
      InvalidProfileError,
    );
    expect(h.calls).toEqual([]);
    expect(h.sign).not.toHaveBeenCalled();
  });

  it("snapshots valid input before the current-profile read", async () => {
    const h = await profileHarness();
    const input = { bio: "Original bio" };
    h.fetchImpl.mockImplementationOnce(async () => {
      input.bio = "Mutated during read";
      return json({
        id: canonicalProfileId(h.signer.address),
        network: "fast:testnet",
        address: h.signer.address,
        profile: { display_name: "Stored name", bio: "Stored bio" },
        verified_properties: [],
        signed_content_status: "available",
        signed_content: [],
        imported_works: [],
        note: "",
      });
    });

    await h.client.updateProfile(input);

    expect(h.profilePut()!.get("bio")).toBe("Original bio");
  });

  it("captures each avatar property once before performing I/O", async () => {
    const h = await profileHarness();
    let bytesReads = 0;
    let typeReads = 0;
    let nameReads = 0;
    const avatar = {
      get bytes() {
        bytesReads += 1;
        return bytesReads === 1 ? new Uint8Array([7]) : new Uint8Array([9]);
      },
      get type(): unknown {
        typeReads += 1;
        return typeReads === 1 ? "image/png" : 7;
      },
      get name(): unknown {
        nameReads += 1;
        return nameReads === 1 ? "avatar.png" : null;
      },
    };

    await expect(h.client.updateProfile({ avatar } as never)).resolves.toEqual({
      status: "updated",
    });

    expect([bytesReads, typeReads, nameReads]).toEqual([1, 1, 1]);
    const uploaded = h.profilePut()!.get("avatar") as File;
    expect(uploaded.type).toBe("image/png");
    expect(uploaded.name).toBe("avatar.png");
    expect(new Uint8Array(await uploaded.arrayBuffer())).toEqual(new Uint8Array([7]));
  });

  it("preserves omitted fields, consumes one challenge, and sends the signed snapshot", async () => {
    const h = await profileHarness();
    const input = { bio: "New bio" };
    h.sign.mockImplementationOnce(async (bytes) => {
      input.bio = "mutated after signing";
      return h.originalSign(bytes);
    });

    await expect(h.client.updateProfile(input)).resolves.toEqual({
      status: "updated",
    });
    const form = h.profilePut()!;
    expect(form.get("address")).toBe(h.signer.signerHex);
    expect(form.get("network")).toBe("fast:testnet");
    expect(form.get("display_name")).toBe("Stored name");
    expect(form.get("bio")).toBe("New bio");
    expect(form.get("avatar_flag")).toBe("0");
    expect(form.get("expiry")).toBe("1900000000");
    expect(form.get("server_nonce")).toBe("33".repeat(32));
    expect(form.get("signature")).toMatch(/^[0-9a-f]{128}$/);
    expect(
      verifyStrict(
        h.sign.mock.calls[0][0],
        String(form.get("signature")),
        h.signer.publicKey,
      ),
    ).toBe(true);
    expect(h.calls.filter((url) => url.endsWith("/api/profile/challenge"))).toHaveLength(1);
    expect(h.calls.filter((url) => url.endsWith("/api/profile"))).toHaveLength(1);
  });

  it("normalizes multipart line endings before limits, signing, and form construction", async () => {
    const h = await profileHarness();
    await h.client.updateProfile({ bio: "a\nb\rc\r\nd" });

    const normalized = "a\r\nb\r\nc\r\nd";
    expect(h.profilePut()!.get("bio")).toBe(normalized);
    expect(h.sign.mock.calls[0][0]).toEqual(
      encodeProfileMessage({
        address: h.signer.publicKey,
        network: "fast:testnet",
        displayName: "Stored name",
        bio: normalized,
        avatar: { kind: "nochange" },
        expiry: 1_900_000_000n,
        serverNonce: new Uint8Array(32).fill(0x33),
      }),
    );
  });

  it("rejects text that exceeds the limit after multipart normalization before I/O", async () => {
    const h = await profileHarness();

    await expect(
      h.client.updateProfile({ bio: `${"x".repeat(511)}\n` }),
    ).rejects.toBeInstanceOf(InvalidProfileError);
    expect(h.calls).toEqual([]);
    expect(h.sign).not.toHaveBeenCalled();
  });

  it("treats an explicit empty string as a clear while preserving omitted bio", async () => {
    const h = await profileHarness();
    await h.client.updateProfile({ displayName: "" });
    expect(h.profilePut()!.get("display_name")).toBe("");
    expect(h.profilePut()!.get("bio")).toBe("Stored bio");
  });

  it("hashes original avatar bytes and sends the exact file", async () => {
    const h = await profileHarness();
    const bytes = new Uint8Array([0, 1, 2, 3, 255]);
    await h.client.updateProfile({
      avatar: { bytes, type: "image/png", name: "avatar.png" },
    });
    const form = h.profilePut()!;
    expect(form.get("avatar_flag")).toBe("1");
    const uploaded = form.get("avatar") as File;
    expect(new Uint8Array(await uploaded.arrayBuffer())).toEqual(bytes);
  });

  it("surfaces an expired or rejected challenge as typed and never signs", async () => {
    const h = await profileHarness();
    h.fetchImpl.mockImplementationOnce(async () =>
      json({
        id: canonicalProfileId(h.signer.address),
        network: "fast:testnet",
        address: h.signer.address,
        verified_properties: [],
        signed_content_status: "available",
        signed_content: [],
        imported_works: [],
        note: "",
      }),
    );
    h.fetchImpl.mockImplementationOnce(async () => json({ error: "expired" }, 401));
    await expect(h.client.updateProfile({ bio: "x" })).rejects.toMatchObject({
      name: "ProfileChallengeError",
      status: 401,
    } satisfies Partial<ProfileChallengeError>);
    expect(h.sign).not.toHaveBeenCalled();
    expect(h.calls.some((url) => url.endsWith("/api/profile"))).toBe(false);
  });

  it("reports a malformed successful challenge as malformed rather than an HTTP 200 failure", async () => {
    const h = await profileHarness();
    h.fetchImpl.mockImplementationOnce(async () =>
      json({
        id: canonicalProfileId(h.signer.address),
        network: "fast:testnet",
        address: h.signer.address,
        verified_properties: [],
        signed_content_status: "available",
        signed_content: [],
        imported_works: [],
        note: "",
      }),
    );
    h.fetchImpl.mockImplementationOnce(async () => json({ server_nonce: "bad" }));

    await expect(h.client.updateProfile({ bio: "x" })).rejects.toMatchObject({
      name: "ProfileChallengeError",
      status: null,
      message: "could not obtain a profile challenge",
    } satisfies Partial<ProfileChallengeError>);
    expect(h.sign).not.toHaveBeenCalled();
    expect(h.calls.some((url) => url.endsWith("/api/profile"))).toBe(false);
  });

  it.each([
    {
      id: "fast1truncated",
      network: "fast:testnet",
      address: "fast1truncated",
    },
    {
      id: "fast1malformed",
      network: "fast:testnet",
      address: "fast1malformed",
      profile: [],
      verified_properties: [],
      signed_content_status: "available",
      signed_content: [],
      imported_works: [],
      note: "",
    },
    {
      id: "fast1malformed-property",
      network: "fast:testnet",
      address: "fast1malformed-property",
      verified_properties: [null],
      signed_content_status: "available",
      signed_content: [],
      imported_works: [],
      note: "",
    },
    {
      id: "fast1malformed-content",
      network: "fast:testnet",
      address: "fast1malformed-content",
      verified_properties: [],
      signed_content_status: "available",
      signed_content: [null],
      imported_works: [],
      note: "",
    },
    {
      id: "fast1malformed-work",
      network: "fast:testnet",
      address: "fast1malformed-work",
      verified_properties: [],
      signed_content_status: "available",
      signed_content: [],
      imported_works: [null],
      note: "",
    },
  ])(
    "rejects a truncated or malformed resolver snapshot before challenge or signing",
    async (document) => {
      const h = await profileHarness();
      h.fetchImpl.mockImplementationOnce(async () =>
        json({
          ...document,
          id: canonicalProfileId(h.signer.address),
          address: h.signer.address,
        }),
      );

      await expect(h.client.updateProfile({ bio: "new" })).rejects.toBeInstanceOf(
        ProfileReadError,
      );
      expect(h.sign).not.toHaveBeenCalled();
      expect(
        h.calls.some((url) => url.endsWith("/api/profile/challenge")),
      ).toBe(false);
      expect(h.calls.some((url) => url.endsWith("/api/profile"))).toBe(false);
    },
  );

  it("surfaces a uniform 401 update without automatically re-signing", async () => {
    const h = await profileHarness({ putStatus: 401 });
    await expect(h.client.updateProfile({ bio: "x" })).rejects.toBeInstanceOf(
      ProfileUnauthorizedError,
    );
    expect(h.sign).toHaveBeenCalledTimes(1);
    expect(h.calls.filter((url) => url.endsWith("/api/profile/challenge"))).toHaveLength(1);
  });

  it("refuses a wrong-key profile signature before the PUT", async () => {
    const h = await profileHarness();
    const wrong = await KeySigner.fromPrivateKey("02".repeat(32));
    h.sign.mockImplementationOnce((bytes) => wrong.sign(bytes));
    await expect(h.client.updateProfile({ bio: "x" })).rejects.toBeInstanceOf(
      LocalVerificationError,
    );
    expect(h.calls.some((url) => url.endsWith("/api/profile"))).toBe(false);
  });
});

describe("DOI import", () => {
  it("normalizes a DOI and uses the paid work-claim pipeline without touching profile", async () => {
    const signer = await KeySigner.fromPrivateKey("01".repeat(32));
    const tokenId = "11".repeat(32);
    const calls: string[] = [];
    const provider = {
      getAccountInfo: vi.fn(async () => ({ nextNonce: 5n })),
      submitTransaction: vi.fn(async (envelope: { transaction: unknown }) => ({
        type: "Success",
        value: { envelope: { transaction: envelope.transaction } },
      })),
    };
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/api/property/claimed?")) return json({ claimed: false });
      if (url.endsWith("/proxy-rest/v1/network-info")) {
        return json({
          data: {
            network_id: "fast:testnet",
            fees: {
              default: tokenId,
              entries: [{ token_id: tokenId, fixed_amount: "7" }],
            },
          },
        });
      }
      if (url.includes("/proxy-rest/v1/tokens?")) {
        return json({
          data: {
            requested_token_metadata: [
              [tokenId, { token_name: "testUSDC", decimals: 6 }],
            ],
          },
        });
      }
      if (url.endsWith("/api/claim")) return json({ status: "applied" });
      throw new Error(`unexpected URL ${url}`);
    });
    const client = new IdClient({
      network: "fast:testnet",
      signer,
      fetchImpl: fetchImpl as typeof fetch,
      provider: provider as never,
    });

    await expect(
      client.importWork(" HTTPS://DOI.ORG/10.1145/Example "),
    ).resolves.toMatchObject({ registration: "registered" });
    expect(calls.some((url) => url.includes("kind=work&value=10.1145%2Fexample"))).toBe(true);
    expect(calls.some((url) => url.includes("/api/profile"))).toBe(false);
    expect(provider.submitTransaction).toHaveBeenCalledTimes(1);
  });

  it("stops on an already claimed DOI before fee, nonce, signing, or submission", async () => {
    const signer = await KeySigner.fromPrivateKey("01".repeat(32));
    const sign = vi.spyOn(signer, "sign");
    const provider = {
      getAccountInfo: vi.fn(),
      submitTransaction: vi.fn(),
    };
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/api/property/claimed?")) return json({ claimed: true });
      throw new Error(`unexpected URL ${url}`);
    });
    const client = new IdClient({
      network: "fast:testnet",
      signer,
      fetchImpl: fetchImpl as typeof fetch,
      provider: provider as never,
    });

    await expect(client.importWork("10.1145/example")).rejects.toBeInstanceOf(
      PropertyAlreadyClaimedError,
    );
    expect(sign).not.toHaveBeenCalled();
    expect(provider.getAccountInfo).not.toHaveBeenCalled();
    expect(provider.submitTransaction).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

});
