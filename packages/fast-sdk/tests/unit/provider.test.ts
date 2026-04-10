import { AccountInfoResponseFromRpc } from "@fastxyz/schema";
import { Schema } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FastProvider, Signer, TransactionBuilder } from "../../src/index";
import { GeneralError } from "../../src/interface/errors";

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
    it("stores rpcUrl", () => {
      const provider = new FastProvider({ rpcUrl: "http://localhost:9999" });
      expect(provider.rpcUrl).toBe("http://localhost:9999");
    });

    it("uses a custom transport when provided", async () => {
      const wireAccountInfo = Schema.encodeSync(AccountInfoResponseFromRpc)({
        sender: new Uint8Array(32).fill(1),
        balance: 0n,
        nextNonce: 7n,
        pendingConfirmation: null,
        requestedState: [],
        requestedCertificates: null,
        requestedValidatedTransaction: null,
        tokenBalance: [],
      });
      const transport = {
        request: vi.fn().mockResolvedValue(wireAccountInfo),
      };

      const provider = new FastProvider({
        rpcUrl: "http://localhost:9999",
        transport,
      });

      const result = await provider.getAccountInfo({
        address: HEX_KEY_32,
      });

      expect(transport.request).toHaveBeenCalledWith(
        "http://localhost:9999",
        "proxy_getAccountInfo",
        expect.any(Object),
      );
      expect(result.nextNonce).toBe(7n);
    });

    it("normalizes JSON-RPC-shaped transport errors", async () => {
      const provider = new FastProvider({
        rpcUrl: "http://localhost:9999",
        transport: {
          request: vi.fn().mockRejectedValue({
            code: 1,
            message: "boom",
            data: { GeneralError: "transport failed" },
          }),
        },
      });

      await expect(
        provider.getAccountInfo({
          address: HEX_KEY_32,
        }),
      ).rejects.toBeInstanceOf(GeneralError);
    });
  });

  describe("faucetDrip param validation", () => {
    const provider = new FastProvider({ rpcUrl: "http://localhost:9999" });

    const expectFetchError = async (fn: () => Promise<unknown>) => {
      await expect(fn()).rejects.toThrow();
    };

    it("accepts hex string recipient + bigint amount", async () => {
      await expectFetchError(() =>
        provider.faucetDrip({
          recipient: HEX_KEY_32,
          amount: 500n,
          tokenId: null,
        }),
      );
    });

    it("accepts Uint8Array recipient + number amount", async () => {
      await expectFetchError(() =>
        provider.faucetDrip({
          recipient: new Uint8Array(32).fill(1),
          amount: 100,
          tokenId: null,
        }),
      );
    });

    it("accepts number[] recipient", async () => {
      await expectFetchError(() =>
        provider.faucetDrip({
          recipient: Array.from({ length: 32 }, () => 0),
          amount: 1n,
          tokenId: null,
        }),
      );
    });

    it("accepts hex string tokenId", async () => {
      await expectFetchError(() =>
        provider.faucetDrip({
          recipient: HEX_KEY_32,
          amount: 1n,
          tokenId: HEX_TOKEN_ID,
        }),
      );
    });

    it("rejects invalid recipient length", async () => {
      await expect(() =>
        provider.faucetDrip({ recipient: "abcd", amount: 1n, tokenId: null }),
      ).rejects.toThrow();
    });
  });

  describe("getAccountInfo param validation", () => {
    const provider = new FastProvider({ rpcUrl: "http://localhost:9999" });

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
    const provider = new FastProvider({ rpcUrl: "http://localhost:9999" });

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
    const provider = new FastProvider({ rpcUrl: "http://localhost:9999" });

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
    const provider = new FastProvider({ rpcUrl: "http://localhost:9999" });

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
    const provider = new FastProvider({ rpcUrl: "http://localhost:9999" });

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
