// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

import { bech32m } from "bech32";

import { hexToBytes } from "./bytes.js";

export function fastAddressFromPublicKey(publicKey: Uint8Array): string {
  if (!(publicKey instanceof Uint8Array) || publicKey.byteLength !== 32) throw new Error("public key must be 32 bytes");
  return bech32m.encode("fast", bech32m.toWords(publicKey));
}

export function fastAddressFromPublicKeyHex(publicKeyHex: string): string {
  return fastAddressFromPublicKey(hexToBytes(publicKeyHex));
}
