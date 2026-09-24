// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";

import { expect, it } from "vitest";

import {
  assertPackageInventory,
  assertPackageContent,
  expectedPackageInventory,
} from "../scripts/package-artifact.mjs";
import { assertLicenseProvenance, reviewedDependencies } from "../scripts/license-provenance.mjs";

it("accepts only the exact public tarball inventory", () => {
  expect(() => assertPackageInventory(expectedPackageInventory)).not.toThrow();
  expect(() => assertPackageInventory([...expectedPackageInventory, "package/src/private.ts"]))
    .toThrow(/unexpected/i);
  expect(() => assertPackageInventory(expectedPackageInventory.slice(1))).toThrow(/missing/i);
});

it.each([
  ["private source paths", "// fastset-sign-core/src/attestation_v3.rs"],
  ["absolute paths", "source: /Users/agent/private/file.ts"],
  ["secret-like material", "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456"],
])("rejects tarball text containing %s", (_label, content) => {
  expect(() => assertPackageContent([{ path: "package/dist/index.js", content }]))
    .toThrow(/private|absolute|secret|forbidden/i);
});

it("requires every published release-evidence gate in the schema", () => {
  const schema = JSON.parse(readFileSync(new URL("../provenance/release-evidence.schema.json", import.meta.url), "utf8")) as {
    required: string[];
  };
  expect(schema.required).toEqual(expect.arrayContaining([
    "trustedPublishingEnvironment",
    "downloadedTarball",
    "provenance",
    "npmVerification",
    "extractedMetadata",
  ]));
});

it("rejects dependencies without reviewed license provenance", () => {
  expect(() => assertLicenseProvenance()).not.toThrow();
  expect(() => assertLicenseProvenance([{ name: "unknown", version: "1.0.0", license: null }]))
    .toThrow(/license/i);
});

it("requires transitive production dependencies in the reviewed inventory", () => {
  const withoutTransitive = reviewedDependencies.filter((record) => record.name !== "@hpke/core");
  expect(() => assertLicenseProvenance(withoutTransitive)).toThrow(/inventory/i);
});

it.each(["registryUrl", "integrity"] as const)("binds dependency %s to the exact lockfile resolution", (field) => {
  const changed = reviewedDependencies.map((record, index) => index === 0
    ? { ...record, [field]: field === "integrity" ? "sha512-AAAA" : "https://registry.example/" }
    : record);
  expect(() => assertLicenseProvenance(changed)).toThrow(/lockfile resolution/i);
});

it("requires an explicit reviewed dependency disposition", () => {
  const unresolved = reviewedDependencies.map((record, index) => index === 0
    ? { ...record, disposition: undefined }
    : record);
  expect(() => assertLicenseProvenance(unresolved)).toThrow(/disposition/i);
});
