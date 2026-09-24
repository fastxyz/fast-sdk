// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { assertPackageContent, assertPackageInventory, expectedPackageInventory } from "./package-artifact.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(root, "../..");
const TEXT_MEMBER = /\.(?:js|d\.ts|json|mjs|cjs)$/;
const scratch = mkdtempSync(join(tmpdir(), "sign-sdk-consumer-"));
try {
  execFileSync("pnpm", ["pack", "--pack-destination", scratch], { cwd: root, stdio: "inherit" });
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const tarball = join(scratch, `fastxyz-sign-sdk-${manifest.version}.tgz`);
  assertPackageInventory(execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" }).trim().split("\n"));
  const extracted = join(scratch, "extracted");
  mkdirSync(extracted);
  execFileSync("tar", ["-xzf", tarball, "-C", extracted], { stdio: "inherit" });
  assertPackageContent(expectedPackageInventory
    .filter((path) => TEXT_MEMBER.test(path))
    .map((path) => ({ path, content: readFileSync(join(extracted, path), "utf8") })));
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
  writeFileSync(join(scratch, "consumer.ts"), `
import {
  createFastSdkProviderAdapter,
  createRecordClient,
  createSignClient,
  recoverSettlement,
  registerReceipt,
  verifyReceipt,
} from "@fastxyz/sign-sdk";
import type { JournalSnapshot, RecoveryJournal, SignNetwork } from "@fastxyz/sign-sdk";

const network: SignNetwork = "fast:testnet";
const journal: RecoveryJournal = {
  async load(_operationId: string): Promise<JournalSnapshot | null> { return null; },
  async save(_snapshot: JournalSnapshot): Promise<void> {},
  async withLock<T>(_key: string, operation: () => Promise<T>): Promise<T> { return operation(); },
};
const client = createRecordClient({ network, indexOrigin: "https://index.example", journal });
void [client, createFastSdkProviderAdapter, createSignClient, recoverSettlement, registerReceipt, verifyReceipt];
`);
  writeFileSync(join(scratch, "forbidden.ts"), `
// These imports are intentionally forbidden by the public package boundary.
// @ts-expect-error generic claim-data preparation is not public
import { prepareExternalClaimTransaction } from "@fastxyz/sign-sdk";
// @ts-expect-error raw claimDataHex encoding is not public
import { encodeClaimData } from "@fastxyz/sign-sdk";
// @ts-expect-error arbitrary operation arrays are not public
import { submitOperations } from "@fastxyz/sign-sdk";
// @ts-expect-error internal transaction helpers are not a published subpath
import { prepareExternalClaimTransaction as deepPrepare } from "@fastxyz/sign-sdk/internal/transactions";
import type { SignInput } from "@fastxyz/sign-sdk";
import { createSignClient } from "@fastxyz/sign-sdk";

const signClient = null as unknown as Pick<ReturnType<typeof createSignClient>, "signDigest">;
// @ts-expect-error a generic claim-data object is not a valid sign input
void signClient.signDigest({ claimDataHex: "00" });
// @ts-expect-error raw claimDataHex cannot be added to the signed input
void signClient.signDigest({ operationId: "op", sha256: "11".repeat(32), relationship: "authored", claimDataHex: "00" });
// @ts-expect-error arbitrary operation arrays are not accepted by SignInput
const arbitraryOperations: SignInput = { operationId: "op", sha256: "11".repeat(32), relationship: "authored", operations: [] };

void [prepareExternalClaimTransaction, encodeClaimData, submitOperations, deepPrepare, arbitraryOperations];
`);
  writeFileSync(join(scratch, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      noEmit: true,
    },
    include: ["consumer.ts", "forbidden.ts"],
  }));
  execFileSync(resolve(repoRoot, "node_modules/.bin/tsc"), ["--project", join(scratch, "tsconfig.json")], {
    cwd: scratch,
    stdio: "inherit",
  });
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
