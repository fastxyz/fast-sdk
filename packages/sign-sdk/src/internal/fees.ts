// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

import { FeePolicyError } from "../errors.js";
import type { SignNetwork } from "../types.js";
import { readBoundedBody, withDeadline } from "./index-http.js";

export type FeeState =
  | { readonly kind: "none" }
  | {
      readonly kind: "quoted";
      readonly tokenId: string;
      readonly symbol: string;
      readonly decimals: number;
      readonly atomicAmount: string;
      readonly updateId: number | null;
    }
  | { readonly kind: "unavailable" };

export type ConfirmedFee = Exclude<FeeState, { kind: "unavailable" }>;

export interface FeeSource {
  networkInfo(): Promise<unknown>;
  tokenMeta(tokenId: string): Promise<unknown>;
}

export type FeeFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface ProxyFeeSourceOptions {
  readonly proxyUrl: string;
  readonly fetchImpl?: FeeFetch;
  readonly deadlineMs?: number;
}

export interface FeePolicy {
  readonly feeFreeNetwork?: boolean;
  readonly maxAtomicAmount: string;
  readonly tokenId: string | null;
}

export interface AuthorizedFee {
  readonly tokenId: string | null;
  readonly amountAtomic: string;
  readonly scheduleFingerprint: string;
}

const TOKEN_ID = /^[0-9a-f]{64}$/;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/;
const MAX_U256 = (1n << 256n) - 1n;
const FEE_BODY_LIMIT_BYTES = 256 * 1024;
const FEE_DEADLINE_MS = 15_000;

class InvalidFeeResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidFeeResponseError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validAmount(value: unknown): value is string {
  if (typeof value !== "string" || !DECIMAL.test(value)) return false;
  try {
    return BigInt(value) <= MAX_U256;
  } catch {
    return false;
  }
}

function isU8(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 255;
}

function tokenMetaFor(
  value: unknown,
  tokenId: string,
): { symbol: string; decimals: number; updateId: number | null } | null {
  const list = isObject(value) && isObject(value.data)
    ? value.data.requested_token_metadata
    : undefined;
  if (!Array.isArray(list)) return null;
  const matches = list.filter((row) => Array.isArray(row) && row[0] === tokenId);
  if (matches.length !== 1 || !isObject(matches[0]?.[1])) return null;
  const { token_name: symbol, decimals, update_id: updateIdValue } = matches[0][1];
  if (typeof symbol !== "string" || symbol.length === 0 || !isU8(decimals)) return null;
  let updateId: number | null = null;
  if (updateIdValue !== undefined) {
    if (!Number.isSafeInteger(updateIdValue) || (updateIdValue as number) < 0) return null;
    updateId = updateIdValue as number;
  }
  return { symbol, decimals, updateId };
}

export function toRestGateway(proxyUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(proxyUrl);
  } catch {
    throw new Error("proxyUrl must be an absolute HTTP(S) URL");
  }
  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error("proxyUrl must be an HTTP(S) URL without credentials, query, or fragment");
  }
  return parsed.href.replace(/\/+$/, "").replace(/\/proxy$/, "/proxy-rest");
}

export function createProxyFeeSource(options: ProxyFeeSourceOptions): FeeSource {
  const gateway = toRestGateway(options.proxyUrl);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("fetchImpl is required when global fetch is unavailable");
  const deadlineMs = options.deadlineMs ?? FEE_DEADLINE_MS;
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) throw new Error("fee deadlineMs must be positive");
  const getJson = async (path: string): Promise<unknown> => {
    return withDeadline(deadlineMs, async (signal) => {
      const response = await fetchImpl(`${gateway}${path}`, {
        headers: { accept: "application/json" },
        redirect: "error",
        signal,
      });
      if (!response.ok) {
        if (response.body) await response.body.cancel().catch(() => undefined);
        throw new Error(`${path} ${response.status}`);
      }
      const body = await readBoundedBody(response, FEE_BODY_LIMIT_BYTES, signal);
      if (body.truncated) {
        // The response was received, but its schema cannot be inspected
        // safely. Keep the fee-free fallback limited to genuinely unreadable
        // transport/status/deadline failures.
        throw new InvalidFeeResponseError(`fee response exceeded ${FEE_BODY_LIMIT_BYTES} bytes`);
      }
      const text = new TextDecoder().decode(body.bytes);
      try {
        return JSON.parse(text);
      } catch {
        // A response that was received but is not JSON is a readable schema
        // failure, not the narrow "schedule could not be fetched" case.
        throw new InvalidFeeResponseError("fee response body is not valid JSON");
      }
    }, "fee");
  };
  return {
    networkInfo: () => getJson("/v1/network-info"),
    tokenMeta: (tokenId) => getJson(`/v1/tokens?token_ids=${encodeURIComponent(tokenId)}`),
  };
}

