// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import { snapshotBoundedObjectCertificate, validateSettlementCertificate } from "../src/internal/receipts.js";

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

it("bounds parsed lossless JSON before certificate schema traversal", async () => {
  const depth = 130;
  const certificate = `${'{"nested":'.repeat(depth)}null${'}'.repeat(depth)}`;

  await expect(validateSettlementCertificate(certificate, {
    network: "fast:testnet",
    senderHex: fixture.signerHex as string,
    nonce: BigInt(fixture.nonce as string | number),
    txId: fixture.txId as string,
    sha256: "11".repeat(32),
    claimDataHex: fixture.claimDataHex as string,
  })).rejects.toMatchObject({ code: "certificate_too_large" });
});

it("uses one captured length when snapshotting a proxied certificate array", () => {
  let lengthReads = 0;
  const input = new Proxy(["safe"], {
    get(target, property, receiver) {
      if (property === "length") {
        lengthReads += 1;
        return lengthReads === 1 ? 1 : 10_001;
      }
      return Reflect.get(target, property, receiver);
    },
  });

  const snapshot = snapshotBoundedObjectCertificate(input);

  expect(lengthReads).toBe(1);
  expect(snapshot).toHaveLength(1);
});

it("rejects proxied certificate array indices outside the captured length before copying", () => {
  let indexedValueReads = 0;
  let lengthReads = 0;
  const input = new Proxy([] as unknown[], {
    get(target, property, receiver) {
      if (property === "length") {
        lengthReads += 1;
        return 1;
      }
      if (property === "0" || property === "100000") indexedValueReads += 1;
      return Reflect.get(target, property, receiver);
    },
    ownKeys() {
      return ["0", "100000", "length"];
    },
    getOwnPropertyDescriptor(target, property) {
      if (property === "length") return Reflect.getOwnPropertyDescriptor(target, property);
      if (property === "0" || property === "100000") {
        return { configurable: true, enumerable: true, value: "safe", writable: true };
      }
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
  });
  let thrown: unknown;

  try {
    snapshotBoundedObjectCertificate(input);
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toMatchObject({ code: "certificate_too_large" });
  expect(lengthReads).toBe(1);
  expect(indexedValueReads).toBe(0);
});
