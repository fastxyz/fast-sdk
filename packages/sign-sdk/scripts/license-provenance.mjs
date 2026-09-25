// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const { parse: parseYaml } = createRequire(import.meta.url)("yaml");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npmRegistryUrl = "https://registry.npmjs.org/";

export const reviewedDependencies = [
  { name: "@fastxyz/sdk", version: "2.3.1", registryUrl: npmRegistryUrl, integrity: "sha512-UaY1XbPGrT2RXWnNMtfrinF10OFCHRZuLiGPH1g+JEjxioPJCXxbCc0uhK38NdZmDfVLlEAVQfHs7gISLeVWCw==", license: "MIT", evidence: "fastxyz/fast-sdk LICENSE and packages/fast-sdk/package.json", disposition: "approved" },
  { name: "@fastxyz/schema", version: "2.0.0", registryUrl: npmRegistryUrl, integrity: "sha512-aMMMoZJtJVQJCn+ER5Ec/Pdj5meSmqwbNjEHpwJy32PgiwJPoyDcXOCV7SU8igDUK5dDVEWQIm9WpJabtcN9PA==", license: "MIT", evidence: "fastxyz/fast-sdk LICENSE; fast-schema package is covered by the repository license", disposition: "approved" },
  { name: "@hpke/common", version: "1.10.1", registryUrl: npmRegistryUrl, integrity: "sha512-moJwhmtLtuxiUzzNp1jpfBfx8yefKoO9D/RCR9dmwrnc7qjJqId1rEtQz+lSlU5cabX8daToMSx/7HayXOiaFw==", license: "MIT", evidence: "published package.json license field and bundled LICENSE", disposition: "approved" },
  { name: "@hpke/core", version: "1.9.0", registryUrl: npmRegistryUrl, integrity: "sha512-pFxWl1nNJeQCSUFs7+GAblHvXBCjn9EPN65vdKlYQil2aURaRxfGMO6vBKGqm1YHTKwiAxJQNEI70PbSowMP9Q==", license: "MIT", evidence: "published package.json license field and bundled LICENSE", disposition: "approved" },
  { name: "@mysten/bcs", version: "2.0.3", registryUrl: npmRegistryUrl, integrity: "sha512-dwcaL4HNAsEGpU3hKUAsXgCZp9l6++e2A3THpzoYZ8e7bsy4XH1V0dXD5dIzgNcVZiZfb6ZnDMG+gdF6+1WOQA==", license: "Apache-2.0", evidence: "published package.json license field", disposition: "approved" },
  { name: "@mysten/utils", version: "0.3.1", registryUrl: npmRegistryUrl, integrity: "sha512-36KhxG284uhDdSnlkyNaS6fzKTX9FpP2WQWOwUKIRsqQFFIm2ooCf2TP1IuqrtMpkairwpiWkAS0eg7cpemVzg==", license: "Apache-2.0", evidence: "published package.json license field", disposition: "approved" },
  { name: "@noble/ed25519", version: "2.3.0", registryUrl: npmRegistryUrl, integrity: "sha512-M7dvXL2B92/M7dw9+gzuydL8qn/jiqNHaoR3Q+cb1q1GHV7uwE17WCyFMG+Y+TZb5izcaXk5TdJRrDUxHXL78A==", license: "MIT", evidence: "published package.json license field and bundled LICENSE", disposition: "approved" },
  { name: "@noble/ed25519", version: "3.0.1", registryUrl: npmRegistryUrl, integrity: "sha512-t/T8LuK0ym8ALQudCCQCtrRdMSxBnRgHXw+wg+YsSlE6d+on7sX3flqlSJ2mOs9xEuchM36kj9SuX5MG7pXQMA==", license: "MIT", evidence: "published package.json license field and bundled LICENSE", disposition: "approved" },
  { name: "@noble/hashes", version: "1.8.0", registryUrl: npmRegistryUrl, integrity: "sha512-jCs9ldd7NwzpgXDIf6P3+NrHh9/sD6CQdxHyjQI+h/6rDNo88ypBxxz45UDuZHz9r3tNz7N/VInSVoVdtXEI4A==", license: "MIT", evidence: "published package.json license field and bundled LICENSE", disposition: "approved" },
  { name: "@noble/hashes", version: "2.0.1", registryUrl: npmRegistryUrl, integrity: "sha512-XlOlEbQcE9fmuXxrVTXCTlG2nlRXa9Rj3rr5Ue/+tX+nmkgbX720YHh0VR3hBF9xDvwnb8D2shVGOwNx+ulArw==", license: "MIT", evidence: "published package.json license field and bundled LICENSE", disposition: "approved" },
  { name: "@scure/base", version: "2.0.0", registryUrl: npmRegistryUrl, integrity: "sha512-3E1kpuZginKkek01ovG8krQ0Z44E3DHPjc5S2rjJw9lZn3KSQOs8S7wqikF/AH7iRanHypj85uGyxk0XAyC37w==", license: "MIT", evidence: "published package.json license field and bundled LICENSE", disposition: "approved" },
  { name: "@standard-schema/spec", version: "1.1.0", registryUrl: npmRegistryUrl, integrity: "sha512-l2aFy5jALhniG5HgqrD6jXLi/rUWrKvqN/qJx6yoJsgKhblVd+iqqU4RCXavm/jPityDo5TCvKMnpjKnOriy0w==", license: "MIT", evidence: "published package.json license field and bundled LICENSE", disposition: "approved" },
  { name: "bech32", version: "2.0.0", registryUrl: npmRegistryUrl, integrity: "sha512-LcknSilhIGatDAsY1ak2I8VtGaHNhgMSYVxFrGLXv+xLHytaKZKcaUJJUE7qmBr7h33o5YQwP55pMI0xmkpJwg==", license: "MIT", evidence: "published package.json license field and bundled LICENSE", disposition: "approved" },
  { name: "effect", version: "3.21.4", registryUrl: npmRegistryUrl, integrity: "sha512-B89v/xSgPbl1J2Ai2u18jxq3odpFauU1rC6/eSs4FeNHi72kwKdJp12VGigvRV2lK+kRnx+OOz41XV8guZd4gQ==", license: "MIT", evidence: "published package.json license field and bundled LICENSE", disposition: "approved" },
  { name: "fast-check", version: "3.23.2", registryUrl: npmRegistryUrl, integrity: "sha512-h5+1OzzfCC3Ef7VbtKdcv7zsstUQwUDlYpUTvjeUsJAssPgLn7QzbboPtL5ro04Mq0rPOsMzl7q5hIbRs2wD1A==", license: "MIT", evidence: "published package.json license field and bundled LICENSE", disposition: "approved" },
  { name: "json-with-bigint", version: "3.5.8", registryUrl: npmRegistryUrl, integrity: "sha512-eq/4KP6K34kwa7TcFdtvnftvHCD9KvHOGGICWwMFc4dOOKF5t4iYqnfLK8otCRCRv06FXOzGGyqE8h8ElMvvdw==", license: "MIT", evidence: "published package.json license field and bundled LICENSE", disposition: "approved" },
  { name: "pure-rand", version: "6.1.0", registryUrl: npmRegistryUrl, integrity: "sha512-bVWawvoZoBYpp6yIoQtQXHZjmz35RSVHnUOTefl8Vcjr8snTPY1wnpSPMWekcFwbxI6gtmT7rSYPFvz71ldiOA==", license: "MIT", evidence: "published package.json license field and bundled LICENSE", disposition: "approved" },
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
    seen.set(key, { name: manifest.name, version: manifest.version, path: manifestPath, declaredLicense: manifest.license ?? null });
    const packageDirectory = dirname(manifestPath);
    for (const dependency of dependencyNames(manifest)) queue.push({ name: dependency, from: packageDirectory });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

function parseLockCoordinate(key) {
  const separator = key.lastIndexOf("@");
  if (separator <= 0) return null;
  return { name: key.slice(0, separator), version: key.slice(separator + 1).split("(")[0] };
}

function repositoryRoot(packageRoot) {
  return resolve(packageRoot, "../..");
}

function configuredRegistryUrl(packageRoot) {
  const repoRoot = repositoryRoot(packageRoot);
  const npmrc = readFileSync(resolve(repoRoot, ".npmrc"), "utf8");
  const configured = npmrc.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.startsWith("registry="))
    .map((line) => line.slice("registry=".length));
  if (configured.length !== 1 || configured[0] !== npmRegistryUrl) {
    throw new Error(`dependency registry must be pinned to ${npmRegistryUrl} in .npmrc`);
  }
  const override = process.env.npm_config_registry ?? process.env.NPM_CONFIG_REGISTRY;
  if (override !== undefined && new URL(override).href !== npmRegistryUrl) {
    throw new Error("runtime registry override differs from the reviewed .npmrc registry");
  }
  return npmRegistryUrl;
}

