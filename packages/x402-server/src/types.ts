/**
 * x402-server types
 *
 * Re-exports shared types from x402-types and defines server-specific types.
 */

export type { PaymentRequirement, PaymentPayload, VerifyResponse, SettleResponse } from '@fastxyz/x402-types';

/**
 * Payment addresses configuration.
 * A single address (string) or multiple addresses by network type.
 */
export type PayToConfig =
  | string
  | {
      /** EVM address (0x...) for Arbitrum, Base, Ethereum, etc. */
      evm?: string;
      /** Fast address (fast1...) for Fast networks */
      fast?: string;
    };

/**
 * Network-specific asset configuration passed by the caller.
 * No hardcoded defaults — server operators provide these.
 */
export interface NetworkConfig {
  /** USDC contract/token address for this network */
  asset: string;
  /** Token decimals (typically 6 for USDC) */
  decimals: number;
  /** Optional extra metadata (e.g. EIP-3009 name/version) */
  extra?: Record<string, unknown>;
}

/**
 * Route configuration for paywall
 */
export interface RouteConfig {
  /** Price in human-readable format (e.g., "$0.10", "0.1 USDC") */
  price: string;
  /** Network identifier (e.g. "fast-testnet", "arbitrum-sepolia") */
  network: string;
  /** Network asset config for this route */
  networkConfig: NetworkConfig;
  /** Optional additional config */
  config?: {
    description?: string;
    mimeType?: string;
    /** Override asset address (takes precedence over networkConfig.asset) */
    asset?: string;
  };
}

/**
 * 402 response body
 */
export interface PaymentRequiredResponse {
  error: string;
  accepts: import('@fastxyz/x402-types').PaymentRequirement[];
}

/**
 * Facilitator configuration (URL-based, used by the server to reach facilitator)
 */
export interface FacilitatorConfig {
  /** Facilitator URL (e.g., "http://localhost:3002") */
  url: string;
  /** Optional auth headers factory */
  createAuthHeaders?: () => Promise<{
    verify?: Record<string, string>;
    settle?: Record<string, string>;
  }>;
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
 * Routes configuration map (pattern → RouteConfig)
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
