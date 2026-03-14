/**
 * @fastxyz/sdk — Fast SDK
 *
 * Primary API:
 * - FastProvider: Read-only connection to the Fast network
 * - FastWallet: Wallet for signing transactions
 */

// Primary API
export { FastProvider } from './provider.js';
export { FastWallet } from './wallet.js';

// Errors
export { FastError } from './errors.js';
export type { FastErrorCode } from './errors.js';

// Types
export type {
  NetworkType,
  ProviderOptions,
  WalletKeyfileOptions,
  TokenInfo,
  TokenBalance,
  SendResult,
  SignResult,
  SubmitResult,
  ExportedKeys,
} from './types.js';

// Key utilities
export { generateEd25519Key, keypairFromPrivateKey, loadKeyfile, saveKeyfile, withKey, signEd25519, verifyEd25519 } from './keys.js';

// BCS schemas and utilities (for advanced use cases like payment verification)
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
