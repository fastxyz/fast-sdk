// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * The V3-only, typed `ArtifactAttestationV3` claim payload — an independent TS
 * mirror of `fastset-sign-core/src/attestation_v3.rs` built on the canonical
 * JSON codec (`./canonical`). Callers either decode the exact V3 schema or
 * receive an `AttestationV3Error` carrying one of the frozen error classes.
 * V3 drops the `artifact_version` field V2 carried; there is no V2 back-compat.
 *
 * The normative spec is
 * `docs/ultimatepowers/specs/2026-07-21-artifact-attestation-v3-design.md`
 * (§3 fields, §5 canonical JSON, §5.1 metadata text, §10 size). This module
 * must round-trip byte-identically with the Rust golden vectors in
 * `test-vectors/artifact-attestation-v3.json`.
 */

import {
  CanonicalJsonError,
  decodeCanonicalObject,
  encodeCanonicalObject,
  parseRawObject,
  type CanonicalFieldSpec,
  type CanonicalValue,
  type RawValue,
} from "./canonical.js";
// Reuse the exposed shared predicates rather than re-deriving them:
//  - the frozen Fast ID wire-name grammar (mirror of `validate_fast_id_name`);
//  - the frozen visible-metadata-text whitespace set (mirror of
//    `has_visible_metadata_text`).
import { AttestationDecodeError, validateFastId } from "./fast-id.js";
import { assertWellFormedUtf16, hasVisibleMetadataTextV1, validateMetadataTextV1 } from "./metadata.js";

export const ATTESTATION_V3_SCHEMA = "fastset-sign/artifact-attestation/v3";

/**
 * Protective parser bound used before the exact size-freeze gate (§10). This is
 * intentionally no larger than Fast App's current full signing-byte guard.
 */
export const ATTESTATION_V3_MAX_INPUT_BYTES = 4_096;

export const MAX_METADATA_TEXT_BYTES = 256;

const U64_MAX = 0xffff_ffff_ffff_ffffn;

export type DigestAlgorithm = "sha256";
export type CommitmentMode = "public_sha256";

export type Relationship =
  | "authored"
  | "co_authored"
  | "approved"
  | "published"
  | "reviewed"
  | "witnessed"
  | "received"
  | "official_release";

// Frozen relationship vocabulary of 8, in the Rust `Relationship::parse` order.
export const RELATIONSHIPS: readonly Relationship[] = [
  "authored",
  "co_authored",
  "approved",
  "published",
  "reviewed",
  "witnessed",
  "received",
  "official_release",
];

export interface FastIdAttribution {
  /** Bare canonical `given.family` — never normalized or folded. */
  readonly fastId: string;
  /** `name_claim_tx`, exactly 32 bytes. */
  readonly addressBindingRef: Uint8Array;
  /** Fast ID operator-receipt hash, exactly 32 bytes. */
  readonly addressBindingReceipt: Uint8Array;
}

export interface ArtifactAttestationV3 {
  readonly digestAlgorithm: DigestAlgorithm;
  readonly commitmentMode: CommitmentMode;
  readonly digest: Uint8Array; // 32
  readonly relationship: Relationship;
  readonly signer: Uint8Array; // 32
  readonly requestId: Uint8Array; // 16
  readonly issuedAt: bigint; // unsigned Unix seconds, canonical u64
  readonly signerName: string;
  readonly fileLabel: string;
  readonly listBySigner: boolean;
  readonly metadataRevision: bigint; // exactly 1n for an initial attestation
  readonly fastIdAttribution: FastIdAttribution | null;
}

/**
 * The closed set of frozen error classes, mirroring the Rust `KNOWN_CLASSES`.
 * `bad_request_id_hex` and `bad_binding_ref_hash` have no dedicated vector but
 * remain members of the closed partition.
 */
export type AttestationV3ErrorClass =
  | "input_too_large"
  | "bom"
  | "invalid_utf8"
  | "malformed_json"
  | "trailing_bytes"
  | "root_not_object"
  | "duplicate_key"
  | "unknown_key"
  | "null"
  | "unsupported_schema"
  | "noncanonical_uint"
  | "key_set_or_order"
  | "wrong_json_type"
  | "noncanonical_json"
  | "invalid_string_escape"
  | "u64_overflow"
  | "metadata_control"
  | "metadata_ufeff"
  | "metadata_too_long"
  | "invisible_label"
  | "bad_digest_algorithm"
  | "bad_commitment_mode"
  | "bad_relationship"
  | "bad_digest_hex"
  | "bad_signer_hex"
  | "bad_request_id_hex"
  | "bad_binding_ref_hash"
  | "bad_receipt_hash"
  | "bad_fast_id"
  | "bad_revision";

