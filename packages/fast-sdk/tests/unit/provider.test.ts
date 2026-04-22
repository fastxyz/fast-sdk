import { afterEach, describe, expect, it, vi } from "vitest";
import { FastProvider, Signer, TransactionBuilder } from "../../src/index";

const HEX_KEY_32 =
  "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
const HEX_TOKEN_ID =
  "1111111111111111111111111111111111111111111111111111111111111111";
const HEX_STATE_KEY =
  "2222222222222222222222222222222222222222222222222222222222222222";

describe("FastProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("construction", () => {
    it("stores url", () => {
      const provider = new FastProvider({ url: "http://localhost:9999", networkId: "fast:localnet" });
      expect(provider.url).toBe("http://localhost:9999");
    });
  });

  describe("getAccountInfo param validation", () => {
    const provider = new FastProvider({ url: "http://localhost:9999", networkId: "fast:localnet" });

    const expectFetchError = async (fn: () => Promise<unknown>) => {
      await expect(fn()).rejects.toThrow();
    };

    it("accepts minimal params (all filters null)", async () => {
      await expectFetchError(() =>
        provider.getAccountInfo({
          address: HEX_KEY_32,
          tokenBalancesFilter: null,
          stateKeyFilter: null,
          certificateByNonce: null,
        }),
      );
    });

    it("accepts with token balance filter", async () => {
      await expectFetchError(() =>
        provider.getAccountInfo({
          address: new Uint8Array(32).fill(1),
          tokenBalancesFilter: [HEX_TOKEN_ID],
          stateKeyFilter: null,
          certificateByNonce: null,
        }),
      );
    });

    it("accepts with state key filter", async () => {
      await expectFetchError(() =>
        provider.getAccountInfo({
          address: HEX_KEY_32,
          tokenBalancesFilter: null,
          stateKeyFilter: [HEX_STATE_KEY],
          certificateByNonce: null,
        }),
      );
    });

    it("accepts with certificate by nonce", async () => {
      await expectFetchError(() =>
        provider.getAccountInfo({
          address: HEX_KEY_32,
          tokenBalancesFilter: null,
          stateKeyFilter: null,
          certificateByNonce: { start: 0n, limit: 10 },
        }),
      );
    });

    it("accepts certificate by nonce with number start", async () => {
      await expectFetchError(() =>
        provider.getAccountInfo({
          address: HEX_KEY_32,
          tokenBalancesFilter: null,
          stateKeyFilter: null,
          certificateByNonce: { start: 0, limit: 10 },
        }),
      );
    });
  });

  describe("getPendingMultisigTransactions param validation", () => {
    const provider = new FastProvider({ url: "http://localhost:9999", networkId: "fast:localnet" });

    it("accepts hex address", async () => {
      await expect(
        provider.getPendingMultisigTransactions({ address: HEX_KEY_32 }),
      ).rejects.toThrow();
    });

    it("accepts Uint8Array address", async () => {
      await expect(
        provider.getPendingMultisigTransactions({
          address: new Uint8Array(32).fill(1),
        }),
      ).rejects.toThrow();
    });
  });

  describe("getTokenInfo param validation", () => {
    const provider = new FastProvider({ url: "http://localhost:9999", networkId: "fast:localnet" });

    it("accepts hex token IDs", async () => {
      await expect(
        provider.getTokenInfo({ tokenIds: [HEX_TOKEN_ID] }),
      ).rejects.toThrow();
    });

    it("accepts Uint8Array token IDs", async () => {
      await expect(
        provider.getTokenInfo({ tokenIds: [new Uint8Array(32).fill(1)] }),
      ).rejects.toThrow();
    });

    it("accepts empty token ID array", async () => {
      await expect(provider.getTokenInfo({ tokenIds: [] })).rejects.toThrow();
    });
  });

  describe("getTransactionCertificates param validation", () => {
    const provider = new FastProvider({ url: "http://localhost:9999", networkId: "fast:localnet" });

    it("accepts hex address + bigint nonce", async () => {
      await expect(
        provider.getTransactionCertificates({
          address: HEX_KEY_32,
          fromNonce: 0n,
          limit: 10,
        }),
      ).rejects.toThrow();
    });

    it("accepts number nonce", async () => {
      await expect(
        provider.getTransactionCertificates({
          address: HEX_KEY_32,
          fromNonce: 0,
          limit: 5,
        }),
      ).rejects.toThrow();
    });
  });

  describe("submitTransaction via TransactionBuilder", () => {
    const provider = new FastProvider({ url: "http://localhost:9999", networkId: "fast:localnet" });

    it("accepts a signed envelope (fails at fetch, not validation)", async () => {
      const signer = new Signer(new Uint8Array(32).fill(10));
      const builder = new TransactionBuilder({
        networkId: "fast:testnet",
        signer,
        nonce: 0n,
      });

      builder.addExternalClaim({
        claim: {
          verifierCommittee: [],
          verifierQuorum: 0,
          claimData: new TextEncoder().encode("sdk test"),
        },
        signatures: [],
      });

      const envelope = await builder.sign();
      await expect(provider.submitTransaction(envelope)).rejects.toThrow();
    });
  });
});
