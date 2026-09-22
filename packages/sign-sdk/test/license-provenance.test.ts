// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

interface SourceRecord {
  destination: string;
  classification: "new" | "copied" | "derived";
  origin: {
    repository: string;
    commit: string | null;
    path: string | null;
    blob: string | null;
  };
  copyright: string;
  license: string;
  disposition: "approved";
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function filesUnder(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path).flatMap((entry) => {
    const full = join(path, entry);
    return statSync(full).isDirectory() ? filesUnder(full) : [relative(root, full)];
  });
}

describe("public source provenance", () => {
  test("classifies every distributed first-party source", () => {
    const records = JSON.parse(
      readFileSync(join(root, "provenance/source-files.json"), "utf8"),
    ) as SourceRecord[];
    const destinations = records.map((record) => record.destination);

    expect(new Set(destinations).size).toBe(destinations.length);
    expect(destinations).toContain("src/index.ts");
    expect(destinations).toContain("README.md");
    expect(destinations).toContain("LICENSE");
    expect(destinations).toContain("THIRD_PARTY_NOTICES.md");
    expect(filesUnder(join(root, "src")).sort()).toEqual(
      destinations.filter((path) => path.startsWith("src/")).sort(),
    );

    for (const record of records) {
      expect(record.copyright).not.toBe("");
      expect(record.license).toBe("Apache-2.0");
      expect(record.disposition).toBe("approved");
      if (record.classification !== "new") {
        expect(record.origin.commit).toMatch(/^[0-9a-f]{40}$/);
        expect(record.origin.path).not.toBeNull();
        expect(record.origin.blob).toMatch(/^[0-9a-f]{40}$/);
      }
    }
  });
});
