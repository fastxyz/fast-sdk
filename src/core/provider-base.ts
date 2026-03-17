import { FAST_DECIMALS, FAST_TOKEN_ID, hexToTokenId, tokenIdEquals, type FastTransaction } from './bcs.js';
import { bytesToPrefixedHex, bytesToHex, stripHexPrefix } from './bytes.js';
import { addressToPubkey } from './address.js';
import { FastError } from './errors.js';
import { fromHex } from './amounts.js';
import { rpcCall } from './rpc.js';
import type { ConfigSource } from '../config/source.js';
import type {
  FastAccountInfo,
  FastSubmitTransactionResult,
  FastNonceRange,
  FastTransactionEnvelope,
  FastTokenMetadata,
  FastTransactionCertificate,
  FastVersionedTransaction,
  KnownFastToken,
  NetworkType,
  ProviderOptions,
  TokenBalance,
  TokenInfo,
} from './types.js';

const HEX_TOKEN_PATTERN = /^(0x)?[0-9a-fA-F]+$/;

type FastTokenInfoResponse = {
  requested_token_metadata?: Array<[number[], FastTokenMetadata | null]>;
} | null;

function isNativeFastToken(token: string): boolean {
  return token.toUpperCase() === 'FAST';
}

function isNativeFastTokenId(token: string): boolean {
  return HEX_TOKEN_PATTERN.test(token) && tokenIdEquals(hexToTokenId(token), FAST_TOKEN_ID);
}

function tokenIdToHex(tokenId: number[] | Uint8Array): string {
  return bytesToHex(tokenId);
}

function toRpcVersionedTransaction(
  transaction: FastVersionedTransaction,
): { Release20260303: FastTransaction } {
  if (transaction && typeof transaction === 'object' && 'Release20260303' in transaction) {
    return transaction as { Release20260303: FastTransaction };
  }

  return { Release20260303: transaction as FastTransaction };
}

function getTransactionNonce(transaction: FastVersionedTransaction): bigint {
  const inner = 'Release20260303' in transaction ? transaction.Release20260303 : transaction;
  return BigInt(inner.nonce);
}

function isTransactionCertificate(value: unknown): value is FastTransactionCertificate {
  return Boolean(
    value
    && typeof value === 'object'
    && 'envelope' in value
    && 'signatures' in value,
  );
}

export class BaseFastProvider {
  private _rpcUrl: string;
  private _network: NetworkType;
  private _explorerUrl: string | null = null;
  private _explicitExplorerUrl = false;
  private _initialized = false;
  private _configSource: ConfigSource;

  constructor(opts: ProviderOptions | undefined, configSource: ConfigSource) {
    this._configSource = configSource;
    this._network = opts?.network ?? 'testnet';
    this._rpcUrl = opts?.rpcUrl ?? 'https://staging.proxy.fastset.xyz';

    if (opts?.explorerUrl !== undefined) {
      this._explorerUrl = opts.explorerUrl;
      this._explicitExplorerUrl = true;
    }

    if (opts?.rpcUrl) {
      this._explicitExplorerUrl = true;
      this._initialized = true;
    }
  }

  protected async init(): Promise<void> {
    if (this._initialized) return;

    const networkInfo = await this._configSource.getNetworkInfo(this._network);
    if (networkInfo?.rpc) {
      this._rpcUrl = networkInfo.rpc;
    }
    if (!this._explicitExplorerUrl) {
      this._explorerUrl = await this._configSource.getExplorerUrl(this._network);
    }
    this._initialized = true;
  }

  get rpcUrl(): string {
    return this._rpcUrl;
  }

  get network(): NetworkType {
    return this._network;
  }

  async getExplorerUrl(txHash?: string): Promise<string | null> {
    await this.init();
    if (!this._explorerUrl) return null;
    return txHash ? `${this._explorerUrl}/txs/${txHash}` : this._explorerUrl;
  }

  async resolveKnownToken(token: string): Promise<KnownFastToken | null> {
    return this._configSource.resolveKnownFastToken(token, this._network);
  }

  async getKnownTokens(): Promise<Record<string, KnownFastToken>> {
    return this._configSource.getAllTokens(this._network);
  }

  async getKnownNetworks(): Promise<Record<string, { rpc: string; explorer?: string }>> {
    return this._configSource.getAllNetworks();
  }

