// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import { validateSettlementCertificate } from "../src/internal/receipts.js";

const fixture = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures/protocol.json"), "utf8"),
).certificate as Record<string, unknown>;

it("validates the independent certificate against every frozen identifier", async () => {
  const result = await validateSettlementCertificate(
    fixture.certificateRestJson as string,
    {
      network: "fast:testnet",
      senderHex: fixture.signerHex as string,
      nonce: BigInt(fixture.nonce as string | number),
      txId: fixture.txId as string,
      sha256: "11".repeat(32),
      claimDataHex: fixture.claimDataHex as string,
    },
  );
  expect(result.txId).toBe(fixture.txId);
  expect(result.senderSignatureHex).toBe(fixture.senderSignatureHex);
});

it("rejects a certificate bound to another tx", async () => {
  await expect(validateSettlementCertificate(
    fixture.certificateRestJson as string,
    {
      network: "fast:testnet",
      senderHex: fixture.signerHex as string,
      nonce: BigInt(fixture.nonce as string | number),
      txId: "00".repeat(32),
      sha256: "11".repeat(32),
      claimDataHex: fixture.claimDataHex as string,
    },
  )).rejects.toThrow(/transaction|tx/i);
});
