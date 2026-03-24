import {
  FAST_DECIMALS,
  FAST_NETWORK_IDS,
  FAST_TOKEN_ID,
  hexToTokenId,
  serializeVersionedTransaction,
  tokenIdEquals,
  type FastTransaction,
} from './bcs.js';
import { bytesToPrefixedHex, bytesToHex, stripHexPrefix } from './bytes.js';
import { fastAddressToBytes } from './address.js';
import { FastError } from './errors.js';
import { fromHex } from './amounts.js';
import { rpcCall } from './rpc.js';
import type { ConfigSource } from '../config/source.js';
import type {
  FastAccountInfo,
  FastSubmitTransactionResult,
  FastNonceRange,
  FastNetworkId,
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
const FAST_ID_BYTES = 32;
const ED25519_SIGNATURE_BYTES = 64;
const FAST_TRANSACTION_KEYS = [
  'network_id',
  'sender',
  'nonce',
  'timestamp_nanos',
  'claim',
  'archival',
  'fee_token',
] as const;
const VERSIONED_TRANSACTION_KEYS = ['Release20260319'] as const;
const ENVELOPE_KEYS = ['transaction', 'signature'] as const;
const CERTIFICATE_KEYS = ['envelope', 'signatures'] as const;
const MULTISIG_KEYS = ['config', 'signatures'] as const;
const MULTISIG_CONFIG_KEYS = ['authorized_signers', 'quorum', 'nonce'] as const;
const SIGNATURE_OBJECT_KEYS = ['Signature', 'MultiSig'] as const;
const TOKEN_METADATA_KEYS = ['update_id', 'admin', 'token_name', 'decimals', 'total_supply', 'mints'] as const;
const TOKEN_INFO_RESPONSE_KEYS = ['requested_token_metadata'] as const;
const ACCOUNT_INFO_KEYS = ['balance', 'token_balance', 'next_nonce', 'requested_certificates'] as const;

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

function assertSerializableTransactionInput(transaction: FastTransaction): void {
  try {
    serializeVersionedTransaction(transaction);
  } catch {
    throw new FastError('INVALID_PARAMS', 'Invalid transaction envelope.transaction shape', {
      note: 'Pass a Release20260319 transaction that matches the documented Fast claim schema.',
    });
  }
}

function toRpcVersionedTransaction(
  transaction: FastVersionedTransaction,
): { Release20260319: FastTransaction } {
  if (!isRecord(transaction)) {
    throw new FastError('INVALID_PARAMS', 'Invalid transaction envelope.transaction shape', {
      note: 'Pass a bare transaction object or { Release20260319: transaction }.',
    });
  }

  if ('Release20260319' in transaction) {
    if (!hasExactKeys(transaction, VERSIONED_TRANSACTION_KEYS)) {
      throw new FastError('INVALID_PARAMS', 'Invalid transaction envelope.transaction shape', {
        note: 'Pass either a bare transaction object or { Release20260319: transaction }, but not both.',
      });
    }
    if (!isRecord(transaction.Release20260319) || !hasExactKeys(transaction.Release20260319, FAST_TRANSACTION_KEYS)) {
      throw new FastError('INVALID_PARAMS', 'Invalid transaction envelope.transaction shape', {
        note: 'Pass a wrapped Release20260319 transaction with only the documented Fast transaction fields.',
      });
    }
    assertSerializableTransactionInput(transaction.Release20260319 as FastTransaction);
    return { Release20260319: transaction.Release20260319 as FastTransaction };
  }

  if (!hasExactKeys(transaction, FAST_TRANSACTION_KEYS)) {
    throw new FastError('INVALID_PARAMS', 'Invalid transaction envelope.transaction shape', {
      note: 'Pass a bare transaction object with only the documented Fast transaction fields.',
    });
  }
  assertSerializableTransactionInput(transaction as FastTransaction);

  return { Release20260319: transaction as FastTransaction };
}

function isRpcMultiSigInputShape(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, MULTISIG_KEYS) || !('config' in value) || !isRecord(value.config)) {
    return false;
  }

  return hasExactKeys(value.config, MULTISIG_CONFIG_KEYS)
    && isAddressMatrix(value.config.authorized_signers)
    && isNonNegativeSafeInteger(value.config.quorum)
    && isNonNegativeSafeInteger(value.config.nonce)
    && isSignaturePairs(value.signatures);
}

