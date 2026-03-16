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

// Types
export type {
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
export type {
  FastTransaction,
  VersionedTransaction,
  DecodedTransaction,
} from './bcs.js';
