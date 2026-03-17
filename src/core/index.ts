/**
 * @fastxyz/sdk/core — Pure, browser-safe utilities
 *
 * No file I/O, no Node dependencies. Safe for browser bundlers.
 */

// Address utilities
export { pubkeyToAddress, addressToPubkey, normalizeFastAddress } from './address.js';

// Amount formatting
export { toHex, toRaw, toHuman, fromHex, compareDecimalStrings } from './amounts.js';

// Byte utilities
export { bytesToHex, bytesToPrefixedHex, hexToBytes, stripHexPrefix, utf8ToBytes } from './bytes.js';

// BCS serialization
export {
  TransactionBcs,
  VersionedTransactionBcs,
  decodeTransactionEnvelope,
  getTransferDetails,
  hashTransaction,
  serializeVersionedTransaction,
  hexToTokenId,
  tokenIdEquals,
  FAST_TOKEN_ID,
  FAST_DECIMALS,
  EXPLORER_BASE,
} from './bcs.js';

// Certificate utilities
export {
  getCertificateTransaction,
  getCertificateHash,
  getCertificateTokenTransfer,
} from './certificate.js';

// Errors
export { FastError } from './errors.js';
export type { FastErrorCode } from './errors.js';

// RPC helpers
export { rpcCall } from './rpc.js';

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
