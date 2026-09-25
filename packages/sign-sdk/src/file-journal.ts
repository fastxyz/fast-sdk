// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

import { createHash, randomBytes } from "node:crypto";
import {
  constants,
  link,
  lstat,
  mkdir,
  open,
  rename,
  unlink,
} from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, isAbsolute, join, parse, resolve, sep } from "node:path";
import { platform } from "node:process";

import type {
  FrozenOperation,
  JournalSnapshot,
  RecoveryJournal,
  SignedSubmission,
} from "./types.js";
import { snapshotBoundedObjectCertificate } from "./internal/receipts.js";

export const MAX_JOURNAL_SNAPSHOT_BYTES = 1024 * 1024;
const MAX_LOCK_BYTES = 4 * 1024;
const OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const LOWER_HEX_32 = /^[0-9a-f]{64}$/;
const LOWER_HEX_16 = /^[0-9a-f]{32}$/;
const LOWER_HEX_64 = /^[0-9a-f]{128}$/;
const NON_EMPTY_EVEN_HEX = /^(?:[0-9a-f]{2})+$/;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/;
const STATES = new Set([
  "prepared",
  "submission_unknown",
  "settled",
  "registration_pending",
  "registration_conflict",
  "registration_rejected",
  "registered",
]);
const RELATIONSHIPS = new Set([
  "authored",
  "co_authored",
  "approved",
  "published",
  "reviewed",
  "witnessed",
  "received",
  "official_release",
]);

export interface FileJournalOptions {
  readonly directory: string;
  readonly lockTimeoutMs?: number;
  readonly lockPollMs?: number;
}

interface LockOwner {
  readonly version: 1;
  readonly pid: number;
  readonly hostname: string;
  readonly token: string;
  readonly keyDigest: string;
  readonly createdAt: number;
}

function errno(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === code;
}

function assertPlainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} must be a plain JSON object`);
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) throw new Error(`${label}.${key} is required`);
  }
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label}.${key} is not supported`);
  }
}

function assertText(value: unknown, label: string, maxBytes = 4096): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value) > maxBytes) {
    throw new Error(`${label} must be non-empty text within ${maxBytes} bytes`);
  }
}

function assertSafeTime(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
}

function assertDecimal(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !DECIMAL.test(value)) {
    throw new Error(`${label} must be a canonical unsigned decimal string`);
  }
}

function assertHex(value: unknown, pattern: RegExp, label: string): asserts value is string {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`${label} must be canonical lowercase hex`);
  }
}

function assertHttpUrl(value: unknown, label: string, originOnly: boolean): asserts value is string {
  if (typeof value !== "string") throw new Error(`${label} must be an absolute HTTP(S) URL`);
  const hasQueryDelimiter = value.includes("?");
  const hasFragmentDelimiter = value.includes("#");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute HTTP(S) URL`);
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    hasQueryDelimiter ||
    hasFragmentDelimiter ||
    url.search !== "" ||
    url.hash !== "" ||
    (originOnly && url.pathname !== "/")
  ) {
    throw new Error(`${label} must be a public HTTP(S) ${originOnly ? "origin" : "URL"}`);
  }
}

export function assertOperationId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !OPERATION_ID.test(value) || /[^A-Za-z0-9._-]/.test(value)) {
    throw new Error("operationId must be 1-128 safe ASCII characters and start with an alphanumeric character");
  }
}

function assertJsonValue(value: unknown, label: string, depth = 0): void {
  if (depth > 64) throw new Error(`${label} exceeds the maximum JSON nesting depth`);
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${label} contains a non-finite number`);
    return;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) assertJsonValue(value[index], `${label}[${index}]`, depth + 1);
    return;
  }
  assertPlainObject(value, label);
  for (const [key, child] of Object.entries(value)) {
    if (Buffer.byteLength(key) > 1024) throw new Error(`${label} contains an oversized key`);
    assertJsonValue(child, `${label}.${key}`, depth + 1);
  }
}

