import type {
  GetAccountInfoParams,
  GetTokenInfoParams,
  GetTransactionCertificatesParams,
  TransactionEnvelope,
} from "@fastxyz/fast-schema";
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

export const FastRpcLive = Layer.effect(
  FastRpc,
  Effect.gen(function* () {
    const networkConfig = yield* NetworkConfigService;
    const config = yield* ClientConfig;

    const getRpcUrl = () =>
      networkConfig.resolve(config.network).pipe(
        Effect.map((n) => n.rpcUrl),
        Effect.mapError(
          (e) => new FastSdkError({ message: e.message, cause: e }),
        ),
      );

    return {
      getRpcUrl,

      getAccountInfo: (params) =>
        Effect.gen(function* () {
          const rpcUrl = yield* getRpcUrl();
          return yield* mapFastSdkError(sdkGetAccountInfo(rpcUrl, params));
        }),

      submitTransaction: (params) =>
        Effect.gen(function* () {
          const rpcUrl = yield* getRpcUrl();
          return yield* mapFastSdkError(sdkSubmitTransaction(rpcUrl, params));
        }),

      getTransactionCertificates: (params) =>
        Effect.gen(function* () {
          const rpcUrl = yield* getRpcUrl();
          return yield* mapFastSdkError(
            sdkGetTransactionCertificates(rpcUrl, params),
          );
        }),

      getTokenInfo: (params) =>
        Effect.gen(function* () {
          const rpcUrl = yield* getRpcUrl();
          return yield* mapFastSdkError(sdkGetTokenInfo(rpcUrl, params));
        }),
    };
  }),
);
