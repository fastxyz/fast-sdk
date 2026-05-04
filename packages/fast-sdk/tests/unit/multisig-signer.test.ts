import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getPublicKeyAsync } from "@noble/ed25519";
import { fromHex, toHex } from "../../src/index";
import {
  assertAuthorizedSigner,
  deriveMultiSigAddress,
  deriveMultiSigAddressBytes,
  MultiSigConfigInvalidError,
  MultiSigSigner,
  NotAuthorizedSignerError,
} from "../../src/interface/multisig-signer";

const fixtures = JSON.parse(
  readFileSync(
    join(__dirname, "fixtures/multisig-addresses.json"),
    "utf8",
  ),
) as Array<{
  comment: string;
  config: { authorized_signers: string[]; quorum: string; nonce: string };
  expectedAddressHex: string;
}>;

describe("deriveMultiSigAddress", () => {
  for (const f of fixtures) {
    it(`matches Rust derivation: ${f.comment}`, async () => {
      const config = {
        authorized_signers: f.config.authorized_signers.map((s) => fromHex(s)),
        quorum: BigInt(f.config.quorum),
        nonce: BigInt(f.config.nonce),
      };
      const bytes = await deriveMultiSigAddressBytes(config);
      expect(toHex(bytes)).toBe(f.expectedAddressHex);
    });
  }

  it("produces a bech32m fast1... address", async () => {
    const config = {
      authorized_signers: [new Uint8Array(32), new Uint8Array(32).fill(1)],
      quorum: 2n,
      nonce: 0n,
    };
    const addr = await deriveMultiSigAddress(config);
    expect(addr.startsWith("fast1")).toBe(true);
  });
});

describe("assertAuthorizedSigner", () => {
  const SECRET_A = new Uint8Array(32).fill(0xaa);
  const SECRET_B = new Uint8Array(32).fill(0xbb);

  it("returns void when secret derives a pubkey in authorized_signers", async () => {
    const pkA = await getPublicKeyAsync(SECRET_A);
    const pkB = await getPublicKeyAsync(SECRET_B);
    const config = {
      authorized_signers: [pkA, pkB],
      quorum: 2n,
      nonce: 0n,
    };
    await expect(assertAuthorizedSigner(config, SECRET_A)).resolves.toBeUndefined();
  });

  it("throws NotAuthorizedSignerError when secret is not a member", async () => {
    const pkA = await getPublicKeyAsync(SECRET_A);
    const otherSecret = new Uint8Array(32).fill(0xcc);
    const config = {
      authorized_signers: [pkA, await getPublicKeyAsync(SECRET_B)],
      quorum: 2n,
      nonce: 0n,
    };
    await expect(assertAuthorizedSigner(config, otherSecret)).rejects.toThrow(
      NotAuthorizedSignerError,
    );
  });

  it("throws MultiSigConfigInvalidError on quorum < 1", async () => {
    const config = {
      authorized_signers: [
        await getPublicKeyAsync(SECRET_A),
        await getPublicKeyAsync(SECRET_B),
      ],
      quorum: 0n,
      nonce: 0n,
    };
    await expect(assertAuthorizedSigner(config, SECRET_A)).rejects.toThrow(
      MultiSigConfigInvalidError,
    );
  });

  it("throws MultiSigConfigInvalidError on quorum > signer count", async () => {
    const config = {
      authorized_signers: [
        await getPublicKeyAsync(SECRET_A),
        await getPublicKeyAsync(SECRET_B),
      ],
      quorum: 3n,
      nonce: 0n,
    };
    await expect(assertAuthorizedSigner(config, SECRET_A)).rejects.toThrow(
      MultiSigConfigInvalidError,
    );
  });

  it("throws MultiSigConfigInvalidError on signer count < 2", async () => {
    const config = {
      authorized_signers: [await getPublicKeyAsync(SECRET_A)],
      quorum: 1n,
      nonce: 0n,
    };
    await expect(assertAuthorizedSigner(config, SECRET_A)).rejects.toThrow(
      MultiSigConfigInvalidError,
    );
  });

  it("throws MultiSigConfigInvalidError on duplicate signers", async () => {
    const pkA = await getPublicKeyAsync(SECRET_A);
    const config = {
      authorized_signers: [pkA, pkA],
      quorum: 2n,
      nonce: 0n,
    };
    await expect(assertAuthorizedSigner(config, SECRET_A)).rejects.toThrow(
      MultiSigConfigInvalidError,
    );
  });
});