function assertFrozenOperation(value: unknown, operationId: string): asserts value is FrozenOperation {
  assertPlainObject(value, "snapshot.operation");
  assertExactKeys(
    value,
    ["input", "network", "proxyUrl", "indexOrigin", "senderHex", "nonce", "requestIdHex", "issuedAtNanoseconds", "fee"],
    [],
    "snapshot.operation",
  );
  assertPlainObject(value.input, "snapshot.operation.input");
  assertExactKeys(
    value.input,
    ["operationId", "sha256", "relationship", "listBySigner"],
    ["signerName", "publicTitle"],
    "snapshot.operation.input",
  );
  if (value.input.operationId !== operationId) throw new Error("snapshot operationId binding does not match");
  assertHex(value.input.sha256, LOWER_HEX_32, "snapshot.operation.input.sha256");
  if (typeof value.input.relationship !== "string" || !RELATIONSHIPS.has(value.input.relationship)) {
    throw new Error("snapshot.operation.input.relationship is not supported");
  }
  if (typeof value.input.listBySigner !== "boolean") throw new Error("snapshot.operation.input.listBySigner must be boolean");
  if (value.input.signerName !== undefined) assertText(value.input.signerName, "snapshot.operation.input.signerName", 256);
  if (value.input.publicTitle !== undefined) assertText(value.input.publicTitle, "snapshot.operation.input.publicTitle", 512);
  if (value.network !== "fast:testnet" && value.network !== "fast:mainnet") throw new Error("snapshot.operation.network is invalid");
  assertHttpUrl(value.proxyUrl, "snapshot.operation.proxyUrl", false);
  assertHttpUrl(value.indexOrigin, "snapshot.operation.indexOrigin", true);
  assertHex(value.senderHex, LOWER_HEX_32, "snapshot.operation.senderHex");
  assertDecimal(value.nonce, "snapshot.operation.nonce");
  assertHex(value.requestIdHex, LOWER_HEX_16, "snapshot.operation.requestIdHex");
  assertDecimal(value.issuedAtNanoseconds, "snapshot.operation.issuedAtNanoseconds");
  if (value.fee !== null) {
    assertPlainObject(value.fee, "snapshot.operation.fee");
    assertExactKeys(value.fee, ["tokenId", "amountAtomic", "scheduleFingerprint"], [], "snapshot.operation.fee");
    if (value.fee.tokenId !== null) assertText(value.fee.tokenId, "snapshot.operation.fee.tokenId", 512);
    assertDecimal(value.fee.amountAtomic, "snapshot.operation.fee.amountAtomic");
    assertText(value.fee.scheduleFingerprint, "snapshot.operation.fee.scheduleFingerprint", 512);
  }
}

function assertSignedSubmission(value: unknown): asserts value is SignedSubmission {
  assertPlainObject(value, "snapshot.submission");
  assertExactKeys(
    value,
    ["txId", "signingBytesHex", "transactionBytesHex", "senderSignatureHex", "claimDataHex"],
    [],
    "snapshot.submission",
  );
  assertHex(value.txId, LOWER_HEX_32, "snapshot.submission.txId");
  assertHex(value.senderSignatureHex, LOWER_HEX_64, "snapshot.submission.senderSignatureHex");
  assertHex(value.signingBytesHex, NON_EMPTY_EVEN_HEX, "snapshot.submission.signingBytesHex");
  assertHex(value.transactionBytesHex, NON_EMPTY_EVEN_HEX, "snapshot.submission.transactionBytesHex");
  assertHex(value.claimDataHex, NON_EMPTY_EVEN_HEX, "snapshot.submission.claimDataHex");
}

function assertRecord(value: unknown): void {
  assertPlainObject(value, "snapshot.receipt.record");
  assertExactKeys(value, ["sha256", "tx_id", "signer", "nonce", "network"], [], "snapshot.receipt.record");
  assertHex(value.sha256, LOWER_HEX_32, "snapshot.receipt.record.sha256");
  assertHex(value.tx_id, LOWER_HEX_32, "snapshot.receipt.record.tx_id");
  assertHex(value.signer, LOWER_HEX_32, "snapshot.receipt.record.signer");
  if (typeof value.nonce !== "number" || !Number.isSafeInteger(value.nonce) || value.nonce < 0) {
    throw new Error("snapshot.receipt.record.nonce must be a non-negative safe integer");
  }
  if (value.network !== "fast:testnet" && value.network !== "fast:mainnet") throw new Error("snapshot.receipt.record.network is invalid");
}