function lockfileResolutions(packageRoot, dependencies) {
  const repoRoot = repositoryRoot(packageRoot);
  const lockfile = parseYaml(readFileSync(resolve(repoRoot, "pnpm-lock.yaml"), "utf8"));
  if (lockfile.lockfileVersion !== "9.0" || !lockfile.packages || !lockfile.importers) {
    throw new Error("unsupported pnpm lockfile format for dependency provenance");
  }
  const registryUrl = configuredRegistryUrl(packageRoot);
  const importerPath = resolve(packageRoot).slice(repoRoot.length + 1).replaceAll("\\", "/");
  const importer = lockfile.importers[importerPath];
  if (!importer) throw new Error(`pnpm lockfile is missing importer ${importerPath}`);
  const manifest = readManifest(resolve(packageRoot, "package.json"));
  for (const name of dependencyNames(manifest)) {
    const expectedSpecifier = manifest.dependencies?.[name] ?? manifest.optionalDependencies?.[name] ?? manifest.peerDependencies?.[name];
    const locked = importer.dependencies?.[name] ?? importer.optionalDependencies?.[name] ?? importer.peerDependencies?.[name];
    if (!locked || locked.specifier !== expectedSpecifier) {
      throw new Error(`production dependency ${name} does not match its exact lockfile importer entry`);
    }
  }

  const resolutions = new Map();
  for (const dependency of dependencies) {
    const candidates = Object.entries(lockfile.packages)
      .filter(([key]) => {
        const coordinate = parseLockCoordinate(key);
        return coordinate?.name === dependency.name && coordinate.version === dependency.version;
      })
      .map(([key, pkg]) => {
        const resolution = pkg.resolution;
        if (!resolution || typeof resolution.integrity !== "string" || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(resolution.integrity)) {
          throw new Error(`dependency ${dependency.name}@${dependency.version} lacks a SHA-512 lockfile integrity`);
        }
        if (resolution.directory || resolution.repo || resolution.commit || resolution.type === "git") {
          throw new Error(`dependency ${dependency.name}@${dependency.version} uses an unreviewed non-registry source`);
        }
        const sourceUrl = resolution.tarball ?? registryUrl;
        let url;
        try { url = new URL(sourceUrl); } catch { throw new Error(`dependency ${dependency.name}@${dependency.version} has an invalid lockfile source URL`); }
        const registryOrigin = new URL(registryUrl).origin;
        if (url.protocol !== "https:" || url.origin !== registryOrigin || url.username || url.password) {
          throw new Error(`dependency ${dependency.name}@${dependency.version} uses a non-registry source URL; expected origin ${registryOrigin}`);
        }
        return { key, registryUrl, integrity: resolution.integrity };
      });
    if (candidates.length === 0) throw new Error(`dependency ${dependency.name}@${dependency.version} is absent from the pnpm lockfile`);
    const signatures = new Set(candidates.map(({ registryUrl: source, integrity }) => `${source}\n${integrity}`));
    if (signatures.size !== 1) throw new Error(`dependency ${dependency.name}@${dependency.version} has ambiguous lockfile resolutions`);
    resolutions.set(`${dependency.name}@${dependency.version}`, candidates[0]);
  }
  return resolutions;
}

