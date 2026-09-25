// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  prepareExternalClaimTransaction,
  signPreparedTransaction,
} from "../src/internal/transactions.js";
import { bytesToHex, hexToBytes } from "../src/internal/bytes.js";

interface Fixture {
  certificate: {
    signerHex: string;
    claimDataHex: string;
    senderAddress: string;
    signingBytesHex: string;
    timestampNanos: string;
    txId: string;
  };
}

const fixture = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures/protocol.json"), "utf8"),
) as Fixture;

async function prepare() {
  return prepareExternalClaimTransaction({
    network: "fast:testnet",
    senderPublicKey: hexToBytes(fixture.certificate.signerHex),
    nonce: 7n,
    claimDataHex: fixture.certificate.claimDataHex,
    feeToken: null,
    timestampNanos: BigInt(fixture.certificate.timestampNanos),
  });
}

describe("closed ExternalClaim transaction boundary", () => {
  it("constructs the independent one-claim fixture byte-identically", async () => {
    const prepared = await prepare();
    const versioned = prepared.versioned as {
      value: { claims: Array<{ type: string; value: { claim: { claimData: string } } }> };
    };

    expect(versioned.value.claims).toHaveLength(1);
    expect(versioned.value.claims[0]?.type).toBe("ExternalClaim");
    expect(bytesToHex(versioned.value.claims[0]!.value.claim.claimData as unknown as Uint8Array)).toBe(
      fixture.certificate.claimDataHex,
    );
    expect(prepared.senderAddress).toBe(fixture.certificate.senderAddress);
    expect(Buffer.from(prepared.signingBytes).toString("hex")).toBe(
      fixture.certificate.signingBytesHex,
    );
    expect(prepared.txId).toBe(fixture.certificate.txId);
  });

  it("rejects a prepared value mutated to add a second ExternalClaim before signing", async () => {
    const prepared = await prepare();
    const claims = (prepared.versioned as { value: { claims: unknown[] } }).value.claims;
    claims.push(structuredClone(claims[0]));
    const getPublicKey = vi.fn(async () => prepared.senderPublicKey);
    const signMessage = vi.fn(async () => new Uint8Array(64));

    await expect(signPreparedTransaction(prepared, { getPublicKey, signMessage })).rejects.toThrow(
      /prepared transaction.*changed|exactly one/i,
    );
    expect(getPublicKey).not.toHaveBeenCalled();
    expect(signMessage).not.toHaveBeenCalled();
  });
});
