import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CLAIM_DATA_KINDS,
  claimDataHex,
  encodeClaimDataV2,
  isCanonicalClaimValue,
  type ClaimDataKind,
} from "../src/claim-data.js";

interface FixtureCase {
  id: string;
  kind: ClaimDataKind;
  value: string;
  valid: boolean;
  hex?: string;
}

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/parity/claim-data.json", import.meta.url)),
    "utf8",
  ),
) as { kinds: ClaimDataKind[]; cases: FixtureCase[] };

describe("claim-data parity with the web writer", () => {
  it("covers every runtime kind", () => {
    expect(fixture.kinds).toEqual(CLAIM_DATA_KINDS);
    expect(new Set(fixture.cases.map(({ kind }) => kind))).toEqual(
      new Set(CLAIM_DATA_KINDS),
    );
  });

  it.each(fixture.cases)("matches $id", ({ kind, value, valid, hex }) => {
    expect(isCanonicalClaimValue(kind, value)).toBe(valid);
    if (valid) {
      expect(hex).toMatch(/^[0-9a-f]+$/);
      expect(claimDataHex(encodeClaimDataV2(kind, value))).toBe(hex);
    } else {
      expect(hex).toBeUndefined();
      expect(() => encodeClaimDataV2(kind, value)).toThrow(/non-canonical/i);
    }
  });
});
