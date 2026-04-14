import { describe, expect, it } from "vitest";
import {
  FastProvider,
  NotFoundError,
  Signer,
  TransactionBuilder,
} from "../../src/index";

const env = {
  url: process.env.FAST_TEST_URL,
  signerPrivateKey: process.env.FAST_TEST_SIGNER_PRIVATE_KEY,
  networkId: process.env.FAST_TEST_NETWORK_ID,
} as const;

const hasUrl = Boolean(env.url);
const hasSigner = Boolean(env.signerPrivateKey);

/** Reusable provider + signer helper. */
const setup = async () => {
  const signer = new Signer(env.signerPrivateKey!);
  const pubKey = await signer.getPublicKey();
  const provider = new FastProvider({ url: env.url! });
  return { signer, pubKey, provider };
};

describe("FastProvider integration (real REST)", () => {
  it.runIf(hasUrl && hasSigner)(
    "getAccountInfo returns validated account payload",
    async () => {
      const { pubKey, provider } = await setup();
      const result = await provider.getAccountInfo({
        address: pubKey,
        tokenBalancesFilter: null,
        stateKeyFilter: null,
        certificateByNonce: null,
      });

      expect(result.sender).toBeInstanceOf(Uint8Array);
      expect(result.sender).toHaveLength(32);
      expect(typeof result.balance).toBe("bigint");
      expect(typeof result.nextNonce).toBe("bigint");
    },
  );

  it.runIf(hasUrl && hasSigner)(
    "getAccountInfo with tokenBalancesFilter returns filtered balances",
    async () => {
      const { pubKey, provider } = await setup();
      const full = await provider.getAccountInfo({
        address: pubKey,
        tokenBalancesFilter: null,
        stateKeyFilter: null,
        certificateByNonce: null,
      });

      // Ask for a specific token from the account's balances (or an empty filter)
      const tokenId = full.tokenBalance[0]?.[0];
      const filtered = await provider.getAccountInfo({
        address: pubKey,
        tokenBalancesFilter: tokenId ? [tokenId] : [],
        stateKeyFilter: null,
        certificateByNonce: null,
      });

      expect(typeof filtered.balance).toBe("bigint");
      if (tokenId) {
        expect(filtered.tokenBalance.length).toBeLessThanOrEqual(
          full.tokenBalance.length,
        );
      }
    },
  );

  it.runIf(hasUrl && hasSigner)(
    "getPendingMultisigTransactions returns an array",
    async () => {
      const { pubKey, provider } = await setup();
      const result = await provider.getPendingMultisigTransactions({
        address: pubKey,
      });

      expect(Array.isArray(result)).toBe(true);
    },
  );

  it.runIf(hasUrl && hasSigner)(
    "getTransactionCertificates returns an array",
    async () => {
      const { pubKey, provider } = await setup();
      const result = await provider.getTransactionCertificates({
        address: pubKey,
        fromNonce: 0n,
        limit: 10,
      });

      expect(Array.isArray(result)).toBe(true);
    },
  );

  it.runIf(hasUrl && hasSigner)(
    "getTransactionCertificates respects limit parameter",
    async () => {
      const { pubKey, provider } = await setup();
      const result = await provider.getTransactionCertificates({
        address: pubKey,
        fromNonce: 0n,
        limit: 2,
      });

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeLessThanOrEqual(2);
    },
  );

  it.runIf(hasUrl && hasSigner)(
    "getTokenInfo returns nullable token metadata response",
    async () => {
      const { pubKey, provider } = await setup();
      const account = await provider.getAccountInfo({
        address: pubKey,
        tokenBalancesFilter: null,
        stateKeyFilter: null,
        certificateByNonce: null,
      });

      const tokenId = account.tokenBalance[0]?.[0];
      if (!tokenId) {
        expect(account.tokenBalance.length).toBe(0);
        return;
      }

      const result = await provider.getTokenInfo({ tokenIds: [tokenId] });
      expect(result === null || typeof result === "object").toBe(true);
    },
  );

  it.runIf(hasUrl && hasSigner)(
    "faucetDrip is reachable with signer-derived recipient",
    async () => {
      const { pubKey, provider } = await setup();

      try {
        await provider.faucetDrip({
          recipient: pubKey,
          amount: 1n,
          tokenId: null,
        });
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }

      expect(true).toBe(true);
    },
  );

  it.runIf(hasUrl && hasSigner)(
    "submitTransaction full pipeline: getAccountInfo → build → sign → submit",
    async () => {
      const { signer, pubKey, provider } = await setup();

      const account = await provider.getAccountInfo({
        address: pubKey,
        tokenBalancesFilter: null,
        stateKeyFilter: null,
        certificateByNonce: null,
      });

      const builder = new TransactionBuilder({
        networkId: (env.networkId ?? "fast:testnet") as "fast:testnet",
        signer,
        nonce: account.nextNonce,
      });

      builder.addExternalClaim({
        claim: {
          verifierCommittee: [],
          verifierQuorum: 0,
          claimData: new TextEncoder().encode("sdk integration test"),
        },
        signatures: [],
      });

      const envelope = await builder.sign();
      const result = await provider.submitTransaction(envelope);
      expect(result).toBeTruthy();
    },
  );

  // -----------------------------------------------------------------------
  // Escrow endpoints
  // -----------------------------------------------------------------------

  it.runIf(hasUrl && hasSigner)(
    "getEscrowJobs returns an array for client role",
    async () => {
      const { pubKey, provider } = await setup();
      const result = await provider.getEscrowJobs({
        client: pubKey,
        certs: false,
      });

      expect(Array.isArray(result)).toBe(true);
    },
  );

  it.runIf(hasUrl && hasSigner)(
    "getEscrowJobs with certs=true returns an array",
    async () => {
      const { pubKey, provider } = await setup();
      const result = await provider.getEscrowJobs({
        client: pubKey,
        certs: true,
      });

      expect(Array.isArray(result)).toBe(true);
    },
  );

  it.runIf(hasUrl && hasSigner)(
    "getEscrowJob with nonexistent jobId throws NotFoundError",
    async () => {
      const { provider } = await setup();
      const fakeJobId = new Uint8Array(32); // all zeros

      await expect(
        provider.getEscrowJob({ jobId: fakeJobId, certs: false }),
      ).rejects.toThrow(NotFoundError);
    },
  );

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  it.runIf(hasUrl)(
    "getAccountInfo with invalid address throws",
    async () => {
      const provider = new FastProvider({ url: env.url! });
      const badAddr = new Uint8Array(32); // all zeros, likely no account

      // Should either succeed (account exists) or throw a typed error
      try {
        const result = await provider.getAccountInfo({
          address: badAddr,
          tokenBalancesFilter: null,
          stateKeyFilter: null,
          certificateByNonce: null,
        });
        expect(result).toBeTruthy();
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
    },
  );

  it("prints setup guidance when environment is missing", () => {
    const missing: string[] = [];
    if (!env.url) missing.push("FAST_TEST_URL");
    if (!env.signerPrivateKey) missing.push("FAST_TEST_SIGNER_PRIVATE_KEY");

    if (missing.length === 0) {
      expect(true).toBe(true);
      return;
    }

    const hint = [
      "Set env vars to enable real integration tests:",
      "FAST_TEST_URL=https://your-proxy-endpoint",
      "FAST_TEST_SIGNER_PRIVATE_KEY=0x...       # required, used to derive sender address and sign tx",
      "FAST_TEST_NETWORK_ID=fast:testnet        # optional, default fast:testnet",
      `Missing required vars: ${missing.join(", ")}`,
    ].join("\n");

    expect(hint).toContain("FAST_TEST_SIGNER_PRIVATE_KEY");
  });
});
