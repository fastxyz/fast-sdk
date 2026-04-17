import type {
  GetAccountInfoParams,
  GetTokenInfoParams,
  GetTransactionCertificatesParams,
  TransactionEnvelope,
} from "@fastxyz/schema";
import {
  getAccountInfo as sdkGetAccountInfo,
  getTokenInfo as sdkGetTokenInfo,
  getTransactionCertificates as sdkGetTransactionCertificates,
  submitTransaction as sdkSubmitTransaction,
} from "@fastxyz/sdk/core";
import { Context, Effect, Layer } from "effect";
import { FastSdkError } from "../../errors/index.js";
import { ClientConfig } from "../config/client.js";
import { NetworkConfigService } from "../storage/network.js";

export interface FastRpcShape {
  readonly getAccountInfo: (
    params: GetAccountInfoParams,
  ) => Effect.Effect<unknown, FastSdkError>;
  readonly submitTransaction: (
    params: TransactionEnvelope,
  ) => Effect.Effect<unknown, FastSdkError>;
  readonly getTransactionCertificates: (
    params: GetTransactionCertificatesParams,
  ) => Effect.Effect<unknown, FastSdkError>;
  readonly getTokenInfo: (
    params: GetTokenInfoParams,
  ) => Effect.Effect<unknown, FastSdkError>;
  readonly getRpcUrl: () => Effect.Effect<string, FastSdkError>;
}

export class FastRpc extends Context.Tag("FastRpc")<FastRpc, FastRpcShape>() {}

const mapFastSdkError = <A, E>(
  effect: Effect.Effect<A, E>,
): Effect.Effect<A, FastSdkError> => {
  const error = (e: E) =>
    e instanceof Error
      ? new FastSdkError({ message: e.message, cause: e })
      : new FastSdkError({ message: String(e) });
  return effect.pipe(Effect.mapError((e) => error(e)));
};

const debugLog = (debug: boolean, label: string, data: unknown): void => {
  if (!debug) return;
  const text = JSON.stringify(
    data,
    (_, v) =>
      typeof v === "bigint"
        ? v.toString()
        : v instanceof Uint8Array
          ? `0x${Array.from(v).map((b) => b.toString(16).padStart(2, "0")).join("")}`
          : v,
    2,
  );
  process.stderr.write(`[debug] ${label}:\n${text}\n`);
};

export const FastRpcLive = Layer.effect(
  FastRpc,
  Effect.gen(function* () {
    const networkConfig = yield* NetworkConfigService;
    const config = yield* ClientConfig;

    const getRpcUrl = () =>
      networkConfig.resolve(config.network).pipe(
        Effect.map((n) => {
          if (config.debug) process.stderr.write(`[debug] url: ${n.url}\n`);
          return n.url;
        }),
        Effect.mapError(
          (e) => new FastSdkError({ message: e.message, cause: e }),
        ),
      );

    return {
      getRpcUrl,

      getAccountInfo: (params) =>
        Effect.gen(function* () {
          const rpcUrl = yield* getRpcUrl();
          debugLog(config.debug, "getAccountInfo >", params);
          const result = yield* mapFastSdkError(sdkGetAccountInfo(rpcUrl, params));
          debugLog(config.debug, "getAccountInfo <", result);
          return result;
        }),

      submitTransaction: (params) =>
        Effect.gen(function* () {
          const rpcUrl = yield* getRpcUrl();
          debugLog(config.debug, "submitTransaction >", params);
          const result = yield* mapFastSdkError(sdkSubmitTransaction(rpcUrl, params));
          debugLog(config.debug, "submitTransaction <", result);
          return result;
        }),

      getTransactionCertificates: (params) =>
        Effect.gen(function* () {
          const rpcUrl = yield* getRpcUrl();
          debugLog(config.debug, "getTransactionCertificates >", params);
          const result = yield* mapFastSdkError(
            sdkGetTransactionCertificates(rpcUrl, params),
          );
          debugLog(config.debug, "getTransactionCertificates <", result);
          return result;
        }),

      getTokenInfo: (params) =>
        Effect.gen(function* () {
          const rpcUrl = yield* getRpcUrl();
          debugLog(config.debug, "getTokenInfo >", params);
          const result = yield* mapFastSdkError(sdkGetTokenInfo(rpcUrl, params));
          debugLog(config.debug, "getTokenInfo <", result);
          return result;
        }),
    };
  }),
);
