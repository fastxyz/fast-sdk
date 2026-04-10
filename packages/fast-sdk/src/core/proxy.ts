import {
  AccountInfoResponseFromRpc,
  type FaucetDripParams,
  FaucetDripParamsFromRpc,
  type GetAccountInfoParams,
  GetAccountInfoParamsFromRpc,
  type GetPendingMultisigParams,
  GetPendingMultisigParamsFromRpc,
  type GetTokenInfoParams,
  GetTokenInfoParamsFromRpc,
  type GetTransactionCertificatesParams,
  GetTransactionCertificatesParamsFromRpc,
  ProxySubmitTransactionResultFromRpc,
  SubmitTransactionParamsFromRpc,
  TokenInfoResponseFromRpc,
  TransactionCertificateFromRpc,
  type TransactionEnvelope,
  TransactionEnvelopeFromRpc,
} from "@fastxyz/schema";
import { Effect, Schema } from "effect";
import type { FastTransport } from "./network/transport";
import { rpcCallEffect } from "./network/rpc";

const requestEffect = (
  transport: FastTransport | undefined,
  rpcUrl: string,
  method: string,
  params: unknown,
): Effect.Effect<unknown, unknown, never> =>
  transport
    ? Effect.tryPromise({
        try: () => transport.request(rpcUrl, method, params),
        catch: (error) => error,
      })
    : (rpcCallEffect(rpcUrl, method, params) as Effect.Effect<
        unknown,
        unknown,
        never
      >);

/** Submit a signed transaction envelope via `proxy_submitTransaction`. */
export const submitTransaction = (
  transport: FastTransport | undefined,
  rpcUrl: string,
  params: TransactionEnvelope,
) =>
  Effect.gen(function* () {
    const wire = yield* Schema.encode(SubmitTransactionParamsFromRpc)(params);
    const result = yield* requestEffect(
      transport,
      rpcUrl,
      "proxy_submitTransaction",
      wire,
    );
    return yield* Schema.decodeUnknown(ProxySubmitTransactionResultFromRpc)(
      result,
    );
  });

/** Request a faucet drip via `proxy_faucetDrip`. */
export const faucetDrip = (
  transport: FastTransport | undefined,
  rpcUrl: string,
  params: FaucetDripParams,
) =>
  Effect.gen(function* () {
    const wire = yield* Schema.encode(FaucetDripParamsFromRpc)(params);
    yield* requestEffect(transport, rpcUrl, "proxy_faucetDrip", wire);
  });

/** Fetch account info via `proxy_getAccountInfo`. */
export const getAccountInfo = (
  transport: FastTransport | undefined,
  rpcUrl: string,
  params: GetAccountInfoParams,
) =>
  Effect.gen(function* () {
    const wire = yield* Schema.encode(GetAccountInfoParamsFromRpc)(params);
    const result = yield* requestEffect(
      transport,
      rpcUrl,
      "proxy_getAccountInfo",
      wire,
    );
    return yield* Schema.decodeUnknown(AccountInfoResponseFromRpc)(result);
  });

/** Fetch pending multisig transactions via `proxy_getPendingMultisigTransactions`. */
export const getPendingMultisigTransactions = (
  transport: FastTransport | undefined,
  rpcUrl: string,
  params: GetPendingMultisigParams,
) =>
  Effect.gen(function* () {
    const wire = yield* Schema.encode(GetPendingMultisigParamsFromRpc)(params);
    const result = yield* requestEffect(
      transport,
      rpcUrl,
      "proxy_getPendingMultisigTransactions",
      wire,
    );
    return yield* Schema.decodeUnknown(
      Schema.Array(TransactionEnvelopeFromRpc),
    )(result);
  });

/** Fetch token metadata via `proxy_getTokenInfo`. */
export const getTokenInfo = (
  transport: FastTransport | undefined,
  rpcUrl: string,
  params: GetTokenInfoParams,
) =>
  Effect.gen(function* () {
    const wire = yield* Schema.encode(GetTokenInfoParamsFromRpc)(params);
    const result = yield* requestEffect(transport, rpcUrl, "proxy_getTokenInfo", wire);
    return yield* Schema.decodeUnknown(TokenInfoResponseFromRpc)(result);
  });

/** Fetch finalized transaction certificates via `proxy_getTransactionCertificates`. */
export const getTransactionCertificates = (
  transport: FastTransport | undefined,
  rpcUrl: string,
  params: GetTransactionCertificatesParams,
) =>
  Effect.gen(function* () {
    const wire = yield* Schema.encode(GetTransactionCertificatesParamsFromRpc)(
      params,
    );
    const result = yield* requestEffect(
      transport,
      rpcUrl,
      "proxy_getTransactionCertificates",
      wire,
    );
    return yield* Schema.decodeUnknown(
      Schema.Array(TransactionCertificateFromRpc),
    )(result);
  });
