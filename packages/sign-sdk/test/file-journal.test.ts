// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MAX_JOURNAL_SNAPSHOT_BYTES,
  createFileJournal,
} from "../src/file-journal.js";
import type { JournalSnapshot } from "../src/types.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(prefix = "sign-sdk-journal-"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function prepared(operationId: string, nonce = "7"): JournalSnapshot {
  return {
    version: 1,
    state: "prepared",
    operationId,
    updatedAt: 1,
    operation: {
      input: {
        operationId,
        sha256: "11".repeat(32),
        relationship: "authored",
        listBySigner: false,
      },
      network: "fast:testnet",
      proxyUrl: "https://proxy.example",
      indexOrigin: "https://index.example",
      senderHex: "22".repeat(32),
      nonce,
      requestIdHex: "33".repeat(16),
      issuedAtNanoseconds: "18446744073709551615",
      fee: {
        tokenId: null,
        amountAtomic: "0",
        scheduleFingerprint: "fixture-fee-v1",
      },
    },
  };
}

async function mode(path: string): Promise<number> {
  return (await lstat(path)).mode & 0o777;
}

it.each(["directory-sync", "owner-unlink"] as const)("cleans its own published lock after %s setup failure before callback", async (failure) => {
  const parent = await temporaryRoot("sign-sdk-lock-setup-");
  const runtime = await childRuntime(parent, undefined, failure);
  const module = await import(new URL(`file://${runtime}`).href);
  const directory = join(parent, "state");
  const journal = module.createFileJournal({ directory, lockTimeoutMs: 50 });
  let callbacks = 0;
  await expect(journal.withLock("operation:setup-fault", async () => { callbacks += 1; }))
    .rejects.toThrow("injected post-link setup failure");
  expect(callbacks).toBe(0);
  expect((await readdir(join(directory, "locks"))).filter((name) => name.endsWith(".lock"))).toEqual([]);
  await journal.withLock("operation:setup-fault", async () => { callbacks += 1; });
  expect(callbacks).toBe(1);
});

function snapshotName(operationId: string): string {
  return `${createHash("sha256").update(operationId, "utf8").digest("hex")}.json`;
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await lstat(path);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw new Error(`timed out waiting for ${path}`);
}

async function childRuntime(root: string, publicationBarrier?: { ready: string; release: string }, setupFailure?: "directory-sync" | "owner-unlink"): Promise<string> {
  let source = await readFile(new URL("../src/file-journal.ts", import.meta.url), "utf8");
  if (setupFailure) {
    // Inject a one-shot setup fault at the real publication boundary; retain
    // actual file writes, hard-link publication, owner checks and unlink I/O.
    const boundary = setupFailure === "directory-sync"
      ? "await syncDirectory(this.#locks);" : "await unlink(ownerPath);";
    expect(source).toContain(boundary);
    source = "let injectedSetupFailure = true;\n" + source.replace(boundary,
      `if (injectedSetupFailure) { injectedSetupFailure = false; throw Object.assign(new Error("injected post-link setup failure"), { code: "EIO" }); } ${boundary}`);
  }
  if (publicationBarrier) {
    // Schedule the real owner write; no journal/lock outcome is stubbed.
    const write = "await handle.writeFile(JSON.stringify(owner));";
    expect(source.split(write)).toHaveLength(2);
    source = source.replace(write, `
      const barrierFs = await import("node:fs/promises");
      await barrierFs.writeFile(${JSON.stringify(publicationBarrier.ready)}, "ready");
      while (true) {
        try { await barrierFs.lstat(${JSON.stringify(publicationBarrier.release)}); break; }
        catch (error) { if (error.code !== "ENOENT") throw error; }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      ${write}`);
  }
  const compiled = await build({
    stdin: { contents: source, loader: "ts", resolveDir: dirname(fileURLToPath(new URL("../src/file-journal.ts", import.meta.url))) },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    target: "node22",
    banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
  });
  const runtime = compiled.outputFiles[0]!.text;
  const modulePath = join(root, "file-journal.mjs");
  await writeFile(modulePath, runtime, { mode: 0o600 });
  return modulePath;
}

