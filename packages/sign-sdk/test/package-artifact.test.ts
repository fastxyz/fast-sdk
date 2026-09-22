// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

import { expect, it } from "vitest";

import {
  assertPackageInventory,
  expectedPackageInventory,
} from "../scripts/package-artifact.mjs";
import { assertLicenseProvenance, reviewedDependencies } from "../scripts/license-provenance.mjs";

it("accepts only the exact public tarball inventory", () => {
  expect(() => assertPackageInventory(expectedPackageInventory)).not.toThrow();
  expect(() => assertPackageInventory([...expectedPackageInventory, "package/src/private.ts"]))
    .toThrow(/unexpected/i);
  expect(() => assertPackageInventory(expectedPackageInventory.slice(1))).toThrow(/missing/i);
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
