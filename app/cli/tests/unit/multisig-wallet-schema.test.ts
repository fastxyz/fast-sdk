import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { parseMultiSigWalletConfig } from "../../src/schemas/multisig-wallet";

const SAMPLE = {
  version: 1,
  name: "treasury",
  signers: ["fast1qqqq", "fast1pppp"],
  quorum: 2,
  configNonce: "0",
  fastAddress: "fast1xyz",
  network: "testnet",
};

describe("MultiSigWalletConfigSchema", () => {
  it("decodes a valid wallet config JSON string", async () => {
    const decoded = await Effect.runPromise(
      parseMultiSigWalletConfig(JSON.stringify(SAMPLE)),
    );
    expect(decoded.name).toBe("treasury");
    expect(decoded.quorum).toBe(2);
    expect(decoded.configNonce).toBe("0");
  });

  it("rejects unknown version", async () => {
    await expect(
      Effect.runPromise(
        parseMultiSigWalletConfig(JSON.stringify({ ...SAMPLE, version: 99 })),
      ),
    ).rejects.toThrow();
  });

  it("rejects quorum < 1", async () => {
    await expect(
      Effect.runPromise(
        parseMultiSigWalletConfig(JSON.stringify({ ...SAMPLE, quorum: 0 })),
      ),
    ).rejects.toThrow();
  });

  it("rejects quorum > signer count", async () => {
    await expect(
      Effect.runPromise(
        parseMultiSigWalletConfig(JSON.stringify({ ...SAMPLE, quorum: 3 })),
      ),
    ).rejects.toThrow();
  });

  it("rejects fewer than 2 signers", async () => {
    await expect(
      Effect.runPromise(
        parseMultiSigWalletConfig(
          JSON.stringify({
            ...SAMPLE,
            signers: [SAMPLE.signers[0]],
            quorum: 1,
          }),
        ),
      ),
    ).rejects.toThrow();
  });

  it("rejects duplicate signers", async () => {
    await expect(
      Effect.runPromise(
        parseMultiSigWalletConfig(
          JSON.stringify({
            ...SAMPLE,
            signers: [SAMPLE.signers[0], SAMPLE.signers[0]],
          }),
        ),
      ),
    ).rejects.toThrow();
  });
});
