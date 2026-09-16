import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertPackageInventory } from "./package-artifact.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "fastid-sdk-consumer-"));
try {
  execFileSync("pnpm", ["pack", "--pack-destination", scratch], {
    cwd: root,
    stdio: "inherit",
  });
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const tarball = join(scratch, `fastxyz-fastid-sdk-${manifest.version}.tgz`);
  const inventory = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" });
  assertPackageInventory(inventory.trim().split("\n"));
  writeFileSync(join(scratch, "package.json"), JSON.stringify({
    name: "fastid-sdk-consumer-smoke", private: true, type: "module",
  }));
  execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], {
    cwd: scratch,
    stdio: "inherit",
  });
  writeFileSync(join(scratch, "smoke.mjs"), `
import { IdClient, KeySigner, claimDataHex, encodeClaimDataV2 } from "@fastxyz/fastid-sdk";
const signer = await KeySigner.fromPrivateKey("01".repeat(32));
const client = new IdClient({ network: "fast:testnet", signer });
if (client.share.profileUrl("agent.sdk") !== "https://testnet.id.fast.xyz/agent.sdk") {
  throw new Error("packed client uses the wrong network URL");
}
const expected = "7b0a202022736368656d61223a20226661737469642f636c61696d2f7632222c0a2020226b696e64223a20226e616d65222c0a20202276616c7565223a20226167656e742e73646b220a7d";
if (claimDataHex(encodeClaimDataV2("name", "agent.sdk")) !== expected) {
  throw new Error("packed claim-data encoder drifted");
}
`);
  execFileSync(process.execPath, [join(scratch, "smoke.mjs")], {
    cwd: scratch,
    stdio: "inherit",
  });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
