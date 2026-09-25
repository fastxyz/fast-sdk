// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

const LOWER_HEX = /^[0-9a-f]*$/;

export function bytesToHex(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array)) throw new TypeError("bytes must be a Uint8Array");
  let output = "";
  for (const byte of bytes) output += byte.toString(16).padStart(2, "0");
  return output;
}

export function hexToBytes(hex: string): Uint8Array {
  if (typeof hex !== "string") throw new TypeError("hex must be a string");
  if (hex.length % 2 !== 0) throw new Error("hex string must have an even length");
  if (!LOWER_HEX.test(hex)) throw new Error("hex string must contain lowercase hexadecimal characters");
  const output = new Uint8Array(hex.length / 2);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return output;
}

export function assertLowerHex(value: string, byteLength: number, field: string): void {
  if (typeof value !== "string" || value.length !== byteLength * 2 || !LOWER_HEX.test(value)) {
    throw new Error(`${field} must be ${byteLength} bytes of lowercase hex without 0x`);
  }
}