function assertReceipt(
  value: unknown,
  operation: FrozenOperation,
  submission: SignedSubmission,
  operationId: string,
): void {
  assertPlainObject(value, "snapshot.receipt");
  assertExactKeys(
    value,
    ["version", "operationId", "indexOrigin", "record", "claimDataHex", "senderSignatureHex", "signatureScope", "certificate"],
    [],
    "snapshot.receipt",
  );
  if (value.version !== 1 || value.operationId !== operationId) throw new Error("snapshot receipt version or operation binding is invalid");
  assertHttpUrl(value.indexOrigin, "snapshot.receipt.indexOrigin", true);
  if (value.indexOrigin !== operation.indexOrigin) throw new Error("snapshot receipt index origin does not match the operation");
  assertRecord(value.record);
  const record = value.record as Record<string, unknown>;
  if (
    record.network !== operation.network ||
    record.signer !== operation.senderHex ||
    String(record.nonce) !== operation.nonce ||
    record.sha256 !== operation.input.sha256 ||
    record.tx_id !== submission.txId
  ) {
    throw new Error("snapshot receipt facts do not match the frozen operation");
  }
  assertHex(value.claimDataHex, NON_EMPTY_EVEN_HEX, "snapshot.receipt.claimDataHex");
  assertHex(value.senderSignatureHex, LOWER_HEX_64, "snapshot.receipt.senderSignatureHex");
  if (
    value.claimDataHex !== submission.claimDataHex ||
    value.senderSignatureHex !== submission.senderSignatureHex
  ) {
    throw new Error("snapshot receipt evidence does not match the signed submission");
  }
  if (value.signatureScope !== "versioned_transaction") throw new Error("snapshot receipt signature scope is invalid");
  assertJsonValue(value.certificate, "snapshot.receipt.certificate");
}

function assertDiagnostic(value: unknown): void {
  assertPlainObject(value, "snapshot.diagnostic");
  assertExactKeys(value, ["code", "message", "at"], ["status"], "snapshot.diagnostic");
  assertText(value.code, "snapshot.diagnostic.code", 128);
  assertText(value.message, "snapshot.diagnostic.message", 4096);
  assertSafeTime(value.at, "snapshot.diagnostic.at");
  if (value.status !== undefined && (typeof value.status !== "number" || !Number.isInteger(value.status) || value.status < 100 || value.status > 599)) {
    throw new Error("snapshot.diagnostic.status must be an HTTP status");
  }
}

function assertJournalSnapshot(value: unknown): asserts value is JournalSnapshot {
  assertPlainObject(value, "snapshot");
  assertExactKeys(
    value,
    ["version", "state", "operationId", "updatedAt", "operation"],
    ["reservation", "submission", "receipt", "diagnostic", "nextRegistrationAttemptAt", "registrationAttempts"],
    "snapshot",
  );
  if (value.version !== 1) throw new Error("unsupported journal snapshot version");
  if (typeof value.operationId !== "string") throw new Error("snapshot.operationId must be text");
  assertOperationId(value.operationId);
  if (typeof value.state !== "string" || !STATES.has(value.state)) throw new Error("unsupported journal state");
  assertSafeTime(value.updatedAt, "snapshot.updatedAt");
  assertFrozenOperation(value.operation, value.operationId);
  if (value.diagnostic !== undefined) assertDiagnostic(value.diagnostic);
  if (value.nextRegistrationAttemptAt !== undefined) assertSafeTime(value.nextRegistrationAttemptAt, "snapshot.nextRegistrationAttemptAt");
  if (value.registrationAttempts !== undefined && (typeof value.registrationAttempts !== "number" || !Number.isSafeInteger(value.registrationAttempts) || value.registrationAttempts < 0)) {
    throw new Error("snapshot.registrationAttempts must be a safe nonnegative integer");
  }
  if (value.state === "prepared" && value.reservation !== undefined) {
    assertPlainObject(value.reservation, "snapshot.reservation");
    assertExactKeys(value.reservation, ["ownerOperationId", "network", "senderHex", "nonce"], [], "snapshot.reservation");
    assertOperationId(value.reservation.ownerOperationId);
    if (value.reservation.network !== value.operation.network) throw new Error("snapshot reservation network does not match operation");
    if (value.reservation.senderHex !== value.operation.senderHex) throw new Error("snapshot reservation sender does not match operation");
    assertDecimal(value.reservation.nonce, "snapshot.reservation.nonce");
    if (value.reservation.nonce !== value.operation.nonce) throw new Error("snapshot reservation nonce does not match operation");
    if (value.submission !== undefined || value.receipt !== undefined || value.diagnostic !== undefined ||
      value.nextRegistrationAttemptAt !== undefined || value.registrationAttempts !== undefined) {
      throw new Error("nonce reservation snapshot contains settlement fields");
    }
    return;
  }
  if (value.reservation !== undefined) throw new Error("non-prepared snapshot cannot contain reservation");
  if (value.state === "prepared") {
    if (value.submission !== undefined || value.receipt !== undefined) throw new Error("prepared snapshot cannot contain settlement evidence");
    return;
  }
  assertSignedSubmission(value.submission);
  if (value.state === "submission_unknown") {
    if (value.receipt !== undefined) throw new Error("submission_unknown snapshot cannot contain a receipt");
    return;
  }
  assertReceipt(value.receipt, value.operation, value.submission, value.operationId);
}

