// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

import { rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const modules = [
  "errors", "file-hash", "file-journal", "index", "record-client", "recovery", "sign-client", "types",
  "internal/address", "internal/attestation", "internal/bytes", "internal/canonical", "internal/fast-id",
  "internal/fees", "internal/index-http", "internal/metadata", "internal/receipts",
  "internal/record-wire", "internal/transactions",
];

export const expectedPackageInventory = [
  "package/LICENSE",
  "package/README.md",
  "package/THIRD_PARTY_NOTICES.md",
  "package/package.json",
  ...modules.flatMap((module) => [`package/dist/${module}.d.ts`, `package/dist/${module}.js`]),
].sort();

export function cleanBuildOutput(root = packageRoot) {
  rmSync(resolve(root, "dist"), { recursive: true, force: true });
}

export function assertPackageInventory(entries) {
  const actual = [...entries].filter(Boolean).sort();
  const expected = new Set(expectedPackageInventory);
  const received = new Set(actual);
  const missing = expectedPackageInventory.filter((entry) => !received.has(entry));
  const unexpected = actual.filter((entry) => !expected.has(entry));
  const duplicates = actual.filter((entry, index) => index > 0 && entry === actual[index - 1]);
  if (missing.length || unexpected.length || duplicates.length) {
    throw new Error([
      missing.length ? `missing: ${missing.join(", ")}` : "",
      unexpected.length ? `unexpected: ${unexpected.join(", ")}` : "",
      duplicates.length ? `duplicate: ${duplicates.join(", ")}` : "",
    ].filter(Boolean).join("; "));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cleanBuildOutput();
}
