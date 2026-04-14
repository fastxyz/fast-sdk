import {
  AccountInfoResponseFromRest,
  AddressFromRest,
  bcsSchema,
  EscrowJobRecordFromRest,
  EscrowJobWithCertsFromRest,
  ProxySubmitTransactionResultFromRest,
  SignatureOrMultiSigFromBcs,
  TokenIdFromRest,
  TokenInfoResponseFromRest,
  TransactionCertificateFromRest,
  type TransactionEnvelope,
  TransactionEnvelopeFromRest,
  VersionedTransactionFromBcs,
} from "@fastxyz/schema";
import { Effect, Encoding, Schema } from "effect";
import * as bcs from "./crypto/bcs";
import { restCallEffect } from "./network/rest";

// ---------------------------------------------------------------------------
// Helpers – convert internal domain types to REST wire strings.
// We use `as never` to satisfy the Brand constraint at the call-site;
// the actual Uint8Array values always satisfy the schema at runtime.
// ---------------------------------------------------------------------------

const addressToStr = (addr: Uint8Array): string =>
  Schema.encodeSync(AddressFromRest)(addr as never);

const tokenIdToHex = (id: Uint8Array): string =>
  Schema.encodeSync(TokenIdFromRest)(id as never);

// ---------------------------------------------------------------------------
// POST /v1/submit-transaction
// ---------------------------------------------------------------------------

/** Submit a signed transaction envelope via `POST /v1/submit-transaction`. */
export const submitTransaction = (url: string, params: TransactionEnvelope) =>
  Effect.gen(function* () {
    // BCS-encode the VersionedTransaction → hex
    const bcsEncoded = yield* Schema.encode(VersionedTransactionFromBcs)(
      params.transaction,
    );
    const txBytes = yield* bcs.encode(
      bcsSchema.VersionedTransaction,
      bcsEncoded,
    );
    const txHex = Encoding.encodeHex(txBytes);

    // BCS-encode the SignatureOrMultiSig → hex
    const sigBcsEncoded = yield* Schema.encode(SignatureOrMultiSigFromBcs)(
      params.signature,
    );
    const sigBytes = yield* bcs.encode(
      bcsSchema.SignatureOrMultiSig,
      sigBcsEncoded,
    );
    const sigHex = Encoding.encodeHex(sigBytes);

    const result = yield* restCallEffect(url, {
      method: "POST",
      path: "/v1/submit-transaction",
      body: {
        transaction: txHex,
        signature: sigHex,
        witness_certificates: [],
      },
    });
    return yield* Schema.decodeUnknown(ProxySubmitTransactionResultFromRest)(
      result,
    );
  });

// ---------------------------------------------------------------------------
// POST /v1/faucet-drip
// ---------------------------------------------------------------------------

export interface FaucetDripParams {
  readonly recipient: Uint8Array;
  readonly amount: bigint;
  readonly tokenId: Uint8Array | null;
}

/** Request a faucet drip via `POST /v1/faucet-drip`. */
export const faucetDrip = (url: string, params: FaucetDripParams) =>
  Effect.gen(function* () {
    yield* restCallEffect(url, {
      method: "POST",
      path: "/v1/faucet-drip",
      body: {
        recipient: addressToStr(params.recipient),
        amount: params.amount.toString(),
        token_id: params.tokenId ? tokenIdToHex(params.tokenId) : undefined,
      },
    });
  });

// ---------------------------------------------------------------------------
// GET /v1/accounts/{address}
// ---------------------------------------------------------------------------

export interface GetAccountInfoParams {
  readonly address: Uint8Array;
  readonly tokenBalancesFilter: readonly Uint8Array[] | null;
  readonly stateKeyFilter: readonly Uint8Array[] | null;
}

/** Fetch account info via `GET /v1/accounts/{address}`. */
export const getAccountInfo = (url: string, params: GetAccountInfoParams) =>
  Effect.gen(function* () {
    const addr = addressToStr(params.address);
    const result = yield* restCallEffect(url, {
      method: "GET",
      path: `/v1/accounts/${addr}`,
      query: {
        token_balances_filter: params.tokenBalancesFilter
          ? params.tokenBalancesFilter.map(tokenIdToHex).join(",")
          : undefined,
        state_key_filter: params.stateKeyFilter
          ? params.stateKeyFilter.map((k) => Encoding.encodeHex(k)).join(",")
          : undefined,
      },
    });
    return yield* Schema.decodeUnknown(AccountInfoResponseFromRest)(result);
  });