async function ensureDirectoryEntry(path: string): Promise<void> {
  const parent = dirname(path);
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (errno(error, "ENOENT")) {
      if (parent === path) throw error;
      await ensureDirectoryEntry(parent);
      try {
        await mkdir(path, { mode: 0o700 });
      } catch (retryError) {
        if (!errno(retryError, "EEXIST")) throw retryError;
      }
    } else if (!errno(error, "EEXIST")) {
      throw error;
    }
  }
  await syncDirectory(parent);
}

async function assertNoSymlinkPathComponents(path: string): Promise<void> {
  const absolute = resolve(path);
  const { root } = parse(absolute);
  let current = root;
  for (const component of absolute.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, component);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) throw new Error(`journal path contains a symbolic link: ${current}`);
    } catch (error) {
      if (errno(error, "ENOENT")) return;
      if (errno(error, "ELOOP")) throw new Error(`journal path contains a symbolic link: ${current}`);
      throw error;
    }
  }
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  try {
    // Reject pre-existing symlink components before mkdir can follow them.
    await assertNoSymlinkPathComponents(path);
    await ensureDirectoryEntry(path);
    // Recheck at each layout use. This is not an atomic defense against a
    // concurrent replacement of a checked path component.
    await assertNoSymlinkPathComponents(path);
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error(`journal directory is a symbolic link: ${path}`);
    if (!stat.isDirectory()) throw new Error(`journal path is not a directory: ${path}`);
    if ((stat.mode & 0o777) !== 0o700) throw new Error(`journal directory has excessive permissions: ${path}`);
  } catch (error) {
    if (errno(error, "ELOOP")) throw new Error(`journal directory is a symbolic link: ${path}`);
    throw error;
  }
}

async function assertSafeExistingFile(path: string): Promise<boolean> {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error(`journal state is a symbolic link: ${path}`);
    if (!stat.isFile()) throw new Error(`journal state is not a regular file: ${path}`);
    if ((stat.mode & 0o777) !== 0o600) throw new Error(`journal state has excessive permissions: ${path}`);
    return true;
  } catch (error) {
    if (errno(error, "ENOENT")) return false;
    throw error;
  }
}

