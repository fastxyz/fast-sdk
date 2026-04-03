/**
 * @fastxyz/x402-facilitator
 *
 * Verify and settle x402 payments on-chain.
 * All network config provided via FacilitatorConfig — zero hardcoded values.
 */

// Types
export type {
  PaymentRequirement,
  PaymentPayload,
  FastPayload,
  EvmPayload,
  VerifyResponse,
  SettleResponse,
  SupportedPaymentKind,
  NetworkType,
} from '@fastxyz/x402-types';

export { getNetworkType } from '@fastxyz/x402-types';

export type {
  FacilitatorConfig,
  FacilitatorEvmChainConfig,
  FacilitatorFastNetworkConfig,
} from './types.js';

export { getNetworkId } from './types.js';

// Core functions
export { verify } from './verify.js';
export { settle } from './settle.js';

// Fast BCS utilities
export {
  TransactionBcs,
  VersionedTransactionBcs,
  decodeEnvelope,
  getTransferDetails,
  bytesToHex,
  fastAddressToBytes,
  hexToBytes,
  pubkeyToAddress,
  serializeFastTransaction,
  unwrapFastTransaction,
  createFastTransactionSigningMessage,
  type DecodedFastTransaction,
} from './fast-bcs.js';

// Server
export { createFacilitatorServer, createFacilitatorRoutes } from './server.js';
