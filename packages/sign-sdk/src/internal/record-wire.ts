// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

import { assertLowerHex } from "./bytes.js";
import type { SignNetwork } from "../types.js";

export interface RecordRequest {
  readonly sha256: string;
  readonly tx_id: string;
  readonly signer: string;
  readonly nonce: number;
  readonly network: SignNetwork;
}

export function validateRecordRequest(value: unknown): RecordRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("record must be an object");
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.sha256 !== "string") throw new Error("sha256 must be a string");
  if (typeof candidate.tx_id !== "string") throw new Error("tx_id must be a string");
  if (typeof candidate.signer !== "string") throw new Error("signer must be a string");
  assertLowerHex(candidate.sha256, 32, "sha256");
  assertLowerHex(candidate.tx_id, 32, "tx_id");
  assertLowerHex(candidate.signer, 32, "signer");
  if (typeof candidate.nonce !== "number" || !Number.isSafeInteger(candidate.nonce) || candidate.nonce < 0) {
    throw new Error("nonce must be a non-negative safe integer");
  }
  if (candidate.network !== "fast:testnet" && candidate.network !== "fast:mainnet") {
    throw new Error("network must be fast:testnet or fast:mainnet");
  }
  return {
    sha256: candidate.sha256,
    tx_id: candidate.tx_id,
    signer: candidate.signer,
    nonce: candidate.nonce,
    network: candidate.network,
  };
}

export function serializeRecord(value: RecordRequest): string {
  const record = validateRecordRequest(value);
  return JSON.stringify({
    sha256: record.sha256,
    tx_id: record.tx_id,
    signer: record.signer,
    nonce: record.nonce,
    network: record.network,
  });
}