async function readSecureFile(path: string, maxBytes: number): Promise<{ bytes: Buffer; dev: bigint; ino: bigint }> {
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
  let handle;
  try {
    handle = await open(path, flags);
  } catch (error) {
    if (errno(error, "ELOOP")) throw new Error(`journal state is a symbolic link: ${path}`);
    throw error;
  }
  try {
    const stat = await handle.stat({ bigint: true });
    if (!stat.isFile()) throw new Error(`journal state is not a regular file: ${path}`);
    if ((Number(stat.mode) & 0o777) !== 0o600) throw new Error(`journal state has excessive permissions: ${path}`);
    if (stat.size > BigInt(maxBytes)) throw new Error(`journal snapshot exceeds the ${maxBytes === MAX_JOURNAL_SNAPSHOT_BYTES ? "1 MiB" : `${maxBytes} byte`} limit`);
    const chunks: Buffer[] = [];
    let total = 0;
    while (total <= maxBytes) {
      const remaining = maxBytes + 1 - total;
      if (remaining <= 0) break;
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, remaining));
      const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, null);
      if (bytesRead === 0) break;
      chunks.push(bytesRead === chunk.byteLength ? chunk : chunk.subarray(0, bytesRead));
      total += bytesRead;
    }
    if (total > maxBytes) throw new Error(`journal snapshot exceeds the ${maxBytes === MAX_JOURNAL_SNAPSHOT_BYTES ? "1 MiB" : `${maxBytes} byte`} limit`);
    const bytes = Buffer.concat(chunks, total);
    return { bytes, dev: stat.dev, ino: stat.ino };
  } finally {
    await handle.close();
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function sameFile(path: string, expected: { dev: bigint; ino: bigint }): Promise<boolean> {
  try {
    const stat = await lstat(path, { bigint: true });
    return stat.dev === expected.dev && stat.ino === expected.ino;
  } catch (error) {
    if (errno(error, "ENOENT")) return false;
    throw error;
  }
}

function parseLockOwner(bytes: Buffer, keyDigest: string): LockOwner {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("journal lock owner metadata is malformed; manual inspection is required");
  }
  assertPlainObject(value, "journal lock owner");
  assertExactKeys(value, ["version", "pid", "hostname", "token", "keyDigest", "createdAt"], [], "journal lock owner");
  if (
    value.version !== 1 ||
    typeof value.pid !== "number" ||
    !Number.isSafeInteger(value.pid) ||
    value.pid <= 0 ||
    value.hostname !== hostname() ||
    typeof value.token !== "string" ||
    !/^[0-9a-f]{32}$/.test(value.token) ||
    value.keyDigest !== keyDigest ||
    typeof value.createdAt !== "number" ||
    !Number.isSafeInteger(value.createdAt)
  ) {
    throw new Error("journal lock owner metadata cannot be verified; manual inspection is required");
  }
  return value as unknown as LockOwner;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (errno(error, "ESRCH")) return false;
    return true;
  }
}

class FileRecoveryJournal implements RecoveryJournal {
  readonly #directory: string;
  readonly #operations: string;
  readonly #locks: string;
  readonly #lockTimeoutMs: number;
  readonly #lockPollMs: number;