function toRpcEnvelopeSignature(signature: FastTransactionEnvelope['signature']): FastTransactionEnvelope['signature'] {
  if (Array.isArray(signature)) {
    if (!isSignatureLike(signature)) {
      throw new FastError('INVALID_PARAMS', 'Invalid transaction envelope.signature shape', {
        note: 'Pass a 64-byte signature, { Signature }, or { MultiSig }.',
      });
    }
    return signature;
  }
  if (!isRecord(signature)) {
    throw new FastError('INVALID_PARAMS', 'Invalid transaction envelope.signature shape', {
      note: 'Pass a 64-byte signature, { Signature }, or { MultiSig }.',
    });
  }

  const hasSignature = 'Signature' in signature && signature.Signature !== undefined;
  const hasMultiSig = 'MultiSig' in signature && signature.MultiSig !== undefined;
  if (!hasOnlyKnownKeys(signature, SIGNATURE_OBJECT_KEYS) || (hasSignature ? 1 : 0) + (hasMultiSig ? 1 : 0) !== 1) {
    throw new FastError('INVALID_PARAMS', 'Invalid transaction envelope.signature shape', {
      note: 'Pass signature bytes, { Signature }, or { MultiSig }, but not mixed signature variants.',
    });
  }

  if (hasSignature) {
    if (!isSignatureLike(signature.Signature)) {
      throw new FastError('INVALID_PARAMS', 'Invalid transaction envelope.signature shape', {
        note: 'Pass a 64-byte signature, { Signature }, or { MultiSig }.',
      });
    }
    return { Signature: signature.Signature as number[] };
  }
  if ('MultiSig' in signature) {
    if (!isRpcMultiSigInputShape(signature.MultiSig)) {
      throw new FastError('INVALID_PARAMS', 'Invalid transaction envelope.signature shape', {
        note: 'Pass a multisig signature object with valid signer ids, safe integer config values, and fixed-width signatures.',
      });
    }
    return { MultiSig: signature.MultiSig } as FastTransactionEnvelope['signature'];
  }

  throw new FastError('INVALID_PARAMS', 'Invalid transaction envelope.signature shape', {
    note: 'Pass a 64-byte signature, { Signature }, or { MultiSig }.',
  });
}

function getTransactionNonce(transaction: FastVersionedTransaction): bigint {
  const inner = 'Release20260319' in transaction ? transaction.Release20260319 : transaction;
  return BigInt(inner.nonce);
}

function inferFastNetworkId(network: string): FastNetworkId | null {
  switch (network) {
    case 'localnet':
      return FAST_NETWORK_IDS.LOCALNET;
    case 'devnet':
      return FAST_NETWORK_IDS.DEVNET;
    case 'testnet':
      return FAST_NETWORK_IDS.TESTNET;
    case 'mainnet':
      return FAST_NETWORK_IDS.MAINNET;
    default:
      return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isHexAmountString(value: unknown): value is string {
  return typeof value === 'string' && /^(0x)?[0-9a-fA-F]*$/.test(value);
}

function isByteArrayLike(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => (
    typeof item === 'number'
    && Number.isInteger(item)
    && item >= 0
    && item <= 255
  ));
}

function isByteMatrix(value: unknown): value is number[][] {
  return Array.isArray(value) && value.every((entry) => isByteArrayLike(entry));
}

function isFixedLengthByteArray(value: unknown, length: number): value is number[] {
  return isByteArrayLike(value) && value.length === length;
}

function isFixedLengthByteMatrix(value: unknown, length: number): value is number[][] {
  return Array.isArray(value) && value.every((entry) => isFixedLengthByteArray(entry, length));
}

function isTokenIdLike(value: unknown): value is number[] {
  return isFixedLengthByteArray(value, FAST_ID_BYTES);
}

function isAddressLike(value: unknown): value is number[] {
  return isFixedLengthByteArray(value, FAST_ID_BYTES);
}

function isAddressMatrix(value: unknown): value is number[][] {
  return isFixedLengthByteMatrix(value, FAST_ID_BYTES);
}

function isSignatureLike(value: unknown): value is number[] {
  return isFixedLengthByteArray(value, ED25519_SIGNATURE_BYTES);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0;
}

function isNonNegativeIntegerLike(value: unknown): boolean {
  return (typeof value === 'number' && isNonNegativeSafeInteger(value))
    || (typeof value === 'bigint' && value >= 0n);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length
    && actualKeys.every((key) => keys.includes(key));
}

function hasOnlyKnownKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function hasExactTransactionScalars(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number' || typeof value === 'bigint') {
    return isNonNegativeIntegerLike(value);
  }
  if (Array.isArray(value)) {
    if (value.every((entry) => typeof entry === 'number')) {
      return isByteArrayLike(value);
    }
    return value.every((entry) => hasExactTransactionScalars(entry));
  }
  if (isRecord(value)) {
    return Object.values(value).every((entry) => hasExactTransactionScalars(entry));
  }
  return false;
}