export const ATTESTATION_V3_ERROR_CLASSES: ReadonlySet<string> = new Set<AttestationV3ErrorClass>([
  "input_too_large",
  "bom",
  "invalid_utf8",
  "malformed_json",
  "trailing_bytes",
  "root_not_object",
  "duplicate_key",
  "unknown_key",
  "null",
  "unsupported_schema",
  "noncanonical_uint",
  "key_set_or_order",
  "wrong_json_type",
  "noncanonical_json",
  "invalid_string_escape",
  "u64_overflow",
  "metadata_control",
  "metadata_ufeff",
  "metadata_too_long",
  "invisible_label",
  "bad_digest_algorithm",
  "bad_commitment_mode",
  "bad_relationship",
  "bad_digest_hex",
  "bad_signer_hex",
  "bad_request_id_hex",
  "bad_binding_ref_hash",
  "bad_receipt_hash",
  "bad_fast_id",
  "bad_revision",
]);

export class AttestationV3Error extends Error {
  constructor(
    readonly errorClass: AttestationV3ErrorClass,
    message: string,
  ) {
    super(message);
    this.name = "AttestationV3Error";
  }
}

function fail(errorClass: AttestationV3ErrorClass, message: string): never {
  throw new AttestationV3Error(errorClass, message);
}

const BASE_FIELDS: readonly CanonicalFieldSpec[] = [
  { key: "schema", kind: "string" },
  { key: "digest_algorithm", kind: "string" },
  { key: "commitment_mode", kind: "string" },
  { key: "digest", kind: "string" },
  { key: "relationship", kind: "string" },
  { key: "signer", kind: "string" },
  { key: "request_id", kind: "string" },
  { key: "issued_at", kind: "uint-string" },
  { key: "signer_name", kind: "string" },
  { key: "file_label", kind: "string" },
  { key: "list_by_signer", kind: "bool" },
  { key: "metadata_revision", kind: "uint-string" },
];

const ATTRIBUTED_FIELDS: readonly CanonicalFieldSpec[] = [
  ...BASE_FIELDS,
  { key: "fast_id", kind: "string" },
  { key: "address_binding_ref", kind: "string" },
  { key: "address_binding_receipt", kind: "string" },
];

const textEncoder = new TextEncoder();

// ── Metadata-text policy (mirror of claim.rs validate_text) ───────────────────
// The frozen C0/C1/U+FEFF/length/surrogate policy lives in ONE place — the
// shared `validateMetadataTextV1` predicate — so this module keeps no second
// copy of it. The `maxBytes` parameter is applied in the exact Rust order:
// surrogate rejection, then the field byte bound, then the shared control/U+FEFF
// scan. (V3 fields all share the 256-byte bound; V2's tighter 64-byte
// artifact_version field is gone.)
function validateText(value: string, maxBytes: number): void {
  // Fail closed on a lone UTF-16 surrogate FIRST — before the byte bound. A lone
  // surrogate has no UTF-8 form; `TextEncoder` silently coerces it to U+FFFD,
  // which would both mismeasure the length and misclassify the value. The
  // decoder and Rust reject a lone surrogate as `invalid_string_escape` at parse
  // time, so the encoder's policy gate must too, taking precedence over length.
  try {
    assertWellFormedUtf16(value);
  } catch {
    fail("invalid_string_escape", "metadata text contains an unpaired UTF-16 surrogate");
  }
  // The value is surrogate-free here, so this UTF-8 length is exact. This
  // field-specific byte bound mirrors Rust `validate_text`'s first check and
  // takes precedence over the control scan.
  if (textEncoder.encode(value).length > maxBytes) {
    fail("metadata_too_long", `metadata text exceeds ${maxBytes} UTF-8 bytes`);
  }
  // Delegate the frozen C0/C1/U+FEFF policy to the single shared predicate. Its
  // surrogate and 256-byte-length branches are already satisfied above, so only
  // the control / U+FEFF classes can surface from here.
  try {
    validateMetadataTextV1(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("control character")) fail("metadata_control", message);
    if (message.includes("U+FEFF")) fail("metadata_ufeff", message);
    // The remaining shared branches (surrogate, 256-byte length) are already
    // enforced above; classify defensively rather than let anything slip past.
    fail("metadata_too_long", message);
  }
}

