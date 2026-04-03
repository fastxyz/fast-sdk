import {
  type AccountInfoResponse,
  FaucetDripInput,
  type FaucetDripInputParams,
  GetAccountInfoInput,
  type GetAccountInfoInputParams,
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
} from '@fastxyz/fast-schema';
import { Schema } from 'effect';
import * as proxy from '../core/proxy';
import { run } from '../core/run';

/** Options for constructing a {@link FastProvider}. */
export interface ProviderOptions {
  /** The URL of the Fast proxy JSON-RPC endpoint. */
  rpcUrl: string;
}

/**
 * Typed JSON-RPC provider for the Fast proxy API.
 *
 * Wraps the proxy's JSON-RPC methods with schema validation on both
 * inputs and outputs. All params are validated synchronously before
 * the network call; responses are decoded through Effect schemas.
 *
 * @example
 * ```ts
 * const provider = new FastProvider({ rpcUrl: "https://proxy.fast.xyz" });
 * const account = await provider.getAccountInfo({
 *   address: publicKey,
 *   tokenBalancesFilter: null,
 *   stateKeyFilter: null,
 *   certificateByNonce: null,
 * });
 * ```
 */
export class FastProvider {
  private readonly _rpcUrl: string;

  constructor(opts: ProviderOptions) {
    this._rpcUrl = opts.rpcUrl;
  }

  /** The proxy RPC URL this provider was constructed with. */
  get rpcUrl(): string {
    return this._rpcUrl;
  }

  /**
   * Submit a signed transaction envelope to the network.
   * The envelope should be produced by {@link TransactionBuilder.sign}.
   */
  async submitTransaction(params: TransactionEnvelope): Promise<SubmitTransactionResult> {
    return run(proxy.submitTransaction(this._rpcUrl, params));
  }

  /** Request a faucet drip for the given recipient. */
  async faucetDrip(params: FaucetDripInputParams): Promise<void> {
    const internal = Schema.decodeUnknownSync(FaucetDripInput)(params);
    return run(proxy.faucetDrip(this._rpcUrl, internal));
  }

  /**
   * Fetch account information including balance, nonce, token balances, and state.
   * Use filters to request specific token balances or state keys.
   */
  async getAccountInfo(params: GetAccountInfoInputParams): Promise<AccountInfoResponse> {
    const internal = Schema.decodeUnknownSync(GetAccountInfoInput)(params);
    return run(proxy.getAccountInfo(this._rpcUrl, internal));
  }

  /** Fetch pending multisig transactions for the given address. */
  async getPendingMultisigTransactions(params: GetPendingMultisigInputParams): Promise<readonly TransactionEnvelope[]> {
    const internal = Schema.decodeUnknownSync(GetPendingMultisigInput)(params);
    return run(proxy.getPendingMultisigTransactions(this._rpcUrl, internal));
  }

  /** Fetch metadata for one or more tokens by their IDs. */
  async getTokenInfo(params: GetTokenInfoInputParams): Promise<TokenInfoResponse> {
    const internal = Schema.decodeUnknownSync(GetTokenInfoInput)(params);
    return run(proxy.getTokenInfo(this._rpcUrl, internal));
  }

  /**
   * Fetch finalized transaction certificates for an address.
   * Results are paginated by nonce range.
   */
  async getTransactionCertificates(params: GetTransactionCertificatesInputParams): Promise<readonly TransactionCertificate[]> {
    const internal = Schema.decodeUnknownSync(GetTransactionCertificatesInput)(params);
    return run(proxy.getTransactionCertificates(this._rpcUrl, internal));
  }
}
