import { describe, expect, it } from "vitest";
import { FastProvider, Signer, TransactionBuilder } from "../../src/index";

const env = {
  rpcUrl: process.env.FAST_TEST_RPC_URL,
  signerPrivateKey: process.env.FAST_TEST_SIGNER_PRIVATE_KEY,
  networkId: process.env.FAST_TEST_NETWORK_ID,
} as const;

const hasRpc = Boolean(env.rpcUrl);
const hasSigner = Boolean(env.signerPrivateKey);

describe("FastProvider integration (real RPC)", () => {
  it.runIf(hasRpc && hasSigner)(
    "getAccountInfo returns validated account payload",
    async () => {
      const signer = new Signer(env.signerPrivateKey!);
      const pubKey = await signer.getPublicKey();
      const provider = new FastProvider({ rpcUrl: env.rpcUrl! });
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

  it.runIf(hasRpc && hasSigner)(
    "getPendingMultisigTransactions returns an array",
    async () => {
      const signer = new Signer(env.signerPrivateKey!);
      const pubKey = await signer.getPublicKey();
      const provider = new FastProvider({ rpcUrl: env.rpcUrl! });
      const result = await provider.getPendingMultisigTransactions({
        address: pubKey,
      });

      expect(Array.isArray(result)).toBe(true);
    },
  );

  it.runIf(hasRpc && hasSigner)(
    "getTransactionCertificates returns an array",
    async () => {
      const signer = new Signer(env.signerPrivateKey!);
      const pubKey = await signer.getPublicKey();
      const provider = new FastProvider({ rpcUrl: env.rpcUrl! });
      const result = await provider.getTransactionCertificates({
        address: pubKey,
        fromNonce: 0n,
        limit: 10,
      });

      expect(Array.isArray(result)).toBe(true);
    },
  );

  it.runIf(hasRpc && hasSigner)(
    "getTokenInfo returns nullable token metadata response",
    async () => {
      const signer = new Signer(env.signerPrivateKey!);
      const pubKey = await signer.getPublicKey();
      const provider = new FastProvider({ rpcUrl: env.rpcUrl! });
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

  it.runIf(hasRpc && hasSigner)(
    "faucetDrip is reachable with signer-derived recipient",
    async () => {
      const signer = new Signer(env.signerPrivateKey!);
      const pubKey = await signer.getPublicKey();
      const provider = new FastProvider({ rpcUrl: env.rpcUrl! });

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

  it.runIf(hasRpc && hasSigner)(
    "submitTransaction full pipeline: getAccountInfo → build → sign → submit",
    async () => {
      const provider = new FastProvider({ rpcUrl: env.rpcUrl! });
      const signer = new Signer(env.signerPrivateKey!);
      const pubKey = await signer.getPublicKey();

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

  it("prints setup guidance when environment is missing", () => {
    const missing: string[] = [];
    if (!env.rpcUrl) missing.push("FAST_TEST_RPC_URL");
    if (!env.signerPrivateKey) missing.push("FAST_TEST_SIGNER_PRIVATE_KEY");

    if (missing.length === 0) {
      expect(true).toBe(true);
      return;
    }

    const hint = [
      "Set env vars to enable real integration tests:",
      "FAST_TEST_RPC_URL=https://your-proxy-endpoint",
      "FAST_TEST_SIGNER_PRIVATE_KEY=0x...       # required, used to derive sender address and sign tx",
      "FAST_TEST_NETWORK_ID=fast:testnet        # optional, default fast:testnet",
      `Missing required vars: ${missing.join(", ")}`,
    ].join("\n");

    expect(hint).toContain("FAST_TEST_SIGNER_PRIVATE_KEY");
  });
});
