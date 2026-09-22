// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const reviewedDependencies = [
  { name: "@fastxyz/sdk", version: "2.3.1", license: "MIT", evidence: "fastxyz/fast-sdk LICENSE and packages/fast-sdk/package.json" },
  { name: "@fastxyz/schema", version: "2.0.0", license: "MIT", evidence: "fastxyz/fast-sdk LICENSE; packages/fast-schema is covered by the repository license" },
  { name: "@hpke/common", version: "1.10.1", license: "MIT", evidence: "published package metadata" },
  { name: "@hpke/core", version: "1.9.0", license: "MIT", evidence: "published package metadata" },
  { name: "@mysten/bcs", version: "2.0.3", license: "Apache-2.0", evidence: "published package metadata" },
  { name: "@mysten/utils", version: "0.3.1", license: "Apache-2.0", evidence: "published package metadata" },
  { name: "@noble/ed25519", version: "2.3.0", license: "MIT", evidence: "published package metadata" },
  { name: "@noble/ed25519", version: "3.0.1", license: "MIT", evidence: "published package metadata" },
  { name: "@noble/hashes", version: "1.8.0", license: "MIT", evidence: "published package metadata" },
  { name: "@noble/hashes", version: "2.0.1", license: "MIT", evidence: "published package metadata" },
  { name: "@scure/base", version: "2.0.0", license: "MIT", evidence: "published package metadata" },
  { name: "@standard-schema/spec", version: "1.1.0", license: "MIT", evidence: "published package metadata" },
  { name: "bech32", version: "2.0.0", license: "MIT", evidence: "published package metadata" },
  { name: "effect", version: "3.21.4", license: "MIT", evidence: "published package metadata" },
  { name: "fast-check", version: "3.23.2", license: "MIT", evidence: "published package metadata" },
  { name: "json-with-bigint", version: "3.5.8", license: "MIT", evidence: "published package metadata" },
  { name: "pure-rand", version: "6.1.0", license: "MIT", evidence: "published package metadata" },
];

function readManifest(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function dependencyNames(manifest) {
  const dependencies = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ]);
  for (const name of Object.keys(manifest.peerDependencies ?? {})) {
    if (!manifest.peerDependenciesMeta?.[name]?.optional) dependencies.add(name);
  }
  return [...dependencies];
}

function resolveManifest(name, fromDirectory) {
  const pathParts = name.split("/");
  let directory = fromDirectory;
  while (true) {
    const candidate = resolve(directory, "node_modules", ...pathParts, "package.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error(`cannot resolve production dependency ${name} from ${fromDirectory}`);
}

/** Return every installed production package reachable from this package. */
export function collectProductionDependencies(packageRoot = root) {
  const rootManifest = readManifest(resolve(packageRoot, "package.json"));
  const queue = dependencyNames(rootManifest).map((name) => ({ name, from: packageRoot }));
  const seen = new Map();
  while (queue.length > 0) {
    const { name, from } = queue.shift();
    const manifestPath = realpathSync(resolveManifest(name, from));
    const manifest = readManifest(manifestPath);
    const key = `${manifest.name}@${manifest.version}`;
    if (seen.has(key)) continue;
    seen.set(key, { name: manifest.name, version: manifest.version, path: manifestPath });
    const packageDirectory = dirname(manifestPath);
    for (const dependency of dependencyNames(manifest)) queue.push({ name: dependency, from: packageDirectory });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

export function assertLicenseProvenance(records = reviewedDependencies) {
  for (const record of records) {
    if (!record.license || !record.evidence) throw new Error(`missing reviewed license provenance for ${record.name}`);
  }
  const expected = collectProductionDependencies().map(({ name, version }) => [name, version]);
  const sortCoordinates = ([nameA, versionA], [nameB, versionB]) =>
    nameA.localeCompare(nameB) || versionA.localeCompare(versionB);
  expected.sort(sortCoordinates);
  const actual = records.map(({ name, version }) => [name, version]).sort(sortCoordinates);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("dependency license inventory does not match package.json");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assertLicenseProvenance();
}
