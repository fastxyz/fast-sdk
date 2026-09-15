import { readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const modules = [
  "address",
  "canonical-json",
  "claim-data",
  "claim-fee",
  "claim-preflight",
  "claim-tx",
  "claims",
  "client",
  "errors",
  "fasttx",
  "http",
  "index",
  "name",
  "networks",
  "profile-message",
  "profile",
  "proofs",
  "reads",
  "report-wire",
  "report",
  "share",
  "signer",
  "verify",
];

const expectedInventory = [
  "package/LICENSE",
  "package/README.md",
  "package/package.json",
  ...modules.flatMap((module) => [
    `package/dist/${module}.d.ts`,
    `package/dist/${module}.d.ts.map`,
    `package/dist/${module}.js`,
    `package/dist/${module}.js.map`,
  ]),
].sort();

export function cleanBuildOutput(root = packageRoot) {
  rmSync(resolve(root, "dist"), { recursive: true, force: true });
}

export function assertPackageInventory(entries) {
  const actual = [...entries].filter(Boolean).sort();
  const expected = new Set(expectedInventory);
  const received = new Set(actual);
  const missing = expectedInventory.filter((entry) => !received.has(entry));
  const unexpected = actual.filter((entry) => !expected.has(entry));
  const duplicate = actual.filter(
    (entry, index) => index > 0 && entry === actual[index - 1],
  );
  if (missing.length === 0 && unexpected.length === 0 && duplicate.length === 0) {
    return;
  }
  throw new Error(
    [
      missing.length > 0 ? `missing: ${missing.join(", ")}` : "",
      unexpected.length > 0 ? `unexpected: ${unexpected.join(", ")}` : "",
      duplicate.length > 0 ? `duplicate: ${duplicate.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("; "),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, inventoryPath] = process.argv.slice(2);
  if (command === "clean") {
    cleanBuildOutput();
  } else if (command === "verify" && inventoryPath) {
    assertPackageInventory(readFileSync(inventoryPath, "utf8").trim().split("\n"));
  } else {
    throw new Error("usage: package-artifact.mjs clean | verify <inventory-file>");
  }
}