// ── Hex helpers (mirror of decode_hex_array / hex::encode) ────────────────────
function encodeHexLower(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

function decodeHexArray(value: string, byteLength: number, errorClass: AttestationV3ErrorClass): Uint8Array {
  if (value.length !== byteLength * 2 || !/^[0-9a-f]*$/.test(value)) {
    fail(errorClass, `must be ${byteLength * 2} lowercase hex characters`);
  }
  const out = new Uint8Array(byteLength);
  for (let index = 0; index < byteLength; index += 1) {
    out[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

function parseDigestAlgorithm(value: string): DigestAlgorithm {
  if (value !== "sha256") fail("bad_digest_algorithm", "digest_algorithm must be sha256");
  return "sha256";
}

function parseCommitmentMode(value: string): CommitmentMode {
  if (value !== "public_sha256") fail("bad_commitment_mode", "only public_sha256 is supported");
  return "public_sha256";
}

function parseRelationship(value: string): Relationship {
  if (!(RELATIONSHIPS as readonly string[]).includes(value)) {
    fail("bad_relationship", "unknown relationship");
  }
  return value as Relationship;
}

function parseU64(value: string): bigint {
  // The canonical codec already guarantees `value` is a canonical decimal (no
  // leading zeros, no signs); only the u64 upper bound remains to enforce.
  const parsed = BigInt(value);
  if (parsed > U64_MAX) fail("u64_overflow", "must be in the canonical u64 range");
  return parsed;
}

function stringValue(value: CanonicalValue): string {
  // The field-spec kinds guarantee this; the guard is defensive only.
  if (value.kind !== "string" && value.kind !== "uint-string") {
    fail("wrong_json_type", "expected a canonical string value");
  }
  return value.value;
}

function boolValue(value: CanonicalValue): boolean {
  if (value.kind !== "bool") fail("wrong_json_type", "expected a canonical boolean value");
  return value.value;
}

function mapCanonicalError(error: CanonicalJsonError): AttestationV3Error {
  switch (error.code) {
    case "INPUT_TOO_LARGE":
      return new AttestationV3Error("input_too_large", error.message);
    case "BOM":
      return new AttestationV3Error("bom", error.message);
    case "INVALID_UTF8":
      return new AttestationV3Error("invalid_utf8", error.message);
    case "MALFORMED_JSON":
      return new AttestationV3Error("malformed_json", error.message);
    case "TRAILING_BYTES":
      return new AttestationV3Error("trailing_bytes", error.message);
    case "ROOT_NOT_OBJECT":
      return new AttestationV3Error("root_not_object", error.message);
    case "DUPLICATE_KEY":
      return new AttestationV3Error("duplicate_key", error.message);
    case "UNKNOWN_KEY":
      return new AttestationV3Error("unknown_key", error.message);
    case "NULL_VALUE":
      return new AttestationV3Error("null", error.message);
    case "UNPAIRED_SURROGATE":
      return new AttestationV3Error("invalid_string_escape", error.message);
    case "NON_CANONICAL": {
      const message = error.message;
      if (message.includes("unsigned integer must")) return new AttestationV3Error("noncanonical_uint", message);
      if (message === "object keys do not match the required set and order") {
        return new AttestationV3Error("key_set_or_order", message);
      }
      if (message === "input does not equal its canonical re-encoding") {
        return new AttestationV3Error("noncanonical_json", message);
      }
      if (message.includes("wrong JSON type")) return new AttestationV3Error("wrong_json_type", message);
      return new AttestationV3Error("noncanonical_json", message);
    }
    default:
      return new AttestationV3Error("noncanonical_json", error.message);
  }
}

type PayloadShape = "base" | "attributed";

/**
 * Shape probe mirroring `probe_payload_shape` in the Rust decoder, in Rust's
 * EXACT precedence:
 *
 *   duplicate_key  >  unsupported_schema  >  { unknown_key, key_set_or_order,
 *   noncanonical_uint, … }
 *
 * Two jobs:
 *  1. DEFER on any duplicate top-level key, so the strict decoder classifies it
 *     as `duplicate_key`. This keeps `duplicate_key` ABOVE `unsupported_schema`
 *     — a duplicated `schema` holding two divergent values is `duplicate_key`,
 *     never `unsupported_schema` (a permissive `JSON.parse` would otherwise
 *     collapse the pair to its last value and hide the duplicate).
 *  2. Otherwise, if a `schema` STRING field is present and foreign, fail
 *     `unsupported_schema` HERE — before the strict decoder can reclassify the
 *     same payload as `unknown_key` / `key_set_or_order` / `noncanonical_uint`.
 *     This is the Rust probe's schema short-circuit; dropping it (as an earlier
 *     over-correction did) breaks the frozen error-class partition.
 *
 * Syntactic/structural surprises (malformed, trailing, non-object root, BOM,
 * bad UTF-8, or a canonical-schema non-scalar value) DEFER to the strict
 * decoder, which owns those classes. A foreign schema remains probe-owned even
 * when a sibling uses an array, object, or number, because the Rust probe
 * short-circuits on schema before field decoding. Beyond classification, the
 * probe also SELECTS the field-set: attributed iff an attribution key is present.
 */
function probeShape(bytes: Uint8Array): PayloadShape {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return "base"; // invalid UTF-8 → the strict decoder yields invalid_utf8
  }
  // Full syntax + trailing + root validation, permissively. Any failure defers:
  // the strict decoder classifies malformed_json / trailing_bytes /
  // root_not_object / bom. (JSON.parse collapses duplicate keys, so it decides
  // nothing schema-related on a duplicated object — the raw fold below does.)
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return "base";
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return "base";

  // Re-fold the raw object to (a) DETECT duplicate top-level keys and (b) read
  // the `schema` value BEFORE JSON.parse's last-wins collapse. Non-scalar
  // siblings are syntax-valid foreign-schema payloads, so they are skipped
  // after validation; duplicate keys still defer to the strict decoder and
  // retain `duplicate_key` precedence.
  let rawFields: Array<[string, RawValue]>;
  try {
    rawFields = parseRawObject(text, true);
  } catch {
    // Duplicate keys remain owned by the strict decoder, preserving the
    // duplicate_key > unsupported_schema precedence.
    return "base";
  }

  // Rust's probe short-circuit: a foreign `schema` string is `unsupported_schema`
  // and takes precedence over every lower canonical defect the strict decoder
  // would otherwise report first.
  const schemaField = rawFields.find(([key]) => key === "schema");
  if (
    schemaField !== undefined &&
    schemaField[1].kind === "string" &&
    schemaField[1].value !== ATTESTATION_V3_SCHEMA
  ) {
    fail("unsupported_schema", `unsupported schema: ${schemaField[1].value}`);
  }

  const attributed = rawFields.some(
    ([key]) =>
      key === "fast_id" || key === "address_binding_ref" || key === "address_binding_receipt",
  );
  return attributed ? "attributed" : "base";
}

function validate(value: ArtifactAttestationV3): void {
  if (!value || typeof value !== "object" ||
      typeof value.listBySigner !== "boolean" || typeof value.issuedAt !== "bigint" ||
      typeof value.metadataRevision !== "bigint" || typeof value.signerName !== "string" ||
      typeof value.fileLabel !== "string") {
    fail("wrong_json_type", "attestation scalar fields must use their declared runtime types");
  }
  if (!(value.digest instanceof Uint8Array) || value.digest.length !== 32) fail("bad_digest_hex", "digest must be 32 bytes");
  if (!(value.signer instanceof Uint8Array) || value.signer.length !== 32) fail("bad_signer_hex", "signer must be 32 bytes");
  if (!(value.requestId instanceof Uint8Array) || value.requestId.length !== 16) fail("bad_request_id_hex", "request_id must be 16 bytes");
  if (value.fastIdAttribution != null) {
    const attribution = value.fastIdAttribution;
    if (typeof attribution !== "object" || typeof attribution.fastId !== "string") {
      fail("wrong_json_type", "attribution must contain the declared runtime fields");
    }
    if (!(attribution.addressBindingRef instanceof Uint8Array) || attribution.addressBindingRef.length !== 32) fail("bad_binding_ref_hash", "address_binding_ref must be 32 bytes");
    if (!(attribution.addressBindingReceipt instanceof Uint8Array) || attribution.addressBindingReceipt.length !== 32) fail("bad_receipt_hash", "address_binding_receipt must be 32 bytes");
  }
  parseDigestAlgorithm(value.digestAlgorithm);
  parseCommitmentMode(value.commitmentMode);
  parseRelationship(value.relationship);
  validateText(value.signerName, MAX_METADATA_TEXT_BYTES);
  validateText(value.fileLabel, MAX_METADATA_TEXT_BYTES);
  if (value.listBySigner && !hasVisibleMetadataTextV1(value.fileLabel)) {
    fail("invisible_label", "listed file_label must contain visible text");
  }
  if (value.metadataRevision !== 1n) {
    fail("bad_revision", "initial attestation revision must be 1");
  }
  if (value.fastIdAttribution) {
    try {
      validateFastId(value.fastIdAttribution.fastId);
    } catch (error) {
      if (error instanceof AttestationDecodeError) fail("bad_fast_id", error.message);
      throw error;
    }
  }
}

export function decodeAttestationV3(bytes: Uint8Array): ArtifactAttestationV3 {
  if (bytes.length > ATTESTATION_V3_MAX_INPUT_BYTES) {
    fail("input_too_large", `canonical JSON exceeds ${ATTESTATION_V3_MAX_INPUT_BYTES} bytes`);
  }
  const shape = probeShape(bytes);
  const specs = shape === "attributed" ? ATTRIBUTED_FIELDS : BASE_FIELDS;

  let values: CanonicalValue[];
  try {
    values = decodeCanonicalObject(bytes, specs, ATTESTATION_V3_MAX_INPUT_BYTES);
  } catch (error) {
    if (error instanceof CanonicalJsonError) throw mapCanonicalError(error);
    throw error;
  }

  const schema = stringValue(values[0]!);
  if (schema !== ATTESTATION_V3_SCHEMA) fail("unsupported_schema", `unsupported schema: ${schema}`);
  const digestAlgorithm = parseDigestAlgorithm(stringValue(values[1]!));
  const commitmentMode = parseCommitmentMode(stringValue(values[2]!));
  const digest = decodeHexArray(stringValue(values[3]!), 32, "bad_digest_hex");
  const relationship = parseRelationship(stringValue(values[4]!));
  const signer = decodeHexArray(stringValue(values[5]!), 32, "bad_signer_hex");
  const requestId = decodeHexArray(stringValue(values[6]!), 16, "bad_request_id_hex");
  const issuedAt = parseU64(stringValue(values[7]!));
  const signerName = stringValue(values[8]!);
  const fileLabel = stringValue(values[9]!);
  const listBySigner = boolValue(values[10]!);
  const metadataRevision = parseU64(stringValue(values[11]!));
  const fastIdAttribution: FastIdAttribution | null =
    shape === "attributed"
      ? {
          fastId: stringValue(values[12]!),
          addressBindingRef: decodeHexArray(stringValue(values[13]!), 32, "bad_binding_ref_hash"),
          addressBindingReceipt: decodeHexArray(stringValue(values[14]!), 32, "bad_receipt_hash"),
        }
      : null;

  const decoded: ArtifactAttestationV3 = {
    digestAlgorithm,
    commitmentMode,
    digest,
    relationship,
    signer,
    requestId,
    issuedAt,
    signerName,
    fileLabel,
    listBySigner,
    metadataRevision,
    fastIdAttribution,
  };
  validate(decoded);
  return decoded;
}

export function encodeAttestationV3(value: ArtifactAttestationV3): Uint8Array {
  validate(value);
  if (value.issuedAt < 0n || value.issuedAt > U64_MAX) fail("u64_overflow", "issued_at out of u64 range");
  if (value.metadataRevision < 0n || value.metadataRevision > U64_MAX) {
    fail("u64_overflow", "metadata_revision out of u64 range");
  }

  const fields: Array<readonly [string, CanonicalValue]> = [
    ["schema", { kind: "string", value: ATTESTATION_V3_SCHEMA }],
    ["digest_algorithm", { kind: "string", value: value.digestAlgorithm }],
    ["commitment_mode", { kind: "string", value: value.commitmentMode }],
    ["digest", { kind: "string", value: encodeHexLower(value.digest) }],
    ["relationship", { kind: "string", value: value.relationship }],
    ["signer", { kind: "string", value: encodeHexLower(value.signer) }],
    ["request_id", { kind: "string", value: encodeHexLower(value.requestId) }],
    ["issued_at", { kind: "uint-string", value: value.issuedAt.toString() }],
    ["signer_name", { kind: "string", value: value.signerName }],
    ["file_label", { kind: "string", value: value.fileLabel }],
    ["list_by_signer", { kind: "bool", value: value.listBySigner }],
    ["metadata_revision", { kind: "uint-string", value: value.metadataRevision.toString() }],
  ];
  if (value.fastIdAttribution) {
    const attribution = value.fastIdAttribution;
    fields.push(
      ["fast_id", { kind: "string", value: attribution.fastId }],
      ["address_binding_ref", { kind: "string", value: encodeHexLower(attribution.addressBindingRef) }],
      ["address_binding_receipt", { kind: "string", value: encodeHexLower(attribution.addressBindingReceipt) }],
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = encodeCanonicalObject(fields);
  } catch (error) {
    if (error instanceof CanonicalJsonError) throw mapCanonicalError(error);
    throw error;
  }
  if (bytes.length > ATTESTATION_V3_MAX_INPUT_BYTES) {
    fail("input_too_large", `canonical JSON exceeds ${ATTESTATION_V3_MAX_INPUT_BYTES} bytes`);
  }
  return bytes;
}
