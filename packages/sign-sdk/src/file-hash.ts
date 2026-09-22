// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { constants, lstat, open } from "node:fs/promises";

export interface HashFileOptions {
  readonly signal?: AbortSignal;
  readonly chunkSize?: number;
  /** Receives the cumulative byte count, never file content. */
  readonly onProgress?: (bytesRead: number) => void | Promise<void>;
}

export class FileChangedDuringHashError extends Error {
  constructor() {
    super("file changed while its SHA-256 digest was being computed");
    this.name = "FileChangedDuringHashError";
  }
}

function abortError(signal: AbortSignal): DOMException {
  return new DOMException(
    typeof signal.reason === "string" ? signal.reason : "file hashing was aborted",
    "AbortError",
  );
}

function sameIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameVersion(left: BigIntStats, right: BigIntStats): boolean {
  return sameIdentity(left, right) && left.size === right.size &&
    left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

/** Hash local file bytes incrementally. This function performs no network I/O. */
export async function hashFile(path: string, options: HashFileOptions = {}): Promise<string> {
  if (typeof path !== "string" || path.length === 0) throw new Error("file path is required");
  const chunkSize = options.chunkSize ?? 64 * 1024;
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1024 || chunkSize > 1024 * 1024) {
    throw new Error("chunkSize must be an integer from 1024 through 1048576 bytes");
  }
  if (options.signal?.aborted) throw abortError(options.signal);
  const pathBefore = await lstat(path, { bigint: true });
  if (pathBefore.isSymbolicLink()) throw new Error("refusing to hash a symbolic link");
  if (!pathBefore.isFile()) throw new Error("hashFile requires a regular file");
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const openedBefore = await handle.stat({ bigint: true });
    if (!openedBefore.isFile() || !sameIdentity(pathBefore, openedBefore)) {
      throw new FileChangedDuringHashError();
    }
    const hash = createHash("sha256");
    const buffer = new Uint8Array(chunkSize);
    let total = 0;
    while (true) {
      if (options.signal?.aborted) throw abortError(options.signal);
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      total += bytesRead;
      await options.onProgress?.(total);
    }
    if (options.signal?.aborted) throw abortError(options.signal);
    const [openedAfter, pathAfter] = await Promise.all([
      handle.stat({ bigint: true }),
      lstat(path, { bigint: true }),
    ]);
    if (options.signal?.aborted) throw abortError(options.signal);
    if (!pathAfter.isFile() || !sameVersion(openedBefore, openedAfter) || !sameVersion(openedAfter, pathAfter)) {
      throw new FileChangedDuringHashError();
    }
    return hash.digest("hex");
  } finally {
    await handle.close();
  }
}
