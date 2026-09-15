import { describe, expect, it } from "vitest";

import {
  fastAddressFromSignerHex,
  signerHexOf,
} from "../src/address.js";

const address =
  "fast1rsxfj84yhsskpr6g5ll2td7pkk3dnlsfwldsmawca4922qn3dqvqsxelzv";
const publicKeyHex =
  "1c0c991ea4bc21608f48a7fea5b7c1b5a2d9fe0977db0df5d8ed4aa502716818";

describe("Fast address/public-key conversion", () => {
  it("decodes a known fast1 address and round-trips its 64-hex public key", () => {
    expect(signerHexOf({ address })).toBe(publicKeyHex);
    expect(fastAddressFromSignerHex(publicKeyHex)).toBe(address);
  });

  it("prefers a valid supplied public key and rejects malformed stored keys", () => {
    expect(signerHexOf({ address: "unused", publicKey: `0x${publicKeyHex.toUpperCase()}` })).toBe(
      publicKeyHex,
    );
    expect(fastAddressFromSignerHex("zz".repeat(32))).toBeNull();
    expect(fastAddressFromSignerHex(null)).toBeNull();
  });
});
