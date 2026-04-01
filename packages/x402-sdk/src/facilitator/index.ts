/**
 * x402-facilitator
 * 
 * Verify and settle x402 payments on-chain.
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
  FacilitatorConfig,
  EvmChainConfig,
  NetworkType,
} from "./types.js";

export { getNetworkType } from "./types.js";

// Chains
export {
  EVM_CHAINS,
  FAST_RPC_URLS,
  FAST_TRUSTED_COMMITTEE_PUBLIC_KEYS,
  SUPPORTED_EVM_NETWORKS,
  SUPPORTED_FAST_NETWORKS,
  getEvmChainConfig,
  getFastRpcUrl,
} from "./chains.js";

// Core functions
export { verify } from "./verify.js";
export { settle } from "./settle.js";

// Fast BCS utilities
export {
  FAST_NETWORK_IDS,
  TransactionBcs,
  decodeEnvelope,
  getTransferDetails,
  bytesToHex,
  fastAddressToBytes,
  hexToBytes,
  pubkeyToAddress,
  type DecodedFastTransaction,
} from "./fast-bcs.js";

// Server
export { createFacilitatorServer, createFacilitatorRoutes } from "./server.js";
