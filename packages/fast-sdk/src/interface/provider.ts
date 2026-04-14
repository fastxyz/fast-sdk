import {
  type AccountInfoResponse,
  type EscrowJobRecord,
  type EscrowJobWithCerts,
  FaucetDripInput,
  type FaucetDripInputParams,
  GetAccountInfoInput,
  type GetAccountInfoInputParams,
  GetEscrowJobInput,
  type GetEscrowJobInputParams,
  GetEscrowJobsInput,
  type GetEscrowJobsInputParams,
  GetPendingMultisigInput,
  type GetPendingMultisigInputParams,
  GetTokenInfoInput,
  type GetTokenInfoInputParams,
  GetTransactionCertificatesInput,
  type GetTransactionCertificatesInputParams,
  type SubmitTransactionResult,
  type TokenInfoResponse,
  type TransactionCertificate,
  type TransactionEnvelope,
} from "@fastxyz/schema";
import { Schema } from "effect";
import * as proxy from "../core/proxy";
import { run } from "../core/run";

/** Options for constructing a {@link FastProvider}. */
export interface ProviderOptions {
  /** The base URL of the Fast proxy REST API. */
  url: string;
}

/**
 * Typed REST provider for the Fast proxy API.
 *
 * Wraps the proxy's REST endpoints with schema validation on both
 * inputs and outputs. All params are validated synchronously before
 * the network call; responses are decoded through Effect schemas.
 *
 * @example
 * ```ts
 * const provider = new FastProvider({ url: "https://proxy.fast.xyz" });
 * const account = await provider.getAccountInfo({
 *   address: publicKey,
 *   tokenBalancesFilter: null,
 *   stateKeyFilter: null,
 * });
 * ```
 */
export class FastProvider {
  private readonly _url: string;

  constructor(opts: ProviderOptions) {
    this._url = opts.url;
  }

  /** The proxy base URL this provider was constructed with. */
  get url(): string {
    return this._url;
  }

  /**
   * Submit a signed transaction envelope to the network.
   * The envelope should be produced by {@link TransactionBuilder.sign}.
   */
  async submitTransaction(
    params: TransactionEnvelope,
  ): Promise<SubmitTransactionResult> {
    return run(proxy.submitTransaction(this._url, params));
  }

  /** Request a faucet drip for the given recipient. */
  async faucetDrip(params: FaucetDripInputParams): Promise<void> {
    const internal = Schema.decodeUnknownSync(FaucetDripInput)(params);
    return run(proxy.faucetDrip(this._url, internal));
  }

  /**
   * Fetch account information including balance, nonce, token balances, and state.
   * Use filters to request specific token balances or state keys.
   */
  async getAccountInfo(
    params: GetAccountInfoInputParams,
  ): Promise<AccountInfoResponse> {
    const internal = Schema.decodeUnknownSync(GetAccountInfoInput)(params);
    return run(proxy.getAccountInfo(this._url, internal));
  }

  /** Fetch pending multisig transactions for the given address. */
  async getPendingMultisigTransactions(
    params: GetPendingMultisigInputParams,
  ): Promise<readonly TransactionEnvelope[]> {
    const internal = Schema.decodeUnknownSync(GetPendingMultisigInput)(params);
    return run(proxy.getPendingMultisigTransactions(this._url, internal));
  }

  /** Fetch metadata for one or more tokens by their IDs. */
  async getTokenInfo(
    params: GetTokenInfoInputParams,
  ): Promise<TokenInfoResponse> {
    const internal = Schema.decodeUnknownSync(GetTokenInfoInput)(params);
    return run(proxy.getTokenInfo(this._url, internal));
  }

  /**
   * Fetch finalized transaction certificates for an address.
   * Results are paginated by nonce range.
   */
  async getTransactionCertificates(
    params: GetTransactionCertificatesInputParams,
  ): Promise<readonly TransactionCertificate[]> {
    const internal = Schema.decodeUnknownSync(GetTransactionCertificatesInput)(
      params,
    );
    return run(proxy.getTransactionCertificates(this._url, internal));
  }

  /** Fetch a single escrow job by ID, optionally including certificates. */
  async getEscrowJob(
    params: GetEscrowJobInputParams,
  ): Promise<EscrowJobRecord | EscrowJobWithCerts> {
    const internal = Schema.decodeUnknownSync(GetEscrowJobInput)(params);
    return run(proxy.getEscrowJob(this._url, internal));
  }

  /**
   * List escrow jobs filtered by role (client, provider, or evaluator).
   * Optionally filter by status and include certificates.
   */
  async getEscrowJobs(
    params: GetEscrowJobsInputParams,
  ): Promise<readonly (EscrowJobRecord | EscrowJobWithCerts)[]> {
    const internal = Schema.decodeUnknownSync(GetEscrowJobsInput)(params);
    return run(proxy.getEscrowJobs(this._url, internal));
  }
}