function isFastTransactionShape(value: unknown): value is FastTransaction {
  if (!isRecord(value)) return false;
  if (!hasExactKeys(value, FAST_TRANSACTION_KEYS)) return false;
  if (!hasExactTransactionScalars(value)) return false;

  try {
    serializeVersionedTransaction(value as FastTransaction);
    return true;
  } catch {
    return false;
  }
}

function isVersionedTransactionShape(value: unknown): value is FastVersionedTransaction {
  if (!isRecord(value)) return false;
  if ('Release20260319' in value) {
    return hasExactKeys(value, ['Release20260319'])
      && isFastTransactionShape(value.Release20260319);
  }
  return isFastTransactionShape(value);
}

function isMultiSigShape(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!hasExactKeys(value, MULTISIG_KEYS) || !('config' in value) || !isRecord(value.config)) return false;

  const config = value.config;
  if (!hasExactKeys(config, MULTISIG_CONFIG_KEYS)) {
    return false;
  }
  if (!('authorized_signers' in config) || !isAddressMatrix(config.authorized_signers)) {
    return false;
  }
  if (!('quorum' in config) || !isNonNegativeSafeInteger(config.quorum)) {
    return false;
  }
  if (!('nonce' in config) || !isNonNegativeSafeInteger(config.nonce)) {
    return false;
  }
  if (!('signatures' in value) || !isSignaturePairs(value.signatures)) {
    return false;
  }

  return true;
}

function isEnvelopeSignatureShape(value: unknown): boolean {
  if (isSignatureLike(value)) return true;
  if (!isRecord(value)) return false;
  if (!hasOnlyKnownKeys(value, SIGNATURE_OBJECT_KEYS)) return false;

  const hasSignature = 'Signature' in value && value.Signature !== undefined;
  const hasMultiSig = 'MultiSig' in value && value.MultiSig !== undefined;
  if ((hasSignature ? 1 : 0) + (hasMultiSig ? 1 : 0) !== 1) {
    return false;
  }

  if (hasSignature) {
    return isSignatureLike(value.Signature);
  }
  return isMultiSigShape(value.MultiSig);
}

function isSignaturePairs(value: unknown): value is Array<[number[], number[]]> {
  return Array.isArray(value)
    && value.every((pair) => (
      Array.isArray(pair)
      && pair.length === 2
      && isAddressLike(pair[0])
      && isSignatureLike(pair[1])
    ));
}

function isTransactionCertificate(value: unknown): value is FastTransactionCertificate {
  if (!isRecord(value) || !hasExactKeys(value, CERTIFICATE_KEYS) || !('envelope' in value) || !('signatures' in value)) {
    return false;
  }

  const envelope = value.envelope;
  if (!isRecord(envelope) || !hasExactKeys(envelope, ENVELOPE_KEYS)) return false;

  return (
    'transaction' in envelope
    && isVersionedTransactionShape(envelope.transaction)
    && 'signature' in envelope
    && isEnvelopeSignatureShape(envelope.signature)
    && isSignaturePairs(value.signatures)
  );
}

function isFastTokenMetadataShape(value: unknown): value is FastTokenMetadata {
  if (!isRecord(value)) return false;
  if (!hasOnlyKnownKeys(value, TOKEN_METADATA_KEYS)) return false;

  if ('update_id' in value && value.update_id !== undefined && !isNonNegativeSafeInteger(value.update_id)) {
    return false;
  }
  if ('admin' in value && value.admin !== undefined && !isAddressLike(value.admin)) {
    return false;
  }
  if ('token_name' in value && value.token_name !== undefined && typeof value.token_name !== 'string') {
    return false;
  }
  if ('decimals' in value && value.decimals !== undefined) {
    if (!isNonNegativeSafeInteger(value.decimals) || value.decimals > 255) {
      return false;
    }
  }
  if ('total_supply' in value && value.total_supply !== undefined && typeof value.total_supply !== 'string') {
    return false;
  }
  if ('mints' in value && value.mints !== undefined && !isAddressMatrix(value.mints)) {
    return false;
  }

  return true;
}