/** Preserve the website's fail-closed fee schedule semantics exactly. */
export async function resolveClaimFee(
  network: SignNetwork,
  source: FeeSource,
  feeFreeNetwork = false,
): Promise<FeeState> {
  if (typeof feeFreeNetwork !== "boolean") throw new FeePolicyError("feeFreeNetwork must be a boolean");
  let response: unknown;
  try {
    response = await source.networkInfo();
  } catch (error) {
    if (error instanceof InvalidFeeResponseError) return { kind: "unavailable" };
    return feeFreeNetwork ? { kind: "none" } : { kind: "unavailable" };
  }
  const data = isObject(response) ? response.data : undefined;
  if (!isObject(data) || data.network_id !== network) return { kind: "unavailable" };
  const fees = data.fees;
  if (!isObject(fees) || typeof fees.default !== "string" || !Array.isArray(fees.entries)) {
    return { kind: "unavailable" };
  }
  if (fees.entries.length === 0) return fees.default === "" ? { kind: "none" } : { kind: "unavailable" };
  const defaultId = fees.default;
  if (!TOKEN_ID.test(defaultId)) return { kind: "unavailable" };
  const matchingEntries = fees.entries.filter(
    (candidate) => isObject(candidate) && candidate.token_id === defaultId,
  );
  if (matchingEntries.length !== 1) return { kind: "unavailable" };
  const entry = matchingEntries[0];
  if (!isObject(entry) || !validAmount(entry.fixed_amount)) return { kind: "unavailable" };
  if (entry.fixed_amount === "0") return { kind: "none" };
  let metadata: unknown;
  try {
    metadata = await source.tokenMeta(defaultId);
  } catch {
    return { kind: "unavailable" };
  }
  const token = tokenMetaFor(metadata, defaultId);
  if (!token) return { kind: "unavailable" };
  return {
    kind: "quoted",
    tokenId: defaultId,
    symbol: token.symbol,
    decimals: token.decimals,
    atomicAmount: entry.fixed_amount,
    updateId: token.updateId,
  };
}

export function feeKey(network: SignNetwork, state: FeeState): string {
  if (state.kind !== "quoted") return `${network}|${state.kind}`;
  return `${network}|fee:${state.tokenId}:${state.atomicAmount}:${state.decimals}:${state.symbol}:${state.updateId ?? ""}`;
}

export function feeTokenForState(state: FeeState): string | null {
  if (state.kind === "quoted") return state.tokenId;
  if (state.kind === "none") return null;
  throw new FeePolicyError("the Fast fee schedule is unavailable; refusing to prepare a transaction");
}

export function assertFeePolicy(
  network: SignNetwork,
  state: FeeState,
  policy: FeePolicy,
): AuthorizedFee {
  if (!validAmount(policy.maxAtomicAmount)) {
    throw new FeePolicyError("maxAtomicAmount must be canonical unsigned decimal text within U256");
  }
  if (state.kind === "unavailable") {
    throw new FeePolicyError("the Fast fee schedule is unavailable");
  }
  if (state.kind === "none") {
    if (policy.tokenId !== null || policy.maxAtomicAmount !== "0") {
      throw new FeePolicyError("a fee-free authorization must explicitly accept zero with tokenId null");
    }
    return { tokenId: null, amountAtomic: "0", scheduleFingerprint: feeKey(network, state) };
  }
  if (policy.tokenId !== state.tokenId) {
    throw new FeePolicyError("the quoted fee token does not match the explicitly authorized token");
  }
  if (BigInt(state.atomicAmount) > BigInt(policy.maxAtomicAmount)) {
    throw new FeePolicyError("the quoted fee exceeds maxAtomicAmount");
  }
  return {
    tokenId: state.tokenId,
    amountAtomic: state.atomicAmount,
    scheduleFingerprint: feeKey(network, state),
  };
}

export function assertFeeSnapshotUnchanged(
  network: SignNetwork,
  authorized: ConfirmedFee,
  current: FeeState,
): void {
  if (feeKey(network, authorized) !== feeKey(network, current)) {
    throw new FeePolicyError("the observed Fast fee schedule changed after local authorization");
  }
}

export function formatFee(state: FeeState): string | null {
  if (state.kind !== "quoted") return null;
  const padded = state.atomicAmount.padStart(state.decimals + 1, "0");
  const whole = padded.slice(0, padded.length - state.decimals) || "0";
  const fraction = state.decimals > 0
    ? padded.slice(padded.length - state.decimals).replace(/0+$/, "")
    : "";
  return `${fraction ? `${whole}.${fraction}` : whole} ${state.symbol}`;
}
