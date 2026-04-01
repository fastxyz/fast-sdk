import { Schema } from "effect";

export const bytes32 = (fill: number) => new Uint8Array(32).fill(fill);
export const bytes64 = (fill: number) => new Uint8Array(64).fill(fill);
export const numArray32 = (fill: number) =>
  Array.from({ length: 32 }, () => fill);
export const numArray64 = (fill: number) =>
  Array.from({ length: 64 }, () => fill);

export const decodeSync = <A, I>(schema: Schema.Schema<A, I>, value: unknown) =>
  Schema.decodeUnknownSync(schema)(value);

export const encodeSync = <A, I>(schema: Schema.Schema<A, I>, value: A) =>
  Schema.encodeSync(schema)(value);
