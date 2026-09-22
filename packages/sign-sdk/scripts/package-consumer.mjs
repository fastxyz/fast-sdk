// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { assertPackageInventory } from "./package-artifact.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "sign-sdk-consumer-"));
try {
  execFileSync("pnpm", ["pack", "--pack-destination", scratch], { cwd: root, stdio: "inherit" });
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const tarball = join(scratch, `fastxyz-sign-sdk-${manifest.version}.tgz`);
  assertPackageInventory(execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" }).trim().split("\n"));
  writeFileSync(join(scratch, "package.json"), JSON.stringify({ name: "sign-sdk-consumer", private: true, type: "module" }));
  execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], {
    cwd: scratch,
    stdio: "inherit",
    env: { ...process.env, npm_config_cache: join(scratch, "npm-cache") },
  });
  writeFileSync(join(scratch, "smoke.mjs"), `
import * as sdk from "@fastxyz/sign-sdk";
const expected = ${JSON.stringify([
  "FeePolicyError", "FileChangedDuringHashError", "InsufficientFundsError", "InvalidSignerSignatureError",
  "NonceConflictError", "SignerMismatchError", "createFastSdkProviderAdapter", "createFileJournal",
  "createRecordClient", "createSignClient", "hashFile", "recoverSettlement", "registerReceipt", "verifyReceipt",
])};
if (JSON.stringify(Object.keys(sdk).sort()) !== JSON.stringify(expected.sort())) throw new Error("public export set drifted");
`);
  execFileSync(process.execPath, [join(scratch, "smoke.mjs")], { cwd: scratch, stdio: "inherit" });
  for (const subpath of ["core", "browser", "node", "internal"]) {
    try {
      execFileSync(process.execPath, ["--input-type=module", "--eval", `import('@fastxyz/sign-sdk/${subpath}')`], { cwd: scratch, stdio: "pipe" });
      throw new Error(`deep import unexpectedly resolved: ${subpath}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("deep import unexpectedly")) throw error;
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
