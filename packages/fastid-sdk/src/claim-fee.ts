import { toRestGateway } from "./claim-tx.js";

export type FeeState =
  | { kind: "none" }
  | {
      kind: "quoted";
      tokenId: string;
      symbol: string;
      decimals: number;
      atomicAmount: string;
      updateId: number | null;
    }
  | { kind: "unavailable" };

export type ConfirmedFee = Exclude<FeeState, { kind: "unavailable" }>;

export interface FeeSource {
  networkInfo(): Promise<unknown>;
  tokenMeta(tokenId: string): Promise<unknown>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const HEX64 = /^[0-9a-f]{64}$/;
const MAX_U256 = (1n << 256n) - 1n;

function isU8(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 255
  );
}

function validAmount(value: unknown): value is string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    return false;
  }
  try {
    return BigInt(value) <= MAX_U256;
  } catch {
    return false;
  }
}

function tokenMetaFor(
  metadata: unknown,
  tokenId: string,
): { symbol: string; decimals: number; updateId: number | null } | null {
  const list =
    isObject(metadata) && isObject(metadata.data)
      ? metadata.data.requested_token_metadata
      : undefined;
  if (!Array.isArray(list)) return null;
  const matches = list.filter(
    (row) => Array.isArray(row) && row[0] === tokenId,
  );
  if (matches.length !== 1) return null;
  const row = matches[0];
  if (!Array.isArray(row) || !isObject(row[1])) return null;
  const { token_name, decimals, update_id } = row[1];
  if (typeof token_name !== "string" || token_name.length === 0 || !isU8(decimals)) {
    return null;
  }
  let updateId: number | null = null;
  if (update_id !== undefined) {
    if (!Number.isSafeInteger(update_id) || (update_id as number) < 0) {
      return null;
    }
    updateId = update_id as number;
  }
  return { symbol: token_name, decimals, updateId };
}

/** Resolve the active fee from authoritative proxy data. Any ambiguity fails closed. */
export async function resolveClaimFee(
  network: string,
  source: FeeSource,
): Promise<FeeState> {
  let info: unknown;
  try {
    info = await source.networkInfo();
  } catch {
    return { kind: "unavailable" };
  }
  const data = isObject(info) ? info.data : undefined;
  if (!isObject(data) || data.network_id !== network) {
    return { kind: "unavailable" };
  }
  const fees = data.fees;
  if (
    !isObject(fees) ||
    typeof fees.default !== "string" ||
    !Array.isArray(fees.entries)
  ) {
    return { kind: "unavailable" };
  }
  // The existing Fast network contract uses an empty list for fee-free bootstrap.
  if (fees.entries.length === 0) return { kind: "none" };

  const defaultId = fees.default;
  if (!HEX64.test(defaultId)) return { kind: "unavailable" };
  const matchingEntries = fees.entries.filter(
    (candidate) => isObject(candidate) && candidate.token_id === defaultId,
  );
  if (matchingEntries.length !== 1) return { kind: "unavailable" };
  const [entry] = matchingEntries;
  if (!isObject(entry) || !validAmount(entry.fixed_amount)) {
    return { kind: "unavailable" };
  }
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

export function feeKey(network: string, state: FeeState): string {
  if (state.kind === "quoted") {
    const { tokenId, atomicAmount, decimals, symbol, updateId } = state;
    return `${network}|fee:${tokenId}:${atomicAmount}:${decimals}:${symbol}:${updateId ?? ""}`;
  }
  return `${network}|${state.kind}`;
}

export function feeTokenForState(state: FeeState): string | null {
  if (state.kind === "quoted") return state.tokenId;
  if (state.kind === "none") return null;
  throw new Error("Refusing to build a claim from an unavailable fee state; fail closed.");
}

export function formatFee(state: FeeState): string | null {
  if (state.kind !== "quoted") return null;
  const { atomicAmount, decimals, symbol } = state;
  if (decimals === 0) return `${atomicAmount} ${symbol}`;
  const padded = atomicAmount.padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals) || "0";
  const fraction =
    decimals > 0
      ? padded.slice(padded.length - decimals).replace(/0+$/, "")
      : "";
  return `${fraction ? `${whole}.${fraction}` : whole} ${symbol}`;
}

export function proxyFeeSource(
  proxyUrl: string,
  fetchImpl: typeof fetch = fetch,
): FeeSource {
  const gateway = toRestGateway(proxyUrl);
  const getJson = async (path: string): Promise<unknown> => {
    const response = await fetchImpl(`${gateway}${path}`, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`${path} ${response.status}`);
    return response.json();
  };
  return {
    networkInfo: () => getJson("/v1/network-info"),
    tokenMeta: (tokenId) =>
      getJson(`/v1/tokens?token_ids=${encodeURIComponent(tokenId)}`),
  };
}
