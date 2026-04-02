/**
 * @fastxyz/x402-server
 *
 * Server SDK for x402 payment protocol.
 * Zero hardcoded network configs — all asset info provided via RouteConfig.
 */

// Types
export type {
  RouteConfig,
  PaymentRequiredResponse,
  FacilitatorConfig,
  PaymentResponse,
  NetworkConfig,
  RoutesConfig,
  XPaymentPayload,
  PayToConfig,
  MiddlewareOptions,
} from './types.js';

// Re-export shared types
export type {
  PaymentRequirement,
  VerifyResponse,
  SettleResponse,
} from '@fastxyz/x402-types';

// Utils
export { parsePrice, encodePayload, decodePayload } from './utils.js';

// Core payment functions
export {
  createPaymentRequirement,
  createPaymentRequired,
  parsePaymentHeader,
  verifyPayment,
  settlePayment,
  encodePaymentResponse,
  verifyAndSettle,
} from './payment.js';

// Middleware
export {
  paymentMiddleware,
  paywall,
  type Request,
  type Response,
  type NextFunction,
} from './middleware.js';
