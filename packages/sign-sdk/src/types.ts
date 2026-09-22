// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

export type SignNetwork = "fast:testnet" | "fast:mainnet";

export type Relationship =
  | "authored"
  | "co_authored"
  | "approved"
  | "published"
  | "reviewed"
  | "witnessed"
  | "received"
  | "official_release";

export interface ByteSigner {
  getPublicKey(): Promise<Uint8Array>;
  signMessage(bytes: Uint8Array): Promise<Uint8Array>;
}

export interface SignInput {
  readonly operationId: string;
  readonly sha256: string;
  readonly relationship: Relationship;
  readonly signerName?: string;
  readonly publicTitle?: string;
  readonly listBySigner?: boolean;
}

export interface FastSettlementProvider {
  getNextNonce(address: string): Promise<bigint>;
  submitTransaction(envelope: unknown): Promise<unknown>;
}
