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
} from "@fastxyz/fast-sdk/core";
import { Context, Effect, Layer } from "effect";
import { NetworkError } from "../errors/index.js";
import { CliConfig } from "./cli-config.js";
import { NetworkConfigService } from "./network-config.js";

export interface FastRpcShape {
  readonly getAccountInfo: (
    params: GetAccountInfoParams,
  ) => Effect.Effect<unknown, NetworkError>;
  readonly submitTransaction: (
    params: TransactionEnvelope,
  ) => Effect.Effect<unknown, NetworkError>;
  readonly getTransactionCertificates: (
    params: GetTransactionCertificatesParams,
  ) => Effect.Effect<unknown, NetworkError>;
  readonly getTokenInfo: (
    params: GetTokenInfoParams,
  ) => Effect.Effect<unknown, NetworkError>;
  readonly getRpcUrl: () => Effect.Effect<string, NetworkError>;
}

export class FastRpc extends Context.Tag("FastRpc")<FastRpc, FastRpcShape>() {}

const mapNetworkError = <A, E>(
  effect: Effect.Effect<A, E>,
): Effect.Effect<A, NetworkError> =>
  effect.pipe(
    Effect.mapError((e) => new NetworkError({ message: String(e), cause: e })),
  );

export const FastRpcLive = Layer.effect(
  FastRpc,
  Effect.gen(function* () {
    const networkConfig = yield* NetworkConfigService;
    const config = yield* CliConfig;

    const getRpcUrl = () =>
      networkConfig.resolve(config.network).pipe(
        Effect.map((n) => n.rpcUrl),
        Effect.mapError(
          (e) => new NetworkError({ message: e.message, cause: e }),
        ),
      );

    return {
      getRpcUrl,

      getAccountInfo: (params) =>
        Effect.gen(function* () {
          const rpcUrl = yield* getRpcUrl();
          return yield* mapNetworkError(sdkGetAccountInfo(rpcUrl, params));
        }),

      submitTransaction: (params) =>
        Effect.gen(function* () {
          const rpcUrl = yield* getRpcUrl();
          return yield* mapNetworkError(sdkSubmitTransaction(rpcUrl, params));
        }),

      getTransactionCertificates: (params) =>
        Effect.gen(function* () {
          const rpcUrl = yield* getRpcUrl();
          return yield* mapNetworkError(
            sdkGetTransactionCertificates(rpcUrl, params),
          );
        }),

      getTokenInfo: (params) =>
        Effect.gen(function* () {
          const rpcUrl = yield* getRpcUrl();
          return yield* mapNetworkError(sdkGetTokenInfo(rpcUrl, params));
        }),
    };
  }),
);
