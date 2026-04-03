import type { BcsType } from "@mysten/bcs";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { Effect, Encoding } from "effect";
import { BcsEncodeError } from "../error/crypto";

/** BCS serialize a typed value to bytes. */
export const encode = <T>(schema: BcsType<T>, message: T) =>
  Effect.try({
    try: () => schema.serialize(message).toBytes(),
    catch: (cause) => new BcsEncodeError({ cause }),
  });

/** BCS serialize with a `SchemaName::` domain prefix. Used for signing. */
export const domainEncode = <T>(schema: BcsType<T>, message: T) =>
  Effect.map(encode(schema, message), (serialized) => {
    const prefix = new TextEncoder().encode(`${schema.name}::`);
    const full = new Uint8Array(prefix.length + serialized.length);
    full.set(prefix, 0);
    full.set(serialized, prefix.length);
    return full;
  });

/** BCS serialize + keccak-256 hash. Returns raw bytes. */
export const hash = <T>(schema: BcsType<T>, message: T) =>
  Effect.map(encode(schema, message), keccak_256);

/** BCS serialize + keccak-256 hash. Returns `0x`-prefixed hex string. */
export const hashHex = <T>(schema: BcsType<T>, message: T) =>
  Effect.map(hash(schema, message), (h) => `0x${Encoding.encodeHex(h)}`);

/** Derive a deterministic token ID from sender, nonce, and operation index. */
export const getTokenId = (
  sender: Uint8Array,
  nonce: bigint,
  operationIndex: bigint,
): Uint8Array => {
  const buf = new Uint8Array(32 + 8 + 8);
  buf.set(sender, 0);
  new DataView(buf.buffer).setBigUint64(32, nonce, true);
  new DataView(buf.buffer).setBigUint64(40, operationIndex, true);
  return keccak_256(buf);
};
