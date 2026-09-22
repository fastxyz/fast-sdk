// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("public package boundary", () => {
  test("uses the approved public identity and one root entrypoint", () => {
    const path = join(root, "package.json");
    expect(existsSync(path)).toBe(true);
    const manifest = JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;

    expect(manifest.name).toBe("@fastxyz/sign-sdk");
    expect(manifest.version).toBe("0.0.0");
    expect(manifest.license).toBe("Apache-2.0");
    expect(manifest.engines).toEqual({ node: ">=20.19.0" });
    expect(Object.keys(manifest.exports)).toEqual(["."]);
    expect(manifest.dependencies["@fastxyz/sdk"]).toBe("2.3.1");
    expect(manifest.dependencies["@fastxyz/schema"]).toBe("2.0.0");
    expect(JSON.stringify(manifest)).not.toMatch(/workspace:|file:|github:/);
    expect(manifest.bin).toBeUndefined();
    expect(manifest.scripts?.postinstall).toBeUndefined();
  });
});
