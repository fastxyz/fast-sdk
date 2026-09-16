import { describe, expect, it } from "vitest";

import { IdClient, KeySigner, isCanonicalClaimValue } from "../src/index.js";

/**
 * Manual owner-triggered smoke only. Running with ID_SDK_LIVE=1 and a funded
 * 64-hex ID_SDK_KEY submits real testnet transactions and spends testnet fee
 * tokens. It never targets mainnet. Normal CI and local test runs skip it.
 */
describe.skipIf(process.env.ID_SDK_LIVE !== "1")("live testnet lifecycle", () => {
  it("claims, resolves, updates, and revokes a throwaway testnet identity", async () => {
    const key = process.env.ID_SDK_KEY;
    if (!key || !/^[0-9a-f]{64}$/i.test(key)) {
      throw new Error("ID_SDK_KEY must be a bare 64-hex test key");
    }

    const signer = await KeySigner.fromPrivateKey(key);
    const client = new IdClient({ network: "fast:testnet", signer });
    const suffix = Date.now().toString(36).slice(-12);
    const name = `a${suffix}.smoke`;
    expect(isCanonicalClaimValue("name", name)).toBe(true);

    const availability = await client.availability(name);
    expect(availability.available).toBe(true);

    const claimed = await client.claimName(name);
    expect(claimed.registration).toBe("registered");

    const resolved = await client.resolve(name);
    expect(resolved.address).toBe(signer.address);

    await client.updateProfile({ bio: `SDK live smoke ${suffix}` });
    const revoked = await client.revoke("name", name);
    expect(revoked.registration).toBe("registered");
  });
});
