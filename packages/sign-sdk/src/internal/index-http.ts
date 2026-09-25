// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

import { assertLowerHex } from "./bytes.js";
import { serializeRecord, validateRecordRequest, type RecordRequest } from "./record-wire.js";
import type { SignNetwork } from "../types.js";

export const INDEX_REQUEST_DEADLINE_MS = 15_000;
export const INDEX_ERROR_BODY_LIMIT_BYTES = 4 * 1024;
export const INDEX_LOOKUP_BODY_LIMIT_BYTES = 256 * 1024;

export interface IndexSettlement {
  sha256?: string;
  tx_id: string;
  signer: string;
  network: string;
  settled_at: string;
  nonce?: number | null;
  relationship?: string | null;
  signer_name?: string | null;
  file_label?: string | null;
  list_by_signer?: boolean;
  metadata_revision?: string | null;
  metadata_sig?: string | null;
  signature_scope?: string | null;
  claim_data_hex?: string | null;
  settlement_trust?: string | null;
  fast_id?: string | null;
  address_binding_ref?: string | null;
  address_binding_receipt?: string | null;
  binding_verification?: string | null;
  label_sig?: string | null;
}

export type IndexHttpErrorKind = "transport" | "terminal" | "retryable" | "conflict";

export class IndexHttpError extends Error {
  constructor(
    public readonly kind: IndexHttpErrorKind,
    message: string,
    public readonly status?: number,
    public readonly body?: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "IndexHttpError";
  }
}

export interface BoundedBody {
  readonly bytes: Uint8Array;
  readonly truncated: boolean;
}

export async function readBoundedBody(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<BoundedBody> {
  if (!response.body) return { bytes: new Uint8Array(), truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  const cancel = (reason: unknown) => {
    void reader.cancel(reason).catch(() => undefined);
  };
  const onAbort = () => cancel(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) cancel(signal.reason);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - total;
      if (value.byteLength > remaining) {
        if (remaining > 0) {
          chunks.push(value.slice(0, remaining));
          total += remaining;
        }
        truncated = true;
        cancel("index response body exceeded its byte limit");
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, truncated };
}

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface IndexHttpClientOptions {
  readonly network: SignNetwork;
  readonly indexOrigin: string;
  readonly fetchImpl?: FetchLike;
  readonly deadlineMs?: number;
  readonly now?: () => number;
}

export interface ExactLookupInput {
  readonly sha256: string;
  readonly tx_id: string;
  readonly network: SignNetwork;
}

export interface IndexHttpClient {
  readonly network: SignNetwork;
  readonly indexOrigin: string;
  record(value: RecordRequest, requestTimestampMs?: number): Promise<void>;
  fetchExact(value: ExactLookupInput, requestTimestampMs?: number): Promise<IndexSettlement | null>;
}

export function normalizeIndexOrigin(value: unknown): string {
  if (typeof value !== "string") throw new Error("indexOrigin must be an absolute HTTP(S) origin");
  const hasQueryDelimiter = value.includes("?");
  const hasFragmentDelimiter = value.includes("#");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("indexOrigin must be an absolute HTTP(S) origin");
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username !== "" ||
    url.password !== "" ||
    hasQueryDelimiter ||
    hasFragmentDelimiter ||
    url.search !== "" ||
    url.hash !== "" ||
    (url.pathname !== "" && url.pathname !== "/")
  ) {
    throw new Error("indexOrigin must be an absolute HTTP(S) origin without credentials, path, query, or fragment");
  }
  return url.origin;
}

function assertSignNetwork(value: unknown): asserts value is SignNetwork {
  if (value !== "fast:testnet" && value !== "fast:mainnet") {
    throw new Error("network must be fast:testnet or fast:mainnet");
  }
}

function boundedMessage(value: string): string {
  return value.length > 500 ? `${value.slice(0, 500)}...` : value;
}

function parseRetryAfter(value: string | null, responseTimestampMs: number | undefined): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, 24 * 60 * 60 * 1_000);
  }
  const date = Date.parse(value);
  if (!Number.isNaN(date) && responseTimestampMs !== undefined) {
    return Math.min(Math.max(0, date - responseTimestampMs), 24 * 60 * 60 * 1_000);
  }
  return undefined;
}

