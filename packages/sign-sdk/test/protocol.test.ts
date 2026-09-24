// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ATTESTATION_V3_ERROR_CLASSES,
  ATTESTATION_V3_SCHEMA,
  AttestationV3Error,
  RELATIONSHIPS,
  decodeAttestationV3,
  encodeAttestationV3,
} from "../src/internal/attestation.js";
import { fastAddressFromPublicKeyHex } from "../src/internal/address.js";
import { bytesToHex, hexToBytes } from "../src/internal/bytes.js";

interface ProtocolFixture {
  protocol: {
    positive: Array<{ name: string; hex: string; byte_length: number }>;
    negative: Array<{ name: string; hex: string; expected_error: string }>;
  };
  certificate: { signerHex: string; senderAddress: string };
}

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "fixtures/protocol.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as ProtocolFixture;
const provenance = JSON.parse(
  readFileSync(join(dirname(fixturePath), "provenance.json"), "utf8"),
) as { fixture: string; fixtureSha256: string };

describe("canonical ArtifactAttestationV3", () => {
  it.each(fixture.protocol.positive.map((value) => [value.name, value] as const))(
    "round-trips independent positive vector %s byte-identically",
    (_name, vector) => {
      const bytes = hexToBytes(vector.hex);
      expect(bytes).toHaveLength(vector.byte_length);
      expect(bytesToHex(encodeAttestationV3(decodeAttestationV3(bytes)))).toBe(vector.hex);
    },
  );

  it.each(fixture.protocol.negative.map((value) => [value.name, value] as const))(
    "rejects independent negative vector %s with its frozen class",
    (_name, vector) => {
      try {
        decodeAttestationV3(hexToBytes(vector.hex));
      } catch (error) {
        expect(error).toBeInstanceOf(AttestationV3Error);
        expect((error as AttestationV3Error).errorClass).toBe(vector.expected_error);
        expect(ATTESTATION_V3_ERROR_CLASSES.has(vector.expected_error)).toBe(true);
        return;
      }
      throw new Error(`${vector.name}: unexpectedly decoded`);
    },
  );

  it("freezes the schema and all eight explicit relationships", () => {
    expect(ATTESTATION_V3_SCHEMA).toBe("fastset-sign/artifact-attestation/v3");
    expect(RELATIONSHIPS).toEqual([
      "authored",
      "co_authored",
      "approved",
      "published",
      "reviewed",
      "witnessed",
      "received",
      "official_release",
    ]);
  });

  it("binds the committed fixture bytes to its provenance hash", () => {
    expect(provenance.fixture).toBe("test/fixtures/protocol.json");
    expect(provenance.fixtureSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(createHash("sha256").update(readFileSync(fixturePath)).digest("hex")).toBe(provenance.fixtureSha256);
  });

  it.each([
    ["digestAlgorithm", "sha512", "bad_digest_algorithm"],
    ["commitmentMode", "private_digest", "bad_commitment_mode"],
    ["relationship", "endorsed", "bad_relationship"],
  ] as const)("rejects runtime %s values outside the decoder vocabulary", (field, value, expectedClass) => {
    const valid = decodeAttestationV3(hexToBytes(fixture.protocol.positive[0]!.hex));
    const malformed = { ...valid, [field]: value } as unknown as typeof valid;
    expect(() => encodeAttestationV3(malformed)).toThrow(
      expect.objectContaining({ errorClass: expectedClass }),
    );
  });

  it.each([
    ["array", '{"schema":"foreign/schema","digest":[]}'],
    ["object", '{"schema":"foreign/schema","digest":{}}'],
    ["number", '{"schema":"foreign/schema","digest":1}'],
  ] as const)("classifies a foreign schema with a %s sibling as unsupported_schema", (_kind, text) => {
    expect(() => decodeAttestationV3(new TextEncoder().encode(text))).toThrow(
      expect.objectContaining({ errorClass: "unsupported_schema" }),
    );
  });
});

describe("strict byte and address helpers", () => {
  it("rejects malformed hex instead of coercing it", () => {
    expect(bytesToHex(hexToBytes("00aaff"))).toBe("00aaff");
    expect(() => hexToBytes("abc")).toThrow(/even/i);
    expect(() => hexToBytes("00xz")).toThrow(/hex/i);
    expect(() => bytesToHex("ff" as unknown as Uint8Array)).toThrow(/Uint8Array/i);
  });

  it("derives the fixture Fast address from the 32-byte public key", () => {
    expect(fastAddressFromPublicKeyHex(fixture.certificate.signerHex)).toBe(
      fixture.certificate.senderAddress,
    );
    expect(() => fastAddressFromPublicKeyHex("11".repeat(31))).toThrow(/32 bytes/i);
  });
});

it("fails closed when the committed fixture is absent", () => {
  expect(() => readFileSync(`${fixturePath}.missing`, "utf8")).toThrow();
});
