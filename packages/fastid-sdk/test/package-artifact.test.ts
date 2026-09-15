import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertPackageInventory,
  cleanBuildOutput,
} from "../scripts/package-artifact.mjs";

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
] as const;

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

describe("packed artifact", () => {
  it("removes the complete previous build output", () => {
    const packageRoot = mkdtempSync(join(tmpdir(), "fast-id-sdk-clean-"));
    const staleFile = join(packageRoot, "dist", "removed-secret.txt");
    try {
      mkdirSync(join(packageRoot, "dist"), { recursive: true });
      writeFileSync(staleFile, "must never be packaged\n");
      cleanBuildOutput(packageRoot);
      expect(existsSync(join(packageRoot, "dist"))).toBe(false);
    } finally {
      rmSync(packageRoot, { recursive: true, force: true });
    }
  });

  it("accepts only the exact supported tarball inventory", () => {
    expect(() => assertPackageInventory(expectedInventory)).not.toThrow();
    expect(() =>
      assertPackageInventory([...expectedInventory, "package/dist/removed-secret.txt"]),
    ).toThrow(/unexpected: package\/dist\/removed-secret\.txt/);
    expect(() => assertPackageInventory(expectedInventory.filter((entry) => entry !== "package/dist/address.d.ts"))).toThrow(
      /missing: package\/dist\/address\.d\.ts/,
    );
    expect(() =>
      assertPackageInventory([...expectedInventory, "package/dist/address.d.ts"]),
    ).toThrow(/duplicate: package\/dist\/address\.d\.ts/);
  });
});
