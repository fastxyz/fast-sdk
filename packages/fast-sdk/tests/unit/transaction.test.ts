import { describe, expect, it } from "vitest";
import { Signer, TransactionBuilder } from "../../src/index";

const HEX_TOKEN_ID =
  "1111111111111111111111111111111111111111111111111111111111111111";
const HEX_STATE_KEY =
  "2222222222222222222222222222222222222222222222222222222222222222";

describe("TransactionBuilder", () => {
  describe("construction", () => {
    it("accepts minimal options", () => {
      const signer = new Signer(new Uint8Array(32).fill(1));
      const builder = new TransactionBuilder({
        networkId: "fast:testnet",
        signer,
        nonce: 0n,
      });
      expect(builder).toBeInstanceOf(TransactionBuilder);
    });

    it("accepts number nonce", () => {
      const signer = new Signer(new Uint8Array(32).fill(1));
      const builder = new TransactionBuilder({
        networkId: "fast:testnet",
        signer,
        nonce: 0,
      });
      expect(builder).toBeInstanceOf(TransactionBuilder);
    });

    it("accepts feeToken option", () => {
      const signer = new Signer(new Uint8Array(32).fill(1));
      const builder = new TransactionBuilder({
        networkId: "fast:testnet",
        signer,
        nonce: 0n,
        feeToken: HEX_TOKEN_ID,
      });
      expect(builder).toBeInstanceOf(TransactionBuilder);
    });
  });

  describe("single operations", () => {
    it("builds TokenTransfer", async () => {
      const signer = new Signer(new Uint8Array(32).fill(10));
      const builder = new TransactionBuilder({
        networkId: "fast:testnet",
        signer,
        nonce: 0n,
      });

      builder.addTokenTransfer({
        tokenId: HEX_TOKEN_ID,
        recipient: new Uint8Array(32).fill(2),
        amount: 1000n,
        userData: null,
      });

      const envelope = await builder.sign();
      expect(envelope.transaction.value.claim.type).toBe("TokenTransfer");
    });

    it("builds TokenCreation", async () => {
      const signer = new Signer(new Uint8Array(32).fill(10));
      const builder = new TransactionBuilder({
        networkId: "fast:testnet",
        signer,
        nonce: 0n,
      });

      builder.addTokenCreation({
        tokenName: "TestToken",
        decimals: 8,
        initialAmount: 1000000n,
        mints: [],
        userData: null,
      });

      const envelope = await builder.sign();
      expect(envelope.transaction.value.claim.type).toBe("TokenCreation");
    });

    it("builds Burn", async () => {
      const signer = new Signer(new Uint8Array(32).fill(10));
      const builder = new TransactionBuilder({
        networkId: "fast:testnet",
        signer,
        nonce: 0n,
      });

      builder.addBurn({ tokenId: HEX_TOKEN_ID, amount: 100n });
      const envelope = await builder.sign();
      expect(envelope.transaction.value.claim.type).toBe("Burn");
      if (envelope.transaction.value.claim.type === "Burn") {
        expect(envelope.transaction.value.claim.value.amount).toBe(100n);
      }
    });

    it("builds Mint", async () => {
      const signer = new Signer(new Uint8Array(32).fill(10));
      const builder = new TransactionBuilder({
        networkId: "fast:testnet",
        signer,
        nonce: 0n,
      });

      builder.addMint({
        tokenId: HEX_TOKEN_ID,
        recipient: new Uint8Array(32).fill(3),
        amount: 500n,
      });

      const envelope = await builder.sign();
      expect(envelope.transaction.value.claim.type).toBe("Mint");
    });

    it("builds LeaveCommittee", async () => {
      const signer = new Signer(new Uint8Array(32).fill(12));
      const builder = new TransactionBuilder({
        networkId: "fast:testnet",
        signer,
        nonce: 2n,
      });

      builder.addLeaveCommittee();
      const envelope = await builder.sign();
      expect(envelope.transaction.value.claim.type).toBe("LeaveCommittee");
    });

    it("builds StateInitialization", async () => {
      const signer = new Signer(new Uint8Array(32).fill(10));
      const builder = new TransactionBuilder({
        networkId: "fast:testnet",
        signer,
        nonce: 0n,
      });

      builder.addStateInitialization({
        key: HEX_STATE_KEY,
        initialState: new Uint8Array(32).fill(0xaa),
      });

      const envelope = await builder.sign();
      expect(envelope.transaction.value.claim.type).toBe("StateInitialization");
    });

    it("builds StateUpdate", async () => {
      const signer = new Signer(new Uint8Array(32).fill(10));
      const builder = new TransactionBuilder({
        networkId: "fast:testnet",
        signer,
        nonce: 0n,
      });

      builder.addStateUpdate({
        key: HEX_STATE_KEY,
        previousState: new Uint8Array(32).fill(0xaa),
        nextState: new Uint8Array(32).fill(0xbb),
        computeClaimTxHash: new Uint8Array(32).fill(0xcc),
        computeClaimTxTimestamp: 1000000n,
      });

      const envelope = await builder.sign();
      expect(envelope.transaction.value.claim.type).toBe("StateUpdate");
    });

    it("builds StateReset", async () => {
      const signer = new Signer(new Uint8Array(32).fill(10));
      const builder = new TransactionBuilder({
        networkId: "fast:testnet",
        signer,
        nonce: 0n,
      });

      builder.addStateReset({
        key: HEX_STATE_KEY,
        resetState: new Uint8Array(32).fill(0),
      });

      const envelope = await builder.sign();
      expect(envelope.transaction.value.claim.type).toBe("StateReset");
    });

    it("builds ExternalClaim", async () => {
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
          claimData: new TextEncoder().encode("test"),
        },
        signatures: [],
      });

      const envelope = await builder.sign();
      expect(envelope.transaction.value.claim.type).toBe("ExternalClaim");
    });
  });

  describe("batching", () => {
    it("builds Batch when multiple operations are added", async () => {
      const signer = new Signer(new Uint8Array(32).fill(11));
      const builder = new TransactionBuilder({
        networkId: "fast:testnet",
        signer,
        nonce: 1n,
      });

      builder
        .addBurn({ tokenId: HEX_TOKEN_ID, amount: 100n })
        .addBurn({ tokenId: HEX_TOKEN_ID, amount: 200n });

      const envelope = await builder.sign();
      expect(envelope.transaction.value.claim.type).toBe("Batch");
    });

    it("batches mixed operation types", async () => {
      const signer = new Signer(new Uint8Array(32).fill(11));
      const builder = new TransactionBuilder({
        networkId: "fast:testnet",
        signer,
        nonce: 0n,
      });

      builder
        .addBurn({ tokenId: HEX_TOKEN_ID, amount: 100n })
        .addTokenTransfer({
          tokenId: HEX_TOKEN_ID,
          recipient: new Uint8Array(32).fill(2),
          amount: 50n,
          userData: null,
        });

      const envelope = await builder.sign();
      expect(envelope.transaction.value.claim.type).toBe("Batch");
    });
  });

  describe("envelope fields", () => {
    it("populates all transaction fields", async () => {
      const signer = new Signer(new Uint8Array(32).fill(15));
      const builder = new TransactionBuilder({
        networkId: "fast:testnet",
        signer,
        nonce: 42n,
        feeToken: HEX_TOKEN_ID,
      });

      builder.addBurn({ tokenId: HEX_TOKEN_ID, amount: 500n });
      const envelope = await builder.sign();

      const tx = envelope.transaction.value;
      expect(tx.networkId).toBe("fast:testnet");
      expect(tx.nonce).toBe(42n);
      expect(tx.sender).toBeInstanceOf(Uint8Array);
      expect(tx.sender).toHaveLength(32);
      expect(tx.archival).toBe(false);
      expect(tx.feeToken).toBeInstanceOf(Uint8Array);
      expect(tx.timestampNanos).toBeTypeOf("bigint");

      expect(envelope.transaction.type).toBe("Release20260319");
      expect(envelope.signature.type).toBe("Signature");
      expect(envelope.signature.value).toHaveLength(64);
    });

    it("sets archival flag", async () => {
      const signer = new Signer(new Uint8Array(32).fill(10));
      const builder = new TransactionBuilder({
        networkId: "fast:testnet",
        signer,
        nonce: 0n,
        archival: true,
      });

      builder.addLeaveCommittee();
      const envelope = await builder.sign();
      expect(envelope.transaction.value.archival).toBe(true);
    });

    it("defaults feeToken to null", async () => {
      const signer = new Signer(new Uint8Array(32).fill(10));
      const builder = new TransactionBuilder({
        networkId: "fast:testnet",
        signer,
        nonce: 0n,
      });

      builder.addLeaveCommittee();
      const envelope = await builder.sign();
      expect(envelope.transaction.value.feeToken).toBeNull();
    });
  });

  describe("builder reuse", () => {
    it("reset clears operations", async () => {
      const signer = new Signer(new Uint8Array(32).fill(13));
      const builder = new TransactionBuilder({
        networkId: "fast:testnet",
        signer,
        nonce: 0n,
      });

      builder.addBurn({ tokenId: HEX_TOKEN_ID, amount: 100n });
      await builder.sign();

      builder.reset().setNonce(1n);
      builder.addLeaveCommittee();
      const envelope = await builder.sign();
      expect(envelope.transaction.value.nonce).toBe(1n);
      expect(envelope.transaction.value.claim.type).toBe("LeaveCommittee");
    });

    it("setSigner changes the signing key", async () => {
      const signer1 = new Signer(new Uint8Array(32).fill(13));
      const signer2 = new Signer(new Uint8Array(32).fill(14));

      const builder = new TransactionBuilder({
        networkId: "fast:testnet",
        signer: signer1,
        nonce: 0n,
      });

      builder.addBurn({ tokenId: HEX_TOKEN_ID, amount: 100n });
      const env1 = await builder.sign();

      builder.reset().setNonce(0n).setSigner(signer2);
      builder.addBurn({ tokenId: HEX_TOKEN_ID, amount: 100n });
      const env2 = await builder.sign();

      expect(env1.transaction.value.sender).toEqual(
        await signer1.getPublicKey(),
      );
      expect(env2.transaction.value.sender).toEqual(
        await signer2.getPublicKey(),
      );
      expect(env1.signature.value).not.toEqual(env2.signature.value);
    });

    it("supports sequential transactions with incrementing nonces", async () => {
      const signer = new Signer(new Uint8Array(32).fill(22));
      const builder = new TransactionBuilder({
        networkId: "fast:testnet",
        signer,
        nonce: 0n,
      });

      const envelopes = [];
      for (let i = 0; i < 3; i++) {
        builder.reset().setNonce(BigInt(i));
        builder.addBurn({
          tokenId: HEX_TOKEN_ID,
          amount: BigInt((i + 1) * 100),
        });
        envelopes.push(await builder.sign());
      }

      expect(envelopes).toHaveLength(3);
      expect(envelopes[0]!.transaction.value.nonce).toBe(0n);
      expect(envelopes[1]!.transaction.value.nonce).toBe(1n);
      expect(envelopes[2]!.transaction.value.nonce).toBe(2n);
    });
  });

  describe("fluent API", () => {
    it("all add* methods return this for chaining", () => {
      const signer = new Signer(new Uint8Array(32).fill(1));
      const builder = new TransactionBuilder({
        networkId: "fast:testnet",
        signer,
        nonce: 0n,
      });

      const result = builder
        .addBurn({ tokenId: HEX_TOKEN_ID, amount: 1n })
        .addBurn({ tokenId: HEX_TOKEN_ID, amount: 2n });

      expect(result).toBe(builder);
    });

    it("reset returns this for chaining", () => {
      const signer = new Signer(new Uint8Array(32).fill(1));
      const builder = new TransactionBuilder({
        networkId: "fast:testnet",
        signer,
        nonce: 0n,
      });

      const result = builder.reset();
      expect(result).toBe(builder);
    });
  });

  describe("network IDs", () => {
    for (const networkId of [
      "fast:localnet",
      "fast:devnet",
      "fast:testnet",
      "fast:mainnet",
    ] as const) {
      it(`accepts ${networkId}`, async () => {
        const signer = new Signer(new Uint8Array(32).fill(1));
        const builder = new TransactionBuilder({
          networkId,
          signer,
          nonce: 0n,
        });
        builder.addLeaveCommittee();
        const envelope = await builder.sign();
        expect(envelope.transaction.value.networkId).toBe(networkId);
      });
    }
  });
});