function readResponseTimestamp(now: () => number): number | undefined {
  try {
    const value = now();
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  } catch {
    // A failed optional clock read must not replace the HTTP error classification.
    return undefined;
  }
}

export async function withDeadline<T>(
  deadlineMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
  label = "index",
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new IndexHttpError("retryable", `${label} request timed out after ${deadlineMs} ms`));
      controller.abort(`${label} request deadline exceeded`);
    }, deadlineMs);
  });
  try {
    return await Promise.race([operation(controller.signal), deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function responseError(
  response: Response,
  prefix: string,
  signal: AbortSignal,
  responseTimestampMs: number | undefined,
): Promise<IndexHttpError> {
  const result = await readBoundedBody(response, INDEX_ERROR_BODY_LIMIT_BYTES, signal).catch(() => ({
    bytes: new Uint8Array(),
    truncated: false,
  }));
  const body = boundedMessage(new TextDecoder().decode(result.bytes));
  const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
  const kind: IndexHttpErrorKind = response.status === 409 ? "conflict" : retryable ? "retryable" : "terminal";
  return new IndexHttpError(
    kind,
    `${prefix}: ${response.status}${body ? ` ${body}` : ""}`,
    response.status,
    body,
    parseRetryAfter(response.headers.get("retry-after"), responseTimestampMs),
  );
}

function assertExactBinding(value: ExactLookupInput, network: SignNetwork): void {
  assertLowerHex(value.sha256, 32, "sha256");
  assertLowerHex(value.tx_id, 32, "tx_id");
  if (value.network !== network) throw new Error("record network does not match the configured network");
}

export function createIndexHttpClient(options: IndexHttpClientOptions): IndexHttpClient {
  const network = options.network;
  assertSignNetwork(network);
  const indexOrigin = normalizeIndexOrigin(options.indexOrigin);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("fetchImpl is required when global fetch is unavailable");
  const deadlineMs = options.deadlineMs ?? INDEX_REQUEST_DEADLINE_MS;
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) throw new Error("deadlineMs must be positive");
  const now = options.now ?? Date.now;

  return {
    network,
    indexOrigin,
    async record(value, requestTimestampMs = now()) {
      const validated = validateRecordRequest(value);
      if (validated.network !== network) {
        throw new Error("record network does not match the configured network");
      }
      const body = serializeRecord(validated);
      await withDeadline(deadlineMs, async (signal) => {
        let response: Response;
        try {
          response = await fetchImpl(`${indexOrigin}/record`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body,
            signal,
            redirect: "error",
          });
        } catch (error) {
          if (error instanceof IndexHttpError) throw error;
          throw new IndexHttpError("transport", error instanceof Error ? error.message : String(error));
        }
        if (response.status !== 200) throw await responseError(response, "index /record failed", signal, requestTimestampMs);
        if (response.body) await response.body.cancel().catch(() => undefined);
      });
    },
    async fetchExact(value, requestTimestampMs) {
      assertExactBinding(value, network);
      const instant = requestTimestampMs === undefined ? now() : requestTimestampMs;
      if (!Number.isSafeInteger(instant) || instant < 0) {
        throw new Error("clock must return non-negative integer milliseconds");
      }
      return withDeadline(deadlineMs, async (signal) => {
        let response: Response;
        try {
          const url = `${indexOrigin}/by-hash/${value.sha256}?network=${encodeURIComponent(value.network)}&tx_id=${encodeURIComponent(value.tx_id)}`;
          response = await fetchImpl(url, { signal, redirect: "error" });
        } catch (error) {
          if (error instanceof IndexHttpError) throw error;
          throw new IndexHttpError("transport", error instanceof Error ? error.message : String(error));
        }
        if (!response.ok) {
          const responseTimestampMs = readResponseTimestamp(now);
          throw await responseError(response, "index /by-hash failed", signal, responseTimestampMs);
        }
        let body: unknown;
        let result: BoundedBody;
        try {
          result = await readBoundedBody(response, INDEX_LOOKUP_BODY_LIMIT_BYTES, signal);
        } catch (error) {
          throw new IndexHttpError("transport", error instanceof Error ? error.message : String(error));
        }
        if (result.truncated) {
          throw new IndexHttpError(
            "terminal",
            `index /by-hash response exceeded ${INDEX_LOOKUP_BODY_LIMIT_BYTES} bytes`,
          );
        }
        try {
          body = JSON.parse(new TextDecoder().decode(result.bytes));
        } catch {
          throw new IndexHttpError("terminal", "index /by-hash returned malformed JSON");
        }
        if (!body || typeof body !== "object") {
          throw new IndexHttpError("terminal", "index /by-hash returned a malformed response");
        }
        const lookup = body as { sha256?: unknown; settlements?: unknown };
        if (
          typeof lookup.sha256 !== "string" ||
          !/^[0-9a-f]{64}$/i.test(lookup.sha256) ||
          lookup.sha256.toLowerCase() !== value.sha256.toLowerCase() ||
          !Array.isArray(lookup.settlements)
        ) {
          throw new IndexHttpError(
            "terminal",
            "index /by-hash returned a mismatched or malformed document hash",
          );
        }
        if (lookup.settlements.length > 1) {
          throw new IndexHttpError("terminal", "index /by-hash returned more than one exact settlement row");
        }
        if (lookup.settlements.length === 0) return null;
        const row: unknown = lookup.settlements[0];
        if (!isSettlementRow(row)) {
          throw new IndexHttpError("terminal", "index /by-hash returned a malformed settlement row");
        }
        if (
          row.sha256 !== undefined &&
          row.sha256.toLowerCase() !== lookup.sha256.toLowerCase()
        ) {
          throw new IndexHttpError(
            "terminal",
            "index /by-hash returned a contradictory settlement row hash",
          );
        }
        if (
          row.tx_id.toLowerCase() !== value.tx_id.toLowerCase() ||
          row.network !== value.network
        ) {
          throw new IndexHttpError(
            "terminal",
            "index /by-hash returned a settlement for a different transaction or network",
          );
        }
        return { ...row, sha256: lookup.sha256.toLowerCase() };
      });
    },
  };
}

// Validate the public return type before handing untrusted JSON to consumers.
// Exact candidate/evidence equality remains the reconciler's responsibility.
function isSettlementRow(value: unknown): value is IndexSettlement {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (
    typeof row.tx_id !== "string" || !/^[0-9a-f]{64}$/i.test(row.tx_id) ||
    typeof row.signer !== "string" || !/^[0-9a-f]{64}$/i.test(row.signer) ||
    (row.network !== "fast:testnet" && row.network !== "fast:mainnet") ||
    typeof row.settled_at !== "string"
  ) return false;
  if (row.nonce !== undefined && row.nonce !== null &&
    (typeof row.nonce !== "number" || !Number.isSafeInteger(row.nonce) || row.nonce < 0)) return false;
  if (row.list_by_signer !== undefined && typeof row.list_by_signer !== "boolean") return false;
  if (row.sha256 !== undefined && typeof row.sha256 !== "string") return false;
  const optionalStrings = [
    "relationship", "signer_name", "file_label", "metadata_revision", "metadata_sig",
    "signature_scope", "claim_data_hex", "settlement_trust", "fast_id", "address_binding_ref",
    "address_binding_receipt", "binding_verification", "label_sig",
  ];
  return optionalStrings.every((key) => row[key] === undefined || row[key] === null || typeof row[key] === "string");
}