describe("MultiSigSigner construction", () => {
  const SECRET_A = new Uint8Array(32).fill(0xaa);
  const SECRET_B = new Uint8Array(32).fill(0xbb);

  it("constructs with a member secret and exposes pubkey", async () => {
    const pkA = await getPublicKeyAsync(SECRET_A);
    const pkB = await getPublicKeyAsync(SECRET_B);
    const config = { authorized_signers: [pkA, pkB], quorum: 2n, nonce: 0n };
    const signer = new MultiSigSigner({ config, secretKey: SECRET_A });
    expect(await signer.getSignerPublicKey()).toEqual(pkA);
  });

  it("getFastAddress returns derived multisig bech32m", async () => {
    const pkA = await getPublicKeyAsync(SECRET_A);
    const pkB = await getPublicKeyAsync(SECRET_B);
    const config = { authorized_signers: [pkA, pkB], quorum: 2n, nonce: 0n };
    const signer = new MultiSigSigner({ config, secretKey: SECRET_A });
    const fromSigner = await signer.getFastAddress();
    const direct = await deriveMultiSigAddress(config);
    expect(fromSigner).toBe(direct);
  });

  it("rejects construction when secret is not in authorized_signers", async () => {
    const pkA = await getPublicKeyAsync(SECRET_A);
    const pkB = await getPublicKeyAsync(SECRET_B);
    const config = { authorized_signers: [pkA, pkB], quorum: 2n, nonce: 0n };
    const stranger = new Uint8Array(32).fill(0xcc);
    // Construction is sync; validation happens lazily on first method call
    const signer = new MultiSigSigner({ config, secretKey: stranger });
    await expect(signer.getSignerPublicKey()).rejects.toThrow(NotAuthorizedSignerError);
  });
});

describe("MultiSigSigner.signEnvelopeFor", () => {
  it("produces a MultiSig envelope with one partial signature", async () => {
    const SECRET_A = new Uint8Array(32).fill(0xaa);
    const SECRET_B = new Uint8Array(32).fill(0xbb);
    const pkA = await getPublicKeyAsync(SECRET_A);
    const pkB = await getPublicKeyAsync(SECRET_B);
    const config = {
      authorized_signers: [pkA, pkB],
      quorum: 2n,
      nonce: 0n,
    };
    const signer = new MultiSigSigner({ config, secretKey: SECRET_A });
    const sender = await signer.getDerivedAddressBytes();

    // Build a versioned transaction by hand (single TokenTransfer).
    // Using TransactionBuilder against a throw-away Signer is the
    // simplest way to construct a valid VersionedTransaction shape.
    const { Signer } = await import("../../src/index");
    const { TransactionBuilder } = await import("../../src/index");
    const builder = new TransactionBuilder({
      networkId: "fast:testnet" as const,
      signer: new Signer(SECRET_A), // construction only; we replace sender below
      nonce: 0n,
    });
    const stubEnvelope = await builder
      .addTokenTransfer({
        tokenId: new Uint8Array(32),
        recipient: new Uint8Array(32),
        amount: 1n,
        userData: null,
      })
      .sign();

    // Replace sender to simulate a tx originated by the multisig wallet
    const versioned = {
      ...stubEnvelope.transaction,
      value: { ...stubEnvelope.transaction.value, sender },
    };

    const envelope = await signer.signEnvelopeFor(versioned);
    expect(envelope.transaction).toBe(versioned);
    expect(envelope.signature.type).toBe("MultiSig");
    if (envelope.signature.type !== "MultiSig") throw new Error("unreachable");
    expect(envelope.signature.value.config).toEqual(config);
    expect(envelope.signature.value.signatures).toHaveLength(1);
    expect(envelope.signature.value.signatures[0]![0]).toEqual(pkA);
  });
});