function isTokenInfoResponseShape(value: unknown): value is FastTokenInfoResponse {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  if (!hasOnlyKnownKeys(value, TOKEN_INFO_RESPONSE_KEYS)) return false;

  if ('requested_token_metadata' in value && value.requested_token_metadata !== undefined) {
    if (!Array.isArray(value.requested_token_metadata)) {
      return false;
    }

    const validRequestedMetadata = value.requested_token_metadata.every((entry) => (
      Array.isArray(entry)
      && entry.length === 2
      && isTokenIdLike(entry[0])
      && (entry[1] === null || isFastTokenMetadataShape(entry[1]))
    ));
    if (!validRequestedMetadata) {
      return false;
    }
  }

  return true;
}

function isAccountInfoShape(value: unknown): value is FastAccountInfo {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  if (!hasOnlyKnownKeys(value, ACCOUNT_INFO_KEYS)) return false;

  if ('balance' in value && value.balance !== undefined && !isHexAmountString(value.balance)) {
    return false;
  }

  if ('token_balance' in value && value.token_balance !== undefined) {
    if (!Array.isArray(value.token_balance)) {
      return false;
    }

    const validTokenBalances = value.token_balance.every((entry) => (
      Array.isArray(entry)
      && entry.length === 2
      && isTokenIdLike(entry[0])
      && isHexAmountString(entry[1])
    ));
    if (!validTokenBalances) {
      return false;
    }
  }

  if ('next_nonce' in value && value.next_nonce !== undefined) {
    if (!isNonNegativeSafeInteger(value.next_nonce)) {
      return false;
    }
  }

  if ('requested_certificates' in value && value.requested_certificates !== undefined) {
    if (!Array.isArray(value.requested_certificates)) {
      return false;
    }

    const validRequestedCertificates = value.requested_certificates.every((certificate) => (
      isTransactionCertificate(certificate)
    ));
    if (!validRequestedCertificates) {
      return false;
    }
  }

  return true;
}

function invalidSubmitCertificateError(): FastError {
  return new FastError(
    'TX_FAILED',
    'Transaction was submitted, but the returned certificate could not be decoded.',
    {
      note: 'The network may have accepted this transaction. Inspect the returned certificate or upgrade the SDK if the network uses a newer certificate format.',
    },
  );
}

function invalidListedCertificateError(): FastError {
  return new FastError(
    'TX_FAILED',
    'The proxy returned a transaction certificate that could not be decoded.',
    {
      note: 'Upgrade the SDK if the network uses a newer certificate format, or inspect the raw RPC response for certificate shape changes.',
    },
  );
}

function invalidTokenMetadataError(): FastError {
  return new FastError(
    'TX_FAILED',
    'The proxy returned token metadata that could not be decoded.',
    {
      note: 'Upgrade the SDK if the network uses a newer token-metadata format, or inspect the raw RPC response for shape changes.',
    },
  );
}

function assertNonceParam(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new FastError('INVALID_PARAMS', `Invalid ${name}: ${value}`, {
      note: `Pass a non-negative safe integer ${name}.`,
    });
  }
}

function getSubmitResultVariantCount(value: Record<string, unknown>): number {
  let count = 0;
  if ('Success' in value) count += 1;
  if ('IncompleteVerifierSigs' in value) count += 1;
  if ('IncompleteMultiSig' in value) count += 1;
  return count;
}

export class BaseFastProvider {
  private _rpcUrl: string;
  private _network: NetworkType;
  private _explorerUrl: string | null = null;
  private _networkId: FastNetworkId | null;
  private _explicitExplorerUrl = false;
  private _initialized = false;
  private _configSource: ConfigSource;

