import { describe, expect, it } from "vitest";
import { Signer, TransactionBuilder } from "../../src/index";
import { encodeTxForWalletSigning } from "../../src/wallet/encode-tx";

const HEX_TOKEN_ID =
  "1111111111111111111111111111111111111111111111111111111111111111";

const DOMAIN_PREFIX = new TextEncoder().encode("VersionedTransaction::");

describe("encodeTxForWalletSigning", () => {
  it("output starts with the VersionedTransaction:: domain prefix", async () => {
    const signer = new Signer(new Uint8Array(32).fill(10));
    const builder = new TransactionBuilder({
      networkId: "fast:testnet",
      signer,
      nonce: 0n,
    });
    builder.addBurn({ tokenId: HEX_TOKEN_ID, amount: 100n });
    const envelope = await builder.sign();

    const bytes = await encodeTxForWalletSigning(envelope.transaction);

    expect(bytes.length).toBeGreaterThan(DOMAIN_PREFIX.length);
    expect(bytes.slice(0, DOMAIN_PREFIX.length)).toEqual(DOMAIN_PREFIX);
  });

  it("raw-signing its output equals the full builder.sign() pipeline", async () => {
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

    // encodeTxForWalletSigning + raw signMessage must equal the full builder.sign() pipeline.
    const bytes = await encodeTxForWalletSigning(envelope.transaction);
    const rawSig = await signer.signMessage(bytes);

    expect(rawSig).toEqual(envelope.signature.value);
  });
});
