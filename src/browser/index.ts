import {
  encodeFastAddress,
  fastAddressToBytes,
  decodeFastAddress,
} from '../core/address.js';
import { hexToBytes } from '../core/bcs.js';

export { FastProvider } from './provider.js';

export { FastError } from '../core/errors.js';
export type { FastErrorCode } from '../core/errors.js';

export { encodeFastAddress, fastAddressToBytes, decodeFastAddress };

export function pubkeyToAddress(publicKeyHex: string): string {
  return encodeFastAddress(hexToBytes(publicKeyHex));
}

export function addressToPubkey(address: string): Uint8Array {
  return fastAddressToBytes(address);
}

export function normalizeFastAddress(address: string): string {
  return decodeFastAddress(address).address;
}

export {
  FAST_DECIMALS,
  FAST_TOKEN_ID,
  FAST_NETWORK_IDS,
  EXPLORER_BASE,
  hexToTokenId,
  tokenIdEquals,
  hashTransaction,
  serializeVersionedTransaction,
} from '../core/bcs.js';

export {
  getCertificateTransaction,
  getCertificateHash,
  getCertificateTokenTransfer,
} from '../core/certificate.js';

export {
  getNetworkInfo,
  getAllNetworks,
  resolveKnownFastToken,
  getAllTokens,
  getDefaultRpcUrl,
  getExplorerUrl,
  clearDefaultsCache,
} from '../config/browser.js';

export type {
  DecodedFastAddress,
  FastNetworkId,
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
} from '../core/types.js';

export type { FastTransaction } from '../core/bcs.js';
