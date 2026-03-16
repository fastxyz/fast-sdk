/**
 * @fastxyz/sdk — Fast SDK
 *
 * Primary API:
 * - FastProvider: Low-level connection to the Fast proxy API
 * - FastWallet: Wallet for signing transactions
 */

// Primary API
export { FastProvider } from './provider.js';
export { FastWallet } from './wallet.js';

// Errors
export { FastError } from './errors.js';
export type { FastErrorCode } from './errors.js';

// Config accessors
export {
  getNetworkInfo,
  getAllNetworks,
  resolveKnownFastToken,
  getAllTokens,
  getDefaultRpcUrl,
  getExplorerUrl,
  clearDefaultsCache,
} from './defaults.js';

export {
  encodeFastAddress,
  fastAddressToBytes,
  decodeFastAddress,
} from './address.js';

// Types
export type {
  DecodedFastAddress,
  KnownFastToken,
  NetworkInfo,
  NetworkType,
  ProviderOptions,
  WalletKeyfileOptions,
  TokenInfo,
  TokenBalance,
  FastAccountInfo,
  FastTokenMetadata,
  FastVersionedTransaction,
  FastTransactionEnvelope,
  FastTransactionCertificate,
  FastSubmitTransactionResult,
  FastTokenTransferSummary,
  SendResult,
  SignResult,
  SubmitResult,
  ExportedKeys,
} from './types.js';

// BCS schemas and utilities
export {
  TransactionBcs,
  VersionedTransactionBcs,
  decodeTransactionEnvelope,
  getTransferDetails,
  hashTransaction,
  serializeVersionedTransaction,
  bytesToHex,
  hexToBytes,
  hexToTokenId,
  tokenIdEquals,
  FAST_TOKEN_ID,
  FAST_DECIMALS,
} from './bcs.js';

export type {
  FastTransaction,
  VersionedTransaction,
  DecodedTransaction,
} from './bcs.js';
