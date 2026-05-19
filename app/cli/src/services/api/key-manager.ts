import { Context, Effect, Layer } from "effect";
import { JSONParse, JSONStringify } from "json-with-bigint";
import { FastSdkError } from "../../errors/index.js";

export type AccessKeySource = "browser" | "cli" | "external";

export interface KeyManagerAccessKeyRecord {
  readonly accessKeyId: string;
  readonly accountAddress: string;
  readonly source?: AccessKeySource;
  readonly delegatePublicKey?: string;
  readonly label?: string;
  readonly createdAt?: string | number | bigint | null;
  readonly creation?: {
    readonly txHash: string;
    readonly certificate: Record<string, unknown>;
    readonly confirmedAt: string;
  };
  readonly revocation?: {
    readonly txHash: string;
    readonly certificate: Record<string, unknown>;
    readonly confirmedAt: string;
  };
  readonly policy: {
    readonly clientId: string;
    readonly expiresAt: string | number | bigint | null;
    readonly allowedOperations: string[];
    readonly allowedTokens: string[];
    readonly maxTotalSpend: string | number | bigint | null;
  };
  readonly capabilities: {
    readonly clientId: string;
    readonly expiresAt: string | number | bigint | null;
    readonly allowedOperations: string[];
    readonly allowedTokens: string[];
    readonly maxTotalSpend: string | number | bigint | null;
    readonly remainingTotalSpend: string | number | bigint | null;
    readonly revoked: boolean;
  };
}

export interface RegisterAccessKeyRequest {
  readonly ownerAccountAddress: string;
  readonly accessKeyId: string;
  readonly delegatePublicKey: string;
  readonly label?: string;
  readonly source: AccessKeySource;
  readonly txHash: string;
  readonly certificate: Record<string, unknown>;
  readonly policy: {
    readonly clientId: string;
    readonly expiresAt: string;
    readonly allowedOperations: string[];
    readonly allowedTokens: string[];
    readonly maxTotalSpend: string;
  };
}

export interface RegisterAccessKeyRevocationRequest {
  readonly ownerAccountAddress: string;
  readonly accessKeyId: string;
  readonly txHash: string;
  readonly certificate: Record<string, unknown>;
}

export interface KeyManagerApiShape {
  readonly baseUrl: string;
  readonly listAccessKeys: (
    ownerAccountAddress: string,
  ) => Effect.Effect<KeyManagerAccessKeyRecord[], FastSdkError>;
  readonly registerAccessKey: (
    body: RegisterAccessKeyRequest,
  ) => Effect.Effect<KeyManagerAccessKeyRecord, FastSdkError>;
  readonly registerAccessKeyRevocation: (
    body: RegisterAccessKeyRevocationRequest,
  ) => Effect.Effect<KeyManagerAccessKeyRecord, FastSdkError>;
}

export class KeyManagerApi extends Context.Tag("KeyManagerApi")<
  KeyManagerApi,
  KeyManagerApiShape
>() {}

const DEFAULT_KEY_MANAGER_URL = process.env.FAST_KEY_MANAGER_URL ?? "https://keys.fast.xyz";

const readJson = async <T>(response: Response): Promise<T> => {
  const text = await response.text();
  if (!text.trim()) {
    return {} as T;
  }
  return JSONParse(text) as T;
};

const requestJson = <T>(
  path: string,
  init?: RequestInit,
) =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(`${DEFAULT_KEY_MANAGER_URL}${path}`, init);
      if (!response.ok) {
        const body = await readJson<{ error?: string }>(response).catch(() => ({ error: response.statusText }));
        throw new Error(body.error ?? `Key manager request failed (${response.status})`);
      }
      return readJson<T>(response);
    },
    catch: (cause) =>
      cause instanceof FastSdkError
        ? cause
        : new FastSdkError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
  });

export const KeyManagerApiLive = Layer.succeed(KeyManagerApi, {
  baseUrl: DEFAULT_KEY_MANAGER_URL,
  listAccessKeys: (ownerAccountAddress: string) =>
    requestJson<KeyManagerAccessKeyRecord[]>(
      `/access-keys?ownerAccountAddress=${encodeURIComponent(ownerAccountAddress)}`,
    ),
  registerAccessKey: (body: RegisterAccessKeyRequest) =>
    requestJson<KeyManagerAccessKeyRecord>("/access-keys/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSONStringify(body),
    }),
  registerAccessKeyRevocation: (body: RegisterAccessKeyRevocationRequest) =>
    requestJson<KeyManagerAccessKeyRecord>("/access-keys/revoke/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSONStringify(body),
    }),
});
