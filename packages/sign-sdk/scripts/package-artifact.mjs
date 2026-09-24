// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

import { rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const modules = [
  "errors", "file-hash", "file-journal", "index", "record-client", "recovery", "sign-client", "types",
  "internal/address", "internal/attestation", "internal/bytes", "internal/canonical", "internal/fast-id",
  "internal/fees", "internal/index-http", "internal/journal-snapshot", "internal/metadata", "internal/receipts",
  "internal/record-wire", "internal/transactions",
];

export const expectedPackageInventory = [
  "package/LICENSE",
  "package/README.md",
  "package/THIRD_PARTY_NOTICES.md",
  "package/package.json",
  ...modules.flatMap((module) => [`package/dist/${module}.d.ts`, `package/dist/${module}.js`]),
].sort();

const TEXT_MEMBER = /\.(?:js|d\.ts|json|mjs|cjs)$/;
const PRIVATE_SOURCE_PATH = /fastset-sign-core\/src\//i;
const ABSOLUTE_LOCAL_PATH = /(?:^|["'`\s])(?:\/private\/|\/tmp\/|\/home\/|\/Users\/|[A-Za-z]:[\\/])/;
const SECRET_LIKE_VALUE = /(?:-----BEGIN [A-Z ]+PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._-]{20,}\b|\b(?:npm|github)_[A-Za-z0-9]{20,}\b)/;

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

/** Reject private source locations and credential-shaped material in code/metadata members. */
export function assertPackageContent(files) {
  for (const file of files) {
    if (!TEXT_MEMBER.test(file.path)) continue;
    if (PRIVATE_SOURCE_PATH.test(file.content) || ABSOLUTE_LOCAL_PATH.test(file.content) || SECRET_LIKE_VALUE.test(file.content)) {
      throw new Error(`forbidden tarball content in ${file.path}`);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cleanBuildOutput();
}
