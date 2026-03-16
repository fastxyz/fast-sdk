/**
 * @fastxyz/sdk/browser — Browser-safe Fast SDK entrypoint
 */

export { FastProvider } from './provider.browser.js';

export { FastError } from './errors.js';
export type { FastErrorCode } from './errors.js';

export { pubkeyToAddress, addressToPubkey, normalizeFastAddress } from './address.js';
export {
  FAST_DECIMALS,
  FAST_TOKEN_ID,
  EXPLORER_BASE,
  hexToTokenId,
  tokenIdEquals,
  hashTransaction,
  serializeVersionedTransaction,
} from './bcs.js';
export {
  getCertificateTransaction,
  getCertificateHash,
  getCertificateTokenTransfer,
} from './certificate.js';
export {
  getNetworkInfo,
  getAllNetworks,
  resolveKnownFastToken,
  getAllTokens,
  getDefaultRpcUrl,
  getExplorerUrl,
  clearDefaultsCache,
} from './defaults.browser.js';

export type {
  KnownFastToken,
  NetworkInfo,
  NetworkType,
  ProviderOptions,
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
} from './types.js';
export type { FastTransaction } from './bcs.js';