  constructor(opts: ProviderOptions | undefined, configSource: ConfigSource) {
    this._configSource = configSource;
    this._network = opts?.network ?? 'testnet';
    this._rpcUrl = opts?.rpcUrl ?? 'https://testnet.api.fast.xyz/proxy';
    this._networkId = opts?.networkId ?? inferFastNetworkId(this._network);

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
    if (!this._networkId) {
      this._networkId = networkInfo?.networkId ?? inferFastNetworkId(this._network);
    }
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

  async getNetworkId(): Promise<FastNetworkId> {
    await this.init();
    if (!this._networkId) {
      throw new FastError(
        'INVALID_PARAMS',
        `Cannot infer Fast network id for network "${this._network}".`,
        {
          note: 'Pass ProviderOptions.networkId or configure networkId for this network alias in ~/.fast/networks.json.',
        },
      );
    }
    return this._networkId;
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

  async getKnownNetworks(): Promise<Record<string, { rpc: string; explorer?: string; networkId?: FastNetworkId }>> {
    return this._configSource.getAllNetworks();
  }

  async submitTransaction(
    envelope: FastTransactionEnvelope,
  ): Promise<FastSubmitTransactionResult> {
    await this.init();

    const result = await rpcCall(this._rpcUrl, 'proxy_submitTransaction', {
      transaction: toRpcVersionedTransaction(envelope.transaction),
      signature: toRpcEnvelopeSignature(envelope.signature),
    });

    if (isRecord(result)) {
      const submitResultVariantCount = getSubmitResultVariantCount(result);
      const hasDirectCertificateKeys = 'envelope' in result || 'signatures' in result;
      if (submitResultVariantCount > 1 || (submitResultVariantCount === 1 && hasDirectCertificateKeys)) {
        throw new FastError('TX_FAILED', 'Unexpected proxy_submitTransaction result', {
          note: 'The proxy returned a result that does not match the documented submitTransaction variants.',
        });
      }

      if (submitResultVariantCount === 0 && isTransactionCertificate(result)) {
        return { Success: result };
      }

      if ('Success' in result) {
        if (Object.keys(result).length !== 1) {
          throw new FastError('TX_FAILED', 'Unexpected proxy_submitTransaction result', {
            note: 'The proxy returned a result that does not match the documented submitTransaction variants.',
          });
        }
        if (isTransactionCertificate(result.Success)) {
          return { Success: result.Success };
        }
        throw invalidSubmitCertificateError();
      }
      if ('IncompleteVerifierSigs' in result && Array.isArray(result.IncompleteVerifierSigs)) {
        if (Object.keys(result).length !== 1) {
          throw new FastError('TX_FAILED', 'Unexpected proxy_submitTransaction result', {
            note: 'The proxy returned a result that does not match the documented submitTransaction variants.',
          });
        }
        return { IncompleteVerifierSigs: result.IncompleteVerifierSigs as unknown[] };
      }
      if ('IncompleteMultiSig' in result && Array.isArray(result.IncompleteMultiSig)) {
        if (Object.keys(result).length !== 1) {
          throw new FastError('TX_FAILED', 'Unexpected proxy_submitTransaction result', {
            note: 'The proxy returned a result that does not match the documented submitTransaction variants.',
          });
        }
        return { IncompleteMultiSig: result.IncompleteMultiSig as unknown[] };
      }
      if (hasDirectCertificateKeys) {
        throw invalidSubmitCertificateError();
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
      pubkey = fastAddressToBytes(address);
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
      pubkey = fastAddressToBytes(address);
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
      pubkey = fastAddressToBytes(address);
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

    assertNonceParam('nonce', fromNonce);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new FastError('INVALID_PARAMS', `Invalid certificate limit: ${limit}`, {
        note: 'Pass an integer limit between 1 and 200.',
      });
    }

    const pubkey = this.requireAddress(address);
    const result = await rpcCall(this._rpcUrl, 'proxy_getTransactionCertificates', {
      address: pubkey,
      from_nonce: fromNonce,
      limit,
    });

    if (!Array.isArray(result)) {
      throw new FastError('TX_FAILED', 'Unexpected proxy_getTransactionCertificates result', {
        note: 'The proxy returned a result that does not match the documented certificate list format.',
      });
    }

    if (!result.every((certificate) => isTransactionCertificate(certificate))) {
      throw invalidListedCertificateError();
    }

    return result;
  }

  async getCertificateByNonce(
    address: string,
    nonce: number,
  ): Promise<FastTransactionCertificate | null> {
    await this.init();
    assertNonceParam('nonce', nonce);

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
    const result = await rpcCall(this._rpcUrl, 'proxy_getAccountInfo', {
      address: pubkey,
      token_balances_filter: [],
      state_key_filter: null,
      certificate_by_nonce: opts?.certificateByNonce ?? null,
    });

    if (!isAccountInfoShape(result)) {
      throw new FastError('TX_FAILED', 'The proxy returned account info that could not be decoded.', {
        note: 'Upgrade the SDK if the network uses a newer account-info format, or inspect the raw RPC response for shape changes.',
      });
    }

    return result;
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

    const result = await rpcCall(this._rpcUrl, 'proxy_getTokenInfo', {
      token_ids: [...uniq.values()],
    });

    if (!isTokenInfoResponseShape(result)) {
      throw invalidTokenMetadataError();
    }

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
      return fastAddressToBytes(address);
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
