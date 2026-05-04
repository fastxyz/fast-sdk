import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fromHex, toHex } from "../../src/index";
import {
  deriveMultiSigAddress,
  deriveMultiSigAddressBytes,
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
