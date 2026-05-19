import { JSONParse, JSONStringify } from "json-with-bigint";
import { TransactionFailedError } from "../errors/index.js";
import type { RawTransactionEnvelope } from "./access-key-protocol.js";

export const DEFAULT_ACCESS_KEY_CLIENT_ID = "app.fast.xyz";
export const DEFAULT_ACCESS_KEY_EXPIRY_HOURS = 24 * 30;
export const DEFAULT_ACCESS_KEY_LABEL = "FAST CLI access key";
export const DEFAULT_ACCESS_KEY_MAX_TOTAL_SPEND_USDC = "250.00";
export const DEFAULT_ACCESS_KEY_TOKEN = "USDC";

export const nowNanos = (): bigint => BigInt(Date.now()) * 1_000_000n;

export const decimalToBaseUnits = (value: string, decimals: number): string => {
  const normalized = value.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new TransactionFailedError({
      message: `Invalid amount "${value}". Expected a positive decimal number.`,
    });
  }

  const [whole, fraction = ""] = normalized.split(".");
  if (fraction.length > decimals) {
    throw new TransactionFailedError({
      message: `Amount "${value}" has too many decimal places (max ${decimals}).`,
    });
  }

  const paddedFraction = fraction.padEnd(decimals, "0");
  const raw = `${whole}${paddedFraction}`.replace(/^0+/, "") || "0";
  if (BigInt(raw) <= 0n) {
    throw new TransactionFailedError({
      message: `Amount must be greater than zero (got "${value}").`,
    });
  }
  return raw;
};

export const statusForAccessKey = (record: {
  readonly capabilities: { readonly revoked: boolean };
  readonly policy: { readonly expiresAt: string | number | bigint | null };
}) => {
  if (record.capabilities.revoked) {
    return "revoked";
  }
  if (record.policy.expiresAt !== null) {
    const expiresAtMs = new Date(String(record.policy.expiresAt)).getTime();
    if (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) {
      return "expired";
    }
  }
  return "active";
};

export const formatBaseUnits = (value: string | number | bigint | null, decimals: number): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const raw = BigInt(value);
  const whole = raw / 10n ** BigInt(decimals);
  const fraction = raw % 10n ** BigInt(decimals);
  if (fraction === 0n) {
    return whole.toString();
  }
  return `${whole}.${fraction.toString().padStart(decimals, "0").replace(/0+$/, "")}`;
};

export const submitRawTransaction = async (
  rpcUrl: string,
  envelope: RawTransactionEnvelope,
): Promise<Record<string, unknown>> => {
  const body = JSONStringify({
    jsonrpc: "2.0",
    id: 1,
    method: "proxy_submitTransaction",
    params: envelope,
  });

  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });

  const text = await response.text();
  const json = JSONParse(text) as {
    result?: Record<string, unknown>;
    error?: { message?: string };
  };

  if (!response.ok || json.error) {
    throw new TransactionFailedError({
      message: json.error?.message ?? `FAST RPC submit failed (${response.status})`,
    });
  }

  return json.result ?? {};
};

export const extractSuccessCertificate = (
  result: Record<string, unknown>,
): Record<string, unknown> => {
  if ("Success" in result && result.Success && typeof result.Success === "object") {
    return result.Success as Record<string, unknown>;
  }
  throw new TransactionFailedError({
    message: `FAST RPC did not return a finalized certificate: ${JSONStringify(result)}`,
  });
};
