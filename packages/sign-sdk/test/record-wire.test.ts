// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { serializeRecord, validateRecordRequest } from "../src/internal/record-wire.js";

describe("POST /record wire", () => {
  it("does not send local evidence or display metadata to /record", () => {
    const record = {
      sha256: "11".repeat(32),
      tx_id: "22".repeat(32),
      signer: "33".repeat(32),
      nonce: 7,
      network: "fast:testnet" as const,
      claim_data_hex: "aa",
      metadata_sig: "44".repeat(64),
      signature_scope: "versioned_transaction",
      signer_name: "private hint",
    };

    expect(JSON.parse(serializeRecord(record))).toEqual({
      sha256: record.sha256,
      tx_id: record.tx_id,
      signer: record.signer,
      nonce: 7,
      network: "fast:testnet",
    });
    expect(serializeRecord(record)).toBe(
      `{"sha256":"${record.sha256}","tx_id":"${record.tx_id}","signer":"${record.signer}","nonce":7,"network":"fast:testnet"}`,
    );
  });

  it("accepts the maximum safe nonce without converting it to a string", () => {
    const record = validateRecordRequest({
      sha256: "11".repeat(32),
      tx_id: "22".repeat(32),
      signer: "33".repeat(32),
      nonce: Number.MAX_SAFE_INTEGER,
      network: "fast:mainnet",
    });

    expect(record.nonce).toBe(Number.MAX_SAFE_INTEGER);
    expect(typeof JSON.parse(serializeRecord(record)).nonce).toBe("number");
  });

  it.each([
    [{ sha256: "AA".repeat(32) }, "sha256"],
    [{ tx_id: "22".repeat(31) }, "tx_id"],
    [{ signer: `0x${"33".repeat(32)}` }, "signer"],
    [{ nonce: -1 }, "nonce"],
    [{ nonce: Number.MAX_SAFE_INTEGER + 1 }, "nonce"],
    [{ nonce: 1.5 }, "nonce"],
    [{ network: "fast:devnet" }, "network"],
  ] as const)("rejects invalid wire field %j", (override, field) => {
    expect(() =>
      validateRecordRequest({
        sha256: "11".repeat(32),
        tx_id: "22".repeat(32),
        signer: "33".repeat(32),
        nonce: 7,
        network: "fast:testnet",
        ...override,
      }),
    ).toThrow(new RegExp(field));
  });
});