  async submitTransaction(
    envelope: FastTransactionEnvelope,
  ): Promise<FastSubmitTransactionResult> {
    await this.init();

    const result = await rpcCall(this._rpcUrl, 'proxy_submitTransaction', {
      transaction: toRpcVersionedTransaction(envelope.transaction),
      signature: envelope.signature,
    });

    if (isTransactionCertificate(result)) {
      return { Success: result };
    }

    if (result && typeof result === 'object') {
      if ('Success' in result || 'IncompleteVerifierSigs' in result || 'IncompleteMultiSig' in result) {
        return result as FastSubmitTransactionResult;
      }
    }

    throw new FastError('TX_FAILED', 'Unexpected proxy_submitTransaction result', {
      note: 'The proxy returned a result that does not match the documented submitTransaction variants.',
    });
  }

  async faucetDrip(params: {
    recipient: string;
    amount: string;
    token?: string;
  }): Promise<void> {
    await this.init();

    const recipient = this.requireAddress(params.recipient);
    const tokenId = await this.resolveRpcTokenId(params.token);
    await rpcCall(this._rpcUrl, 'proxy_faucetDrip', {
      recipient,
      amount: stripHexPrefix(params.amount),
      token_id: tokenId,
    });
  }

  async getBalance(address: string, token: string = 'FAST'): Promise<{ amount: string; token: string }> {
    await this.init();

    let pubkey: Uint8Array;
    try {
      pubkey = addressToPubkey(address);
    } catch {
      return { amount: '0', token };
    }

    const result = await this.fetchAccountInfo(pubkey);
    if (!result) return { amount: '0', token };

    if (isNativeFastToken(token) || isNativeFastTokenId(token)) {
      const hexBalance = result.balance ?? '0';
      return { amount: fromHex(hexBalance, FAST_DECIMALS), token: 'FAST' };
    }

    if (HEX_TOKEN_PATTERN.test(token)) {
      const tokenIdBytes = hexToTokenId(token);
      const entry = result.token_balance?.find(([tid]) => tokenIdEquals(tid, tokenIdBytes));
      if (!entry) return { amount: '0', token };
      const [, bal] = entry;
      const metadata = await this.fetchTokenMetadata([tokenIdBytes]);
      const decimals = metadata.get(tokenIdToHex(tokenIdBytes))?.decimals ?? FAST_DECIMALS;
      return { amount: fromHex(stripHexPrefix(bal), decimals), token };
    }

    const known = await this.resolveKnownToken(token);
    if (known && known.tokenId !== 'native') {
      const tokenIdBytes = hexToTokenId(known.tokenId);
      const entry = result.token_balance?.find(([tid]) => tokenIdEquals(tid, tokenIdBytes));
      if (!entry) return { amount: '0', token: known.symbol };
      const [, bal] = entry;
      const metadata = await this.fetchTokenMetadata([tokenIdBytes]);
      const decimals = metadata.get(tokenIdToHex(tokenIdBytes))?.decimals ?? known.decimals;
      return { amount: fromHex(stripHexPrefix(bal), decimals), token: known.symbol };
    }

    return { amount: '0', token };
  }

  async getTokens(address: string): Promise<TokenBalance[]> {
    await this.init();

    let pubkey: Uint8Array;
    try {
      pubkey = addressToPubkey(address);
    } catch {
      return [];
    }

    const result = await this.fetchAccountInfo(pubkey);
    if (!result) return [];

    const tokens: TokenBalance[] = [];

    if (result.balance) {
      tokens.push({
        symbol: 'FAST',
        tokenId: 'native',
        balance: fromHex(result.balance, FAST_DECIMALS),
        decimals: FAST_DECIMALS,
      });
    }

    if (result.token_balance && result.token_balance.length > 0) {
      const tokenIds = result.token_balance.map(([tid]) => new Uint8Array(tid));
      const metadata = await this.fetchTokenMetadata(tokenIds);

      for (const [tid, bal] of result.token_balance) {
        const tidHex = tokenIdToHex(tid);
        const meta = metadata.get(tidHex);
        const decimals = meta?.decimals ?? FAST_DECIMALS;

        tokens.push({
          symbol: meta?.token_name ?? `${tidHex.slice(0, 8)}...`,
          tokenId: `0x${tidHex}`,
          balance: fromHex(stripHexPrefix(bal), decimals),
          decimals,
        });
      }
    }

    return tokens;
  }

