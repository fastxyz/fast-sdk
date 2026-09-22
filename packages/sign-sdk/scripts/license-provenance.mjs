// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const reviewedDependencies = [
  { name: "@fastxyz/sdk", version: "2.3.1", license: "MIT", evidence: "fastxyz/fast-sdk LICENSE and packages/fast-sdk/package.json" },
  { name: "@fastxyz/schema", version: "2.0.0", license: "MIT", evidence: "fastxyz/fast-sdk LICENSE; packages/fast-schema is covered by the repository license" },
  { name: "@noble/ed25519", version: "2.3.0", license: "MIT", evidence: "published package metadata" },
  { name: "@noble/hashes", version: "1.8.0", license: "MIT", evidence: "published package metadata" },
  { name: "bech32", version: "2.0.0", license: "MIT", evidence: "published package metadata" },
  { name: "effect", version: "3.21.4", license: "MIT", evidence: "published package metadata" },
  { name: "json-with-bigint", version: "3.5.8", license: "MIT", evidence: "published package metadata" },
];

export function assertLicenseProvenance(records = reviewedDependencies) {
  const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const expected = Object.entries(manifest.dependencies).sort(([a], [b]) => a.localeCompare(b));
  const actual = records.map(({ name, version }) => [name, version]).sort(([a], [b]) => a.localeCompare(b));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("dependency license inventory does not match package.json");
  for (const record of records) {
    if (!record.license || !record.evidence) throw new Error(`missing reviewed license provenance for ${record.name}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assertLicenseProvenance();
}
