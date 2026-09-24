import tr46 from "tr46";

import { encodeCanonicalObject } from "./canonical-json.js";
import { isCanonicalName } from "./name.js";

export const CLAIM_DATA_V2_SCHEMA = "fastid/claim/v2";
export const CLAIM_DATA_V2_MAX_BYTES = 1024;

export type ClaimDataKind =
  | "name"
  | "website"
  | "github"
  | "work"
  | "revoke"
  | "orcid"
  | "x";

const CLAIM_DATA_KIND_MEMBERS: Record<ClaimDataKind, true> = {
  name: true,
  website: true,
  github: true,
  work: true,
  revoke: true,
  orcid: true,
  x: true,
};

export const CLAIM_DATA_KINDS: readonly ClaimDataKind[] = Object.keys(
  CLAIM_DATA_KIND_MEMBERS,
) as ClaimDataKind[];

export function isClaimDataKind(value: unknown): value is ClaimDataKind {
  return (
    typeof value === "string" && Object.hasOwn(CLAIM_DATA_KIND_MEMBERS, value)
  );
}

const encoder = new TextEncoder();
const LOWER_HEX_32 = /^[0-9a-f]{64}$/;

function byteLength(value: string): number {
  return encoder.encode(value).length;
}

function hasAsciiWhitespaceOrControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit <= 0x20 || unit === 0x7f) return true;
  }
  return false;
}

function asciiLowercase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

function isIdnaCanonicalHost(value: string): boolean {
  // URL parsers may preserve an invalid ASCII A-label for web compatibility.
  // Validate with UTS-46 instead; the LDH and length gates below remain separate.
  return tr46.toASCII(value, {
    checkHyphens: false,
    checkBidi: true,
    checkJoiners: true,
    useSTD3ASCIIRules: false,
    verifyDNSLength: false,
    transitionalProcessing: false,
    ignoreInvalidPunycode: false,
  }) === value;
}

function isCanonicalWebsite(value: string): boolean {
  if (
    value.length === 0 ||
    value !== value.toLowerCase() ||
    byteLength(value) > 253
  ) {
    return false;
  }
  if (
    hasAsciiWhitespaceOrControl(value) ||
    /[:/?#@]/u.test(value) ||
    value.endsWith(".")
  ) {
    return false;
  }
  const labels = value.split(".");
  if (
    labels.length < 2 ||
    labels.every((label) => /^[0-9]+$/.test(label))
  ) {
    return false;
  }
  const ldhOk = labels.every(
    (label) =>
      label.length >= 1 &&
      label.length <= 63 &&
      /^[a-z0-9-]+$/.test(label) &&
      !label.startsWith("-") &&
      !label.endsWith("-"),
  );
  return ldhOk && isIdnaCanonicalHost(value);
}

function isCanonicalGithub(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= 39 &&
    value === value.toLowerCase() &&
    /^[a-z0-9-]+$/.test(value) &&
    !value.startsWith("-") &&
    !value.endsWith("-") &&
    !value.includes("--")
  );
}

function isCanonicalWork(value: string): boolean {
  if (
    value.length === 0 ||
    value !== asciiLowercase(value) ||
    byteLength(value) > 255 ||
    hasAsciiWhitespaceOrControl(value) ||
    value.startsWith("doi:") ||
    value.startsWith("https://doi.org/")
  ) {
    return false;
  }
  if (!value.startsWith("10.")) return false;
  const slash = value.indexOf("/");
  if (slash < 0 || slash + 1 >= value.length) return false;
  const registrant = value.slice(3, slash);
  return (
    registrant.length > 0 &&
    registrant
      .split(".")
      .every(
        (segment) => segment.length > 0 && /^[0-9]+$/.test(segment),
      )
  );
}

const ORCID_RE = /^[0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{3}[0-9X]$/;

function orcidChecksumOk(value: string): boolean {
  let total = 0;
  for (const index of [
    0, 1, 2, 3, 5, 6, 7, 8, 10, 11, 12, 13, 15, 16, 17,
  ]) {
    total = (total + (value.charCodeAt(index) - 48)) * 2;
  }
  const result = (12 - (total % 11)) % 11;
  const expected = result === 10 ? "X" : String(result);
  return value[18] === expected;
}

function isCanonicalOrcid(value: string): boolean {
  return ORCID_RE.test(value) && orcidChecksumOk(value);
}

const X_HANDLE_RE = /^[a-z0-9_]{1,15}$/;

export function isCanonicalClaimValue(
  kind: ClaimDataKind,
  value: string,
): boolean {
  switch (kind) {
    case "name":
      return isCanonicalName(value);
    case "website":
      return isCanonicalWebsite(value);
    case "github":
      return isCanonicalGithub(value);
    case "work":
      return isCanonicalWork(value);
    case "revoke":
      return LOWER_HEX_32.test(value);
    case "orcid":
      return isCanonicalOrcid(value);
    case "x":
      return X_HANDLE_RE.test(value);
  }
}

export function encodeClaimDataV2(
  kind: ClaimDataKind,
  value: string,
): Uint8Array {
  if (!isCanonicalClaimValue(kind, value)) {
    throw new Error(`non-canonical ${kind} claim value`);
  }
  const encoded = encodeCanonicalObject([
    ["schema", CLAIM_DATA_V2_SCHEMA],
    ["kind", kind],
    ["value", value],
  ]);
  if (encoded.length > CLAIM_DATA_V2_MAX_BYTES) {
    throw new Error(
      `Fast ID claim_data exceeds ${CLAIM_DATA_V2_MAX_BYTES} bytes`,
    );
  }
  return encoded;
}

export function claimDataHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
