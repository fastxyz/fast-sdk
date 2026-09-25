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
  const sha256 = candidate.sha256;
  const tx_id = candidate.tx_id;
  const signer = candidate.signer;
  const nonce = candidate.nonce;
  const network = candidate.network;
  if (typeof sha256 !== "string") throw new Error("sha256 must be a string");
  if (typeof tx_id !== "string") throw new Error("tx_id must be a string");
  if (typeof signer !== "string") throw new Error("signer must be a string");
  assertLowerHex(sha256, 32, "sha256");
  assertLowerHex(tx_id, 32, "tx_id");
  assertLowerHex(signer, 32, "signer");
  if (typeof nonce !== "number" || !Number.isSafeInteger(nonce) || nonce < 0) {
    throw new Error("nonce must be a non-negative safe integer");
  }
  if (network !== "fast:testnet" && network !== "fast:mainnet") {
    throw new Error("network must be fast:testnet or fast:mainnet");
  }
  return { sha256, tx_id, signer, nonce, network };
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
