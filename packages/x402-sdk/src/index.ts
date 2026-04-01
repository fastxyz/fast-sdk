/**
 * @fastxyz/x402-sdk
 * 
 * HTTP 402 Payment Protocol SDK
 * 
 * Three modules:
 * - client: Pay for x402-protected content
 * - server: Protect routes with x402 payment requirements
 * - facilitator: Verify and settle payments on-chain
 * 
 * Import from subpath exports for cleaner imports:
 *   import { x402Pay } from '@fastxyz/x402-sdk/client';
 *   import { paymentMiddleware } from '@fastxyz/x402-sdk/server';
 *   import { verify, settle } from '@fastxyz/x402-sdk/facilitator';
 */

// Re-export client (primary entry)
export * from "./client/index.js";

// Re-export server, excluding names that conflict with client
export {
  type RouteConfig,
  type PaymentRequiredResponse,
  type FacilitatorConfig as ServerFacilitatorConfig,
  type PaymentResponse,
  type NetworkConfig,
  type RoutesConfig,
  type XPaymentPayload,
  type PayToConfig,
  type VerifyResponse as ServerVerifyResponse,
  type SettleResponse as ServerSettleResponse,
  NETWORK_CONFIGS,
  parsePrice,
  getNetworkConfig,
  encodePayload,
  decodePayload,
  createPaymentRequirement,
  createPaymentRequired,
  verifyPayment,
  settlePayment,
  encodePaymentResponse,
  verifyAndSettle,
  paymentMiddleware,
} from "./server/index.js";

// Re-export facilitator, excluding names that conflict
export {
  type FastPayload,
  type EvmPayload,
  type SupportedPaymentKind,
  type FacilitatorConfig,
  type EvmChainConfig,
  type NetworkType,
  getNetworkType,
  EVM_CHAINS,
  FAST_RPC_URLS,
  FAST_TRUSTED_COMMITTEE_PUBLIC_KEYS,
  SUPPORTED_EVM_NETWORKS,
  SUPPORTED_FAST_NETWORKS,
  getEvmChainConfig,
  getFastRpcUrl,
  verify,
  settle,
  FAST_NETWORK_IDS,
  TransactionBcs,
  decodeEnvelope,
  getTransferDetails,
  bytesToHex,
  fastAddressToBytes,
  hexToBytes,
  pubkeyToAddress,
  type DecodedFastTransaction,
  createFacilitatorServer,
  createFacilitatorRoutes,
} from "./facilitator/index.js";