  constructor(options: FileJournalOptions) {
    const directory = options.directory;
    if (platform === "win32") throw new Error("FileJournal currently supports macOS and Linux only");
    if (!directory || !isAbsolute(directory)) throw new Error("journal directory must be absolute");
    this.#directory = resolve(directory);
    this.#operations = join(this.#directory, "operations");
    this.#locks = join(this.#directory, "locks");
    this.#lockTimeoutMs = options.lockTimeoutMs ?? 30_000;
    this.#lockPollMs = options.lockPollMs ?? 25;
    if (!Number.isFinite(this.#lockTimeoutMs) || this.#lockTimeoutMs <= 0) throw new Error("lockTimeoutMs must be positive");
    if (!Number.isFinite(this.#lockPollMs) || this.#lockPollMs <= 0) throw new Error("lockPollMs must be positive");
  }

  async #ensureLayout(): Promise<void> {
    await ensurePrivateDirectory(this.#directory);
    await ensurePrivateDirectory(this.#operations);
    await ensurePrivateDirectory(this.#locks);
  }

  #operationPath(operationId: string): string {
    assertOperationId(operationId);
    const operationDigest = createHash("sha256").update(operationId, "utf8").digest("hex");
    return join(this.#operations, `${operationDigest}.json`);
  }

  async load(operationId: string): Promise<JournalSnapshot | null> {
    await this.#ensureLayout();
    const path = this.#operationPath(operationId);
    try {
      const { bytes } = await readSecureFile(path, MAX_JOURNAL_SNAPSHOT_BYTES);
      let value: unknown;
      try {
        value = JSON.parse(bytes.toString("utf8"));
      } catch {
        throw new Error("journal snapshot is malformed JSON");
      }
      assertJournalSnapshot(value);
      if (value.operationId !== operationId) throw new Error("journal filename and operationId do not match");
      return value;
    } catch (error) {
      if (errno(error, "ENOENT")) return null;
      throw error;
    }
  }

  async save(snapshot: JournalSnapshot): Promise<void> {
    await this.#ensureLayout();
    let ownedSnapshot: unknown;
    try {
      ownedSnapshot = snapshotBoundedObjectCertificate(snapshot);
      if (!ownedSnapshot || typeof ownedSnapshot !== "object" || Array.isArray(ownedSnapshot)) {
        throw new Error("journal snapshot must be an object");
      }
    } catch (cause) {
      throw new Error("journal snapshot preflight rejected: 1 MiB, depth or logical node limit, or invalid data", { cause });
    }
    let encoded: string;
    try {
      encoded = JSON.stringify(ownedSnapshot);
    } catch {
      throw new Error("journal snapshot must be JSON and encode bigint fields as decimal strings");
    }
    const bytes = Buffer.from(encoded, "utf8");
    if (bytes.byteLength > MAX_JOURNAL_SNAPSHOT_BYTES) throw new Error("journal snapshot exceeds the 1 MiB limit");
    const parsed: unknown = JSON.parse(encoded);
    assertJournalSnapshot(parsed);
    const path = this.#operationPath(parsed.operationId);
    const operationDigest = createHash("sha256").update(parsed.operationId, "utf8").digest("hex");
    await assertSafeExistingFile(path);
    const temporary = join(
      this.#operations,
      `.${operationDigest}.json.${process.pid}.${randomBytes(8).toString("hex")}.tmp`,
    );
    let handle;
    let renamed = false;
    try {
      handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporary, path);
      renamed = true;
      await syncDirectory(this.#operations);
    } finally {
      if (handle) await handle.close().catch(() => undefined);
      if (!renamed) await unlink(temporary).catch((error) => {
        if (!errno(error, "ENOENT")) throw error;
      });
    }
  }

  async withLock<T>(lockKey: string, operation: () => Promise<T>): Promise<T> {
    await this.#ensureLayout();
    assertText(lockKey, "lockKey", 1024);
    const keyDigest = createHash("sha256").update(lockKey, "utf8").digest("hex");
    const path = join(this.#locks, `${keyDigest}.lock`);
    const token = randomBytes(16).toString("hex");
    const owner: LockOwner = {
      version: 1,
      pid: process.pid,
      hostname: hostname(),
      token,
      keyDigest,
      createdAt: Date.now(),
    };
    const deadline = Date.now() + this.#lockTimeoutMs;
    // Publish a fully written inode with an exclusive hard link. Opening the
    // public lock first exposes empty/partial owner JSON to live contenders.
    // link() never replaces a lock, and dead locks remain fail-closed.
    const ownerPath = join(this.#locks, `.${keyDigest}.${token}.owner.tmp`);
    const handle = await open(ownerPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    let published = false;
    try {
      try {
        try {
          await handle.writeFile(JSON.stringify(owner));
          await handle.sync();
        } finally {
          await handle.close();
        }
        while (true) {
          try {
            await link(ownerPath, path);
            published = true;
          } catch (error) {
            if (!errno(error, "EEXIST")) throw error;
            const existing = await readSecureFile(path, MAX_LOCK_BYTES).catch((readError) => {
              if (errno(readError, "ENOENT")) return null;
              throw readError;
            });
            if (!existing) continue;
            const existingOwner = parseLockOwner(existing.bytes, keyDigest);
            if (!processIsAlive(existingOwner.pid)) {
              throw new Error(
                `journal lock ${keyDigest} has a dead owner; manual inspection and explicit recovery are required`,
              );
            }
            if (Date.now() >= deadline) throw new Error(`timed out waiting for journal lock ${keyDigest}`);
            await new Promise((resolveWait) => setTimeout(resolveWait, this.#lockPollMs));
            continue;
          }
          await syncDirectory(this.#locks);
          break;
        }
      } finally {
        await unlink(ownerPath);
      }
      return await operation();
    } finally {
      // Even setup failure after successful publication must release only our
      // own link. Contenders never reclaim it, so exclusion is unchanged.
      if (published) {
        const existing = await readSecureFile(path, MAX_LOCK_BYTES).catch((error) => {
          if (errno(error, "ENOENT")) return null;
          throw error;
        });
        if (!existing) throw new Error("journal lock disappeared while its owner was active");
        const current = parseLockOwner(existing.bytes, keyDigest);
        if (current.token !== token || current.pid !== process.pid || !await sameFile(path, existing)) {
          throw new Error("journal lock ownership changed while its owner was active");
        }
        await unlink(path);
        await syncDirectory(this.#locks);
      }
    }
  }
}

export function createFileJournal(options: FileJournalOptions): RecoveryJournal {
  return new FileRecoveryJournal(options);
}