// ---------------------------------------------------------------------------
// GET /v1/accounts/{address}/pending-multisig-transactions
// ---------------------------------------------------------------------------

export interface GetPendingMultisigParams {
  readonly address: Uint8Array;
}

/** Fetch pending multisig transactions via `GET /v1/accounts/{address}/pending-multisig-transactions`. */
export const getPendingMultisigTransactions = (
  url: string,
  params: GetPendingMultisigParams,
) =>
  Effect.gen(function* () {
    const addr = addressToStr(params.address);
    const result = yield* restCallEffect(url, {
      method: "GET",
      path: `/v1/accounts/${addr}/pending-multisig-transactions`,
    });
    return yield* Schema.decodeUnknown(
      Schema.Array(TransactionEnvelopeFromRest),
    )(result);
  });

// ---------------------------------------------------------------------------
// GET /v1/tokens
// ---------------------------------------------------------------------------

export interface GetTokenInfoParams {
  readonly tokenIds: readonly Uint8Array[];
}

/** Fetch token metadata via `GET /v1/tokens`. */
export const getTokenInfo = (url: string, params: GetTokenInfoParams) =>
  Effect.gen(function* () {
    const result = yield* restCallEffect(url, {
      method: "GET",
      path: "/v1/tokens",
      query: {
        token_ids: params.tokenIds.map(tokenIdToHex).join(","),
      },
    });
    return yield* Schema.decodeUnknown(TokenInfoResponseFromRest)(result);
  });

// ---------------------------------------------------------------------------
// GET /v1/accounts/{address}/certificates
// ---------------------------------------------------------------------------

export interface GetTransactionCertificatesParams {
  readonly address: Uint8Array;
  readonly fromNonce: bigint;
  readonly limit: number;
}

/** Fetch finalized transaction certificates via `GET /v1/accounts/{address}/certificates`. */
export const getTransactionCertificates = (
  url: string,
  params: GetTransactionCertificatesParams,
) =>
  Effect.gen(function* () {
    const addr = addressToStr(params.address);
    const result = yield* restCallEffect(url, {
      method: "GET",
      path: `/v1/accounts/${addr}/certificates`,
      query: {
        from_nonce: params.fromNonce.toString(),
        limit: params.limit.toString(),
      },
    });
    return yield* Schema.decodeUnknown(
      Schema.Array(TransactionCertificateFromRest),
    )(result);
  });

// ---------------------------------------------------------------------------
// GET /v1/escrow-jobs/{jobId}
// ---------------------------------------------------------------------------

export interface GetEscrowJobParams {
  readonly jobId: Uint8Array;
  readonly certs: boolean;
}

/** Fetch a single escrow job by ID via `GET /v1/escrow-jobs/{jobId}`. */
export const getEscrowJob = (url: string, params: GetEscrowJobParams) =>
  Effect.gen(function* () {
    const jobIdHex = tokenIdToHex(params.jobId);
    const result = yield* restCallEffect(url, {
      method: "GET",
      path: `/v1/escrow-jobs/${jobIdHex}`,
      query: { certs: params.certs ? "true" : undefined },
    });
    if (params.certs) {
      return yield* Schema.decodeUnknown(EscrowJobWithCertsFromRest)(result);
    }
    return yield* Schema.decodeUnknown(EscrowJobRecordFromRest)(result);
  });

// ---------------------------------------------------------------------------
// GET /v1/escrow-jobs
// ---------------------------------------------------------------------------

export interface GetEscrowJobsParams {
  readonly client?: Uint8Array;
  readonly provider?: Uint8Array;
  readonly evaluator?: Uint8Array;
  readonly status?: string;
  readonly certs: boolean;
}

/** Fetch escrow jobs by role filter via `GET /v1/escrow-jobs`. */
export const getEscrowJobs = (url: string, params: GetEscrowJobsParams) =>
  Effect.gen(function* () {
    const result = yield* restCallEffect(url, {
      method: "GET",
      path: "/v1/escrow-jobs",
      query: {
        client: params.client ? addressToStr(params.client) : undefined,
        provider: params.provider ? addressToStr(params.provider) : undefined,
        evaluator: params.evaluator
          ? addressToStr(params.evaluator)
          : undefined,
        status: params.status,
        certs: params.certs ? "true" : undefined,
      },
    });
    if (params.certs) {
      return yield* Schema.decodeUnknown(
        Schema.Array(EscrowJobWithCertsFromRest),
      )(result);
    }
    return yield* Schema.decodeUnknown(Schema.Array(EscrowJobRecordFromRest))(
      result,
    );
  });
