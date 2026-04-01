/**
 * x402-server types
 * Types for creating payment requirements and verifying payments
 */

/**
 * Payment addresses configuration
 * Can be a single address (string) or multiple addresses by network type
 */
export type PayToConfig = string | {
  /** EVM address (0x...) for Arbitrum, Base, Ethereum, etc. */
  evm?: string;
  /** Fast address (fast1...) for Fast networks */
  fast?: string;
};

/**
 * Route configuration for paywall
 */
export interface RouteConfig {
  /** Price in human-readable format (e.g., "$0.10", "0.1 USDC") */
  price: string;
  /** Network identifier */
  network: string;
  /** Optional additional config */
  config?: {
    description?: string;
    mimeType?: string;
    /** Custom asset address (defaults to USDC) */
    asset?: string;
  };
}

/**
 * Payment requirement returned in 402 response
 */
export interface PaymentRequirement {
  scheme: "exact";
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  outputSchema?: unknown;
  extra?: Record<string, unknown>;
}

/**
 * 402 response body
 */
export interface PaymentRequiredResponse {
  error: string;
  accepts: PaymentRequirement[];
}

/**
 * Facilitator configuration
 */
export interface FacilitatorConfig {
  /** Facilitator URL (e.g., "http://localhost:3002") */
  url: string;
  /** Optional auth headers function */
  createAuthHeaders?: () => Promise<{
    verify?: Record<string, string>;
    settle?: Record<string, string>;
  }>;
}

/**
 * Facilitator verify response (matches facilitator schema)
 */
export interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
  network?: string;
}

/**
 * Facilitator settle response (matches facilitator schema)
 */
export interface SettleResponse {
  success: boolean;
  txHash?: string;
  transaction?: string;
  errorReason?: string;
  network?: string;
  payer?: string;
}

/**
 * X-PAYMENT-RESPONSE payload
 */
export interface PaymentResponse {
  success: boolean;
  network?: string;
  txHash?: string;
  payer?: string;
  errorMessage?: string;
}

/**
 * Network configuration for default assets
 */
export interface NetworkConfig {
  asset: string;
  decimals: number;
  extra?: Record<string, unknown>;
}

/**
 * Routes configuration map
 */
export type RoutesConfig = Record<string, RouteConfig>;

/**
 * Middleware options
 */
export interface MiddlewareOptions {
  /** Enable debug logging (default: true) */
  debug?: boolean;
}

/**
 * Decoded X-PAYMENT payload
 */
export interface XPaymentPayload {
  x402Version: number;
  scheme: string;
  network: string;
  payload: unknown;
}