  async getTokenInfo(token: string): Promise<TokenInfo | null> {
    await this.init();

    if (isNativeFastToken(token) || isNativeFastTokenId(token)) {
      const known = await this.resolveKnownToken('FAST');
      return {
        name: 'FAST',
        symbol: 'FAST',
        tokenId: 'native',
        decimals: known?.decimals ?? FAST_DECIMALS,
      };
    }

    let tokenIdBytes: Uint8Array;
    if (HEX_TOKEN_PATTERN.test(token)) {
      tokenIdBytes = hexToTokenId(token);
    } else {
      const known = await this.resolveKnownToken(token);
      if (known && known.tokenId !== 'native') {
        tokenIdBytes = hexToTokenId(known.tokenId);
      } else {
        return null;
      }
    }

    const metadata = await this.fetchTokenMetadata([tokenIdBytes]);
    const tidHex = tokenIdToHex(tokenIdBytes);
    const meta = metadata.get(tidHex);
    if (!meta) return null;

    return {
      name: meta.token_name ?? tidHex,
      symbol: meta.token_name ?? tidHex.slice(0, 8),
      tokenId: `0x${tidHex}`,
      decimals: meta.decimals ?? FAST_DECIMALS,
      totalSupply: meta.total_supply,
      admin: meta.admin ? bytesToPrefixedHex(meta.admin) : undefined,
      minters: meta.mints?.map((minter) => bytesToPrefixedHex(minter)),
    };
  }

  async getAccountInfo(address: string): Promise<FastAccountInfo> {
    await this.init();

    let pubkey: Uint8Array;
    try {
      pubkey = addressToPubkey(address);
    } catch {
      return null;
    }

    return this.fetchAccountInfo(pubkey);
  }

  async getTransactionCertificates(
    address: string,
    fromNonce: number,
    limit: number,
  ): Promise<FastTransactionCertificate[]> {
    await this.init();

    if (!Number.isInteger(fromNonce) || fromNonce < 0) {
      throw new FastError('INVALID_PARAMS', `Invalid nonce: ${fromNonce}`, {
        note: 'Pass a non-negative integer nonce.',
      });
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new FastError('INVALID_PARAMS', `Invalid certificate limit: ${limit}`, {
        note: 'Pass an integer limit between 1 and 200.',
      });
    }

    const pubkey = this.requireAddress(address);
    return (await rpcCall(this._rpcUrl, 'proxy_getTransactionCertificates', {
      address: pubkey,
      from_nonce: fromNonce,
      limit,
    })) as FastTransactionCertificate[];
  }

  async getCertificateByNonce(
    address: string,
    nonce: number,
  ): Promise<FastTransactionCertificate | null> {
    await this.init();

    const certificates = await this.getTransactionCertificates(address, nonce, 1);
    const certificate = certificates[0];
    if (!certificate) {
      return null;
    }

    return getTransactionNonce(certificate.envelope.transaction) === BigInt(nonce)
      ? certificate
      : null;
  }

  private async fetchAccountInfo(
    pubkey: Uint8Array,
    opts?: { certificateByNonce?: FastNonceRange | null },
  ): Promise<FastAccountInfo> {
    return (await rpcCall(this._rpcUrl, 'proxy_getAccountInfo', {
      address: pubkey,
      token_balances_filter: [],
      state_key_filter: null,
      certificate_by_nonce: opts?.certificateByNonce ?? null,
    })) as FastAccountInfo;
  }

  private async fetchTokenMetadata(tokenIds: Uint8Array[]): Promise<Map<string, FastTokenMetadata>> {
    const uniq = new Map<string, Uint8Array>();
    for (const tokenId of tokenIds) {
      const key = tokenIdToHex(tokenId);
      if (!uniq.has(key)) {
        uniq.set(key, tokenId);
      }
    }
    if (uniq.size === 0) {
      return new Map();
    }

    const result = (await rpcCall(this._rpcUrl, 'proxy_getTokenInfo', {
      token_ids: [...uniq.values()],
    })) as FastTokenInfoResponse;

    const metadata = new Map<string, FastTokenMetadata>();
    for (const [tokenId, meta] of result?.requested_token_metadata ?? []) {
      if (meta) {
        metadata.set(tokenIdToHex(tokenId), meta);
      }
    }
    return metadata;
  }

  protected assertInitialized(): void {
    if (!this._initialized) {
      throw new FastError('UNSUPPORTED_OPERATION', 'Provider is not initialized');
    }
  }

  private requireAddress(address: string): Uint8Array {
    try {
      return addressToPubkey(address);
    } catch {
      throw new FastError('INVALID_ADDRESS', `Invalid Fast address: "${address}"`, {
        note: 'Pass a valid fast1... bech32m address.',
      });
    }
  }

  private async resolveRpcTokenId(token?: string): Promise<Uint8Array | null> {
    if (!token || isNativeFastToken(token) || isNativeFastTokenId(token)) {
      return null;
    }

    if (HEX_TOKEN_PATTERN.test(token)) {
      return hexToTokenId(token);
    }

    const known = await this.resolveKnownToken(token);
    if (!known) {
      throw new FastError('TOKEN_NOT_FOUND', `Token "${token}" not found`, {
        note: 'Use a known token symbol or pass a valid hex token ID.',
      });
    }

    if (known.tokenId === 'native') {
      return null;
    }

    return hexToTokenId(known.tokenId);
  }
}
