// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { FileChangedDuringHashError, hashFile } from "../src/file-hash.js";

const statSchedule = vi.hoisted(() => ({
  path: "",
  pathStats: 0,
  closed: 0,
  onFinalHandleStat: null as (() => void) | null,
  beforeFinalPathStat: null as (() => Promise<void>) | null,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...fs,
    async lstat(...args: Parameters<typeof fs.lstat>) {
      if (args[0] === statSchedule.path && ++statSchedule.pathStats === 2) {
        await statSchedule.beforeFinalPathStat?.();
      }
      return fs.lstat(...args);
    },
    async open(...args: Parameters<typeof fs.open>) {
      const handle = await fs.open(...args);
      if (args[0] !== statSchedule.path) return handle;
      let stats = 0;
      return {
        read: handle.read.bind(handle),
        async stat(...statArgs: Parameters<typeof handle.stat>) {
          const value = await handle.stat(...statArgs);
          if (++stats === 2) statSchedule.onFinalHandleStat?.();
          return value;
        },
        async close() { statSchedule.closed += 1; await handle.close(); },
      };
    },
  };
});

const roots: string[] = [];
afterEach(async () => {
  statSchedule.path = "";
  statSchedule.pathStats = 0;
  statSchedule.closed = 0;
  statSchedule.onFinalHandleStat = null;
  statSchedule.beforeFinalPathStat = null;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "sign-sdk-hash-"));
  roots.push(value);
  return value;
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

it("hashes empty and non-UTF-8 files as their exact local bytes", async () => {
  const directory = await root();
  const empty = join(directory, "empty.bin");
  const binary = join(directory, "binary.bin");
  const bytes = Uint8Array.from([0xff, 0x00, 0xc3, 0x28, 0x80]);
  await writeFile(empty, new Uint8Array());
  await writeFile(binary, bytes);

  await expect(hashFile(empty)).resolves.toBe(digest(new Uint8Array()));
  await expect(hashFile(binary)).resolves.toBe(digest(bytes));
});

it("streams a large file in bounded chunks and reports only byte counts", async () => {
  const directory = await root();
  const path = join(directory, "large.bin");
  const bytes = new Uint8Array(5 * 1024 * 1024 + 17).fill(0xa5);
  await writeFile(path, bytes);
  const progress = vi.fn();

  await expect(hashFile(path, { chunkSize: 64 * 1024, onProgress: progress })).resolves.toBe(digest(bytes));
  expect(progress.mock.calls.length).toBeGreaterThan(2);
  expect(progress.mock.calls.every(([value]) => typeof value === "number")).toBe(true);
});

it("closes the file on read errors and abort", async () => {
  const directory = await root();
  const child = join(directory, "directory-not-file");
  await mkdir(child);
  await expect(hashFile(child)).rejects.toThrow(/regular file/i);
  await expect(rm(child, { recursive: true })).resolves.toBeUndefined();

  const path = join(directory, "abort.bin");
  await writeFile(path, new Uint8Array(1024 * 1024).fill(1));
  const controller = new AbortController();
  await expect(hashFile(path, {
    signal: controller.signal,
    chunkSize: 4096,
    onProgress() { controller.abort("fixture stop"); },
  })).rejects.toMatchObject({ name: "AbortError" });
  await expect(rm(path)).resolves.toBeUndefined();
});

it("rejects a file mutated during reading instead of blessing unstable bytes", async () => {
  const directory = await root();
  const path = join(directory, "mutable.bin");
  await writeFile(path, new Uint8Array(1024 * 1024).fill(2));
  let changed = false;

  await expect(hashFile(path, {
    chunkSize: 4096,
    async onProgress() {
      if (changed) return;
      changed = true;
      await writeFile(path, new Uint8Array(1024 * 1024).fill(3));
    },
  })).rejects.toBeInstanceOf(FileChangedDuringHashError);
});

it("rejects mutation observed only by the final path stat and closes its handle", async () => {
  const path = join(await root(), "final-stat-race.bin");
  await writeFile(path, new Uint8Array([1, 2]));
  let finalHandleStatComplete = false;
  statSchedule.path = path;
  statSchedule.onFinalHandleStat = () => { finalHandleStatComplete = true; };
  statSchedule.beforeFinalPathStat = async () => {
    if (!finalHandleStatComplete) throw new Error("final path stat started before final handle stat completed");
    // Real write after the final handle snapshot, before the real path stat.
    await writeFile(path, new Uint8Array([3, 4, 5]));
  };
  await expect(hashFile(path)).rejects.toBeInstanceOf(FileChangedDuringHashError);
  expect(statSchedule.closed).toBe(1);
});

it("rejects when cancellation arrives during the final stats", async () => {
  const path = join(await root(), "abort-final-stats.bin");
  await writeFile(path, new Uint8Array([1, 2, 3]));
  const controller = new AbortController();
  statSchedule.path = path;
  statSchedule.onFinalHandleStat = () => controller.abort("cancelled during final stats");

  await expect(hashFile(path, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  expect(statSchedule.closed).toBe(1);
});