export function assertLicenseProvenance(records = reviewedDependencies, packageRoot = root) {
  for (const record of records) {
    if (!record.license || !record.evidence) throw new Error(`missing reviewed license provenance for ${record.name}`);
    if (record.disposition !== "approved") throw new Error(`dependency ${record.name}@${record.version} lacks an approved disposition`);
    if (!record.registryUrl || !record.integrity) throw new Error(`dependency ${record.name}@${record.version} lacks lockfile source/integrity provenance`);
  }
  const dependencies = collectProductionDependencies(packageRoot);
  const resolutions = lockfileResolutions(packageRoot, dependencies);
  const expected = dependencies.map((dependency) => {
    const resolution = resolutions.get(`${dependency.name}@${dependency.version}`);
    return [dependency.name, dependency.version, resolution.registryUrl, resolution.integrity];
  });
  const sortCoordinates = (left, right) => left[0].localeCompare(right[0]) || left[1].localeCompare(right[1]);
  expected.sort(sortCoordinates);
  const actual = records.map(({ name, version, registryUrl, integrity }) => [name, version, registryUrl, integrity]).sort(sortCoordinates);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("dependency license/source/integrity inventory does not match the lockfile resolution");
  }
  const reviewedByCoordinate = new Map(records.map((record) => [`${record.name}@${record.version}`, record]));
  for (const dependency of dependencies) {
    if (dependency.declaredLicense !== null && reviewedByCoordinate.get(`${dependency.name}@${dependency.version}`).license !== dependency.declaredLicense) {
      throw new Error(`dependency ${dependency.name}@${dependency.version} license differs from installed package metadata`);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assertLicenseProvenance();
}