async function childScript(root: string, runtimePath: string): Promise<string> {
  const path = join(root, "journal-child.mjs");
  await writeFile(
    path,
    `import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createFileJournal } from ${JSON.stringify(new URL(`file://${runtimePath}`).href)};
const [mode, directory, operationId, counterPath, readyPath] = process.argv.slice(2);
const journal = createFileJournal({ directory, lockTimeoutMs: 5_000, lockPollMs: 10 });
const snapshot = {
  version: 1, state: "prepared", operationId, updatedAt: 1,
  operation: {
    input: { operationId, sha256: "${"11".repeat(32)}", relationship: "authored", listBySigner: false },
    network: "fast:testnet", proxyUrl: "https://proxy.example", indexOrigin: "https://index.example",
    senderHex: "${"22".repeat(32)}", nonce: "7", requestIdHex: "${"33".repeat(16)}",
    issuedAtNanoseconds: "18446744073709551615",
    fee: { tokenId: null, amountAtomic: "0", scheduleFingerprint: "fixture-fee-v1" }
  }
};
if (mode === "once") {
  await journal.withLock("operation:" + operationId, async () => {
    if (await journal.load(operationId)) return;
    let count = 0;
    try { count = Number(await readFile(counterPath, "utf8")); } catch {}
    await writeFile(counterPath, String(count + 1));
    await new Promise((resolve) => setTimeout(resolve, 75));
    await journal.save(snapshot);
  });
} else if (mode === "prepare") {
  await journal.withLock("account:fast:testnet:${"22".repeat(32)}", async () => {
    let nextNonce = 0;
    try { nextNonce = Number(await readFile(counterPath, "utf8")); } catch {}
    await writeFile(counterPath, String(nextNonce + 1));
    snapshot.operation.nonce = String(nextNonce);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await journal.save(snapshot);
  });
} else if (mode === "orphan-temp") {
  snapshot.operation.nonce = counterPath;
  await writeFile(
    join(directory, "operations", "." + operationId + ".json.crashed.tmp"),
    JSON.stringify(snapshot),
    { mode: 0o600 },
  );
  await writeFile(readyPath, "ready");
  await new Promise(() => { setInterval(() => {}, 1_000); });
} else if (mode === "save-hold") {
  snapshot.operation.nonce = counterPath;
  await journal.save(snapshot);
  await writeFile(readyPath, "ready");
  await new Promise(() => { setInterval(() => {}, 1_000); });
} else if (mode === "hold") {
  await journal.withLock("operation:" + operationId, async () => {
    await writeFile(readyPath, "ready");
    await new Promise(() => { setInterval(() => {}, 1_000); });
  });
}
`,
    { mode: 0o600 },
  );
  return path;
}

const childErrors = new WeakMap<ChildProcess, string>();

function runChild(script: string, args: string[]): ChildProcess {
  const child = spawn(process.execPath, [script, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  childErrors.set(child, "");
  child.stderr?.on("data", (bytes: Buffer) => {
    childErrors.set(child, (childErrors.get(child) ?? "") + bytes.toString());
  });
  return child;
}

async function exit(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
}

describe("file recovery journal", () => {
  it("round-trips lossless fields with private directory and file permissions", async () => {
    const parent = await temporaryRoot();
    const directory = join(parent, "state");
    const journal = createFileJournal({ directory });
    const value = prepared("operation-1");

    await journal.save(value);

    await expect(journal.load(value.operationId)).resolves.toEqual(value);
    expect(await mode(directory)).toBe(0o700);
    expect(await mode(join(directory, "operations", snapshotName("operation-1")))).toBe(0o600);
  });

  it("rejects traversal, symlinked state, and excessive permissions without touching targets", async () => {
    const parent = await temporaryRoot();
    const directory = join(parent, "state");
    const journal = createFileJournal({ directory });
    await journal.save(prepared("safe-operation"));
    await expect(journal.load("../escape")).rejects.toThrow(/operation.?id/i);

    const outside = join(parent, "outside.json");
    await writeFile(outside, "sentinel", { mode: 0o600 });
    await symlink(outside, join(directory, "operations", snapshotName("linked")));
    await expect(journal.load("linked")).rejects.toThrow(/symbolic link/i);
    await expect(readFile(outside, "utf8")).resolves.toBe("sentinel");

    await chmod(join(directory, "operations", snapshotName("safe-operation")), 0o644);
    await expect(journal.load("safe-operation")).rejects.toThrow(/permissions/i);
  });

  it("requires an explicit absolute directory and never accepts signer capabilities in state", async () => {
    expect(() => createFileJournal({ directory: "relative-state" })).toThrow(/absolute/i);
    const parent = await temporaryRoot();
    const directory = join(parent, "state");
    const journal = createFileJournal({ directory });
    const withSignerCapability = structuredClone(prepared("no-signer-in-state")) as JournalSnapshot & {
      operation: JournalSnapshot["operation"] & { signer: { signMessage: string } };
    };
    withSignerCapability.operation.signer = { signMessage: "must never be persisted" };

    await expect(journal.save(withSignerCapability)).rejects.toThrow(/signer.*not supported/i);
    await expect(journal.load("no-signer-in-state")).resolves.toBeNull();

    await chmod(directory, 0o755);
    await expect(journal.load("missing")).rejects.toThrow(/permissions/i);
  });

  it("rejects a frozen proxy URL that the read-only recovery API cannot represent", async () => {
    const parent = await temporaryRoot();
    const journal = createFileJournal({ directory: join(parent, "state") });
    const value = prepared("query-proxy");
    const malformed = {
      ...value,
      operation: { ...value.operation, proxyUrl: "https://proxy.example/proxy?region=one" },
    };

    await expect(journal.save(malformed)).rejects.toThrow(/proxyUrl/i);
    await expect(journal.load("query-proxy")).resolves.toBeNull();
  });

  it("rejects an oversized replacement and preserves the previous durable snapshot", async () => {
    const parent = await temporaryRoot();
    const journal = createFileJournal({ directory: join(parent, "state") });
    const original = prepared("bounded-operation");
    await journal.save(original);
    const oversized = {
      ...original,
      debug: "x".repeat(MAX_JOURNAL_SNAPSHOT_BYTES),
    } as unknown as JournalSnapshot;

    await expect(journal.save(oversized)).rejects.toThrow(/1 MiB|snapshot.*limit/i);
    await expect(journal.load(original.operationId)).resolves.toEqual(original);
  });

  it("loads through bounded handle reads instead of unbounded readFile", async () => {
    const parent = await temporaryRoot();
    const directory = join(parent, "state");
    const journal = createFileJournal({ directory });
    const original = prepared("bounded-read-operation");
    await journal.save(original);
    const path = join(directory, "operations", snapshotName(original.operationId));
    const probe = await open(path, "r");
    const prototype = Object.getPrototypeOf(probe) as {
      readFile: (...args: never[]) => Promise<Buffer>;
    };
    const unbounded = vi.spyOn(prototype, "readFile").mockImplementation(() => {
      throw new Error("unbounded readFile was used");
    });
    await probe.close();
    try {
      await expect(journal.load(original.operationId)).resolves.toEqual(original);
      expect(unbounded).not.toHaveBeenCalled();
    } finally {
      unbounded.mockRestore();
    }
  });

  it.each(["sparse", "deep"])("preflights %s snapshot before stringify and preserves durable evidence", async (kind) => {
    const parent = await temporaryRoot();
    const journal = createFileJournal({ directory: join(parent, "state") });
    const original = prepared("preflight-operation");
    await journal.save(original);
    let hostile: unknown = new Array(10_001);
    if (kind === "deep") {
      hostile = {};
      for (let i = 0; i < 3000; i++) hostile = { child: hostile };
    }
    const malformed = { ...original, debug: hostile } as unknown as JournalSnapshot;
    const stringify = vi.spyOn(JSON, "stringify");
    try {
      await expect(journal.save(malformed)).rejects.toThrow(/preflight|limit/i);
      expect(stringify).not.toHaveBeenCalled();
    } finally {
      stringify.mockRestore();
    }
    await expect(journal.load(original.operationId)).resolves.toEqual(original);
  });

  it("ignores orphan temporary files and reads only an atomically renamed snapshot", async () => {
    const parent = await temporaryRoot();
    const directory = join(parent, "state");
    const journal = createFileJournal({ directory });
    const original = prepared("atomic-operation", "7");
    await journal.save(original);
    await writeFile(
      join(directory, "operations", ".atomic-operation.json.crashed.tmp"),
      JSON.stringify(prepared("atomic-operation", "8")),
      { mode: 0o600 },
    );

    await expect(journal.load(original.operationId)).resolves.toEqual(original);
    const replacement = prepared("atomic-operation", "9");
    await journal.save(replacement);
    await expect(journal.load(original.operationId)).resolves.toEqual(replacement);
  });

  it("serializes two child processes so one operation performs one simulated submit", async () => {
    const parent = await temporaryRoot();
    const runtime = await childRuntime(parent);
    const script = await childScript(parent, runtime);
    const directory = join(parent, "state");
    const counter = join(parent, "submits.txt");
    const args = ["once", directory, "shared-operation", counter, join(parent, "unused")];
    const first = runChild(script, args);
    const second = runChild(script, args);

    const exits = await Promise.all([exit(first), exit(second)]);
    expect(exits, [childErrors.get(first), childErrors.get(second)].join("\n")).toEqual([0, 0]);
    await expect(readFile(counter, "utf8")).resolves.toBe("1");
    await expect(createFileJournal({ directory }).load("shared-operation")).resolves.toBeTruthy();
  });

  it("survives child termination before and after the atomic rename boundary", async () => {
    const parent = await temporaryRoot();
    const runtime = await childRuntime(parent);
    const script = await childScript(parent, runtime);
    const directory = join(parent, "state");
    const journal = createFileJournal({ directory });
    await journal.save(prepared("crash-boundary", "7"));

    const beforeReady = join(parent, "before-rename-ready");
    const beforeRename = runChild(script, ["orphan-temp", directory, "crash-boundary", "8", beforeReady]);
    await waitForFile(beforeReady);
    beforeRename.kill("SIGKILL");
    await exit(beforeRename);
    await expect(journal.load("crash-boundary")).resolves.toEqual(prepared("crash-boundary", "7"));

    const afterReady = join(parent, "after-rename-ready");
    const afterRename = runChild(script, ["save-hold", directory, "crash-boundary", "9", afterReady]);
    await waitForFile(afterReady);
    afterRename.kill("SIGKILL");
    await exit(afterRename);
    await expect(journal.load("crash-boundary")).resolves.toEqual(prepared("crash-boundary", "9"));
  });

  it("fails closed for a dead lock instead of reclaiming it during a signing lock", async () => {
    const parent = await temporaryRoot();
    const runtime = await childRuntime(parent);
    const script = await childScript(parent, runtime);
    const directory = join(parent, "state");
    const ready = join(parent, "ready");
    const holder = runChild(script, ["hold", directory, "crashed-operation", join(parent, "unused"), ready]);
    await waitForFile(ready);

    const liveWaiter = createFileJournal({ directory, lockTimeoutMs: 75, lockPollMs: 10 });
    await expect(
      liveWaiter.withLock("operation:crashed-operation", async () => "unexpected"),
    ).rejects.toThrow(/timed out.*lock/i);

    holder.kill("SIGKILL");
    await exit(holder);
    const recovered = createFileJournal({ directory, lockTimeoutMs: 100, lockPollMs: 10 });
    await expect(
      recovered.withLock("operation:crashed-operation", async () => "recovered"),
    ).rejects.toThrow(/dead owner.*manual inspection|required.*recovery/i);
  });

  it("does not let either of two restart processes reclaim the same dead signing lock", async () => {
    const parent = await temporaryRoot();
    const runtime = await childRuntime(parent);
    const script = await childScript(parent, runtime);
    const directory = join(parent, "state");
    const ready = join(parent, "ready");
    const holder = runChild(script, ["hold", directory, "stale-operation", join(parent, "unused"), ready]);
    await waitForFile(ready);
    holder.kill("SIGKILL");
    await exit(holder);

    const counter = join(parent, "submits.txt");
    const args = ["once", directory, "stale-operation", counter, join(parent, "unused")];
    const first = runChild(script, args);
    const second = runChild(script, args);

    const exits = await Promise.all([exit(first), exit(second)]);
    expect(exits).toEqual([1, 1]);
    await expect(readFile(counter, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("uses case-stable snapshot names so case-distinct operation IDs cannot alias", async () => {
    const parent = await temporaryRoot();
    const directory = join(parent, "state");
    const journal = createFileJournal({ directory });

    await journal.save(prepared("Invoice", "7"));
    await journal.save(prepared("invoice", "8"));

    const names = (await readdir(join(directory, "operations"))).filter((name) => name.endsWith(".json"));
    expect(names).toHaveLength(2);
    expect(names.every((name) => /^[0-9a-f]{64}\.json$/.test(name))).toBe(true);
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(2);
    await expect(journal.load("Invoice")).resolves.toEqual(prepared("Invoice", "7"));
    await expect(journal.load("invoice")).resolves.toEqual(prepared("invoice", "8"));
  });

  it("serializes distinct operations for one account without reusing stale preparation", async () => {
    const parent = await temporaryRoot();
    const runtime = await childRuntime(parent);
    const script = await childScript(parent, runtime);
    const directory = join(parent, "state");
    const nonceCounter = join(parent, "next-nonce.txt");
    const first = runChild(script, ["prepare", directory, "account-operation-a", nonceCounter, join(parent, "unused-a")]);
    const second = runChild(script, ["prepare", directory, "account-operation-b", nonceCounter, join(parent, "unused-b")]);

    const exits = await Promise.all([exit(first), exit(second)]);
    expect(exits, [childErrors.get(first), childErrors.get(second)].join("\n")).toEqual([0, 0]);
    const journal = createFileJournal({ directory });
    const snapshots = await Promise.all([
      journal.load("account-operation-a"),
      journal.load("account-operation-b"),
    ]);
    expect(new Set(snapshots.map((snapshot) => snapshot?.operation.nonce))).toEqual(
      new Set(["0", "1"]),
    );
    await expect(readFile(nonceCounter, "utf8")).resolves.toBe("2");
  });

  it("publishes only complete lock metadata while another process acquires the account lock", async () => {
    const parent = await temporaryRoot();
    const delayedRoot = join(parent, "delayed");
    const contenderRoot = join(parent, "contender");
    await mkdir(delayedRoot);
    await mkdir(contenderRoot);
    const ready = join(parent, "owner-write-paused");
    const release = join(parent, "release-owner-write");
    const delayed = await childScript(delayedRoot, await childRuntime(delayedRoot, { ready, release }));
    const contender = await childScript(contenderRoot, await childRuntime(contenderRoot));
    const directory = join(parent, "state");
    const counter = join(parent, "next-nonce.txt");
    const first = runChild(delayed, ["prepare", directory, "publication-a", counter, ready]);
    const firstExit = exit(first);
    let second: ChildProcess | undefined;
    let secondExit: number | null = null;
    try {
      await waitForFile(ready);
      second = runChild(contender, ["prepare", directory, "publication-b", counter, ready]);
      secondExit = await exit(second);
    } finally {
      await writeFile(release, "release");
      await firstExit;
    }
    const exits = [await firstExit, secondExit];
    expect(exits, [childErrors.get(first), second && childErrors.get(second)].join("\n")).toEqual([0, 0]);
    const journal = createFileJournal({ directory });
    expect((await journal.load("publication-b"))?.operation.nonce).toBe("0");
    expect((await journal.load("publication-a"))?.operation.nonce).toBe("1");
    await expect(readFile(counter, "utf8")).resolves.toBe("2");
  });

  it("does not publish a lock if its process dies before writing owner metadata", async () => {
    const parent = await temporaryRoot();
    const ready = join(parent, "owner-write-paused");
    const release = join(parent, "unused-release");
    const script = await childScript(parent, await childRuntime(parent, { ready, release }));
    const directory = join(parent, "state");
    const counter = join(parent, "unused-counter");
    const child = runChild(script, ["prepare", directory, "unpublished-owner", counter, ready]);
    const childExit = exit(child);
    try {
      await waitForFile(ready);
      expect((await readdir(join(directory, "locks"))).filter((name) => name.endsWith(".lock"))).toEqual([]);
    } finally {
      child.kill("SIGKILL");
      await childExit;
    }
    const journal = createFileJournal({ directory });
    let calls = 0;
    await journal.withLock("account:fast:testnet:" + "22".repeat(32), async () => { calls += 1; });
    expect(calls).toBe(1);
    expect((await readdir(join(directory, "locks"))).some((name) => name.endsWith(".owner.tmp"))).toBe(true);
  });

  it("retains malformed published locks and never enters their critical section", async () => {
    const parent = await temporaryRoot();
    const directory = join(parent, "state");
    const journal = createFileJournal({ directory });
    await journal.save(prepared("malformed-owner"));
    const key = "operation:malformed-owner";
    const lock = join(directory, "locks", createHash("sha256").update(key).digest("hex") + ".lock");
    await writeFile(lock, "{", { mode: 0o600 });
    let calls = 0;
    await expect(journal.withLock(key, async () => { calls += 1; })).rejects.toThrow(/malformed.*manual inspection/i);
    expect(calls).toBe(0);
    await expect(readFile(lock, "utf8")).resolves.toBe("{");
  });
});
