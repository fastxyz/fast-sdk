/**
 * x402-server Express middleware
 * Framework-agnostic middleware for x402 payment verification
 */

import {
  createPaymentRequired,
  createPaymentRequirement,
  encodePaymentResponse,
  settlePayment,
  verifyPayment,
} from "./payment.js";
import type {
  FacilitatorConfig,
  MiddlewareOptions,
  PayToConfig,
  RouteConfig,
  RoutesConfig
} from "./types.js";
import { assertSupportedPaymentNetwork } from "./utils.js";

// Express types (minimal to avoid hard dependency)
export interface Request {
  method: string;
  path: string;
  header(name: string): string | undefined;
}

export interface Response {
  status(code: number): Response;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
}

export type NextFunction = () => void | Promise<void>;

/**
 * Logger function - logs to console by default, can be overridden
 */
function log(message: string, options?: MiddlewareOptions): void {
  if (options?.debug === false) return;
  console.log(`[x402-server] ${message}`);
}

/**
 * Match a route pattern to a request
 */
function matchRoute(pattern: string, method: string, path: string): boolean {
  const parts = pattern.split(" ");
  let routeMethod = "*";
  let routePath = pattern;
  
  if (parts.length === 2) {
    routeMethod = parts[0].toUpperCase();
    routePath = parts[1];
  }
  
  if (routeMethod !== "*" && routeMethod !== method.toUpperCase()) {
    return false;
  }
  
  const regexPattern = routePath
    .replace(/\*/g, ".*")
    .replace(/:[\w]+/g, "[^/]+");
  
  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(path);
}

/**
 * Find matching route config for a request
 */
function findRouteConfig(
  routes: RoutesConfig,
  method: string,
  path: string
): RouteConfig | null {
  for (const [pattern, config] of Object.entries(routes)) {
    if (matchRoute(pattern, method, path)) {
      return config;
    }
  }
  return null;
}

/**
 * Check if network is Fast
 */
function isFastNetwork(network: string): boolean {
  return network.startsWith("fast-");
}

/**
 * Check if network is EVM-based
 */
function isEvmNetwork(network: string): boolean {
  const evmNetworks = [
    "ethereum", "arbitrum", "arbitrum-sepolia", 
    "base", "base-sepolia", "optimism", "polygon"
  ];
  return evmNetworks.includes(network) || network.endsWith("-sepolia");
}

/**
 * Resolve payment address based on network type
 */
function resolvePayTo(payTo: PayToConfig, network: string): string {
  assertSupportedPaymentNetwork(network);

  if (typeof payTo === "string") {
    return payTo;
  }
  
  if (isFastNetwork(network)) {
    if (!payTo.fast) {
      throw new Error(
        `Fast payment address not configured. ` +
        `Add 'fast' to payTo config for network: ${network}`
      );
    }
    return payTo.fast;
  }
  
  if (isEvmNetwork(network)) {
    if (!payTo.evm) {
      throw new Error(
        `EVM payment address not configured. ` +
        `Add 'evm' to payTo config for network: ${network}`
      );
    }
    return payTo.evm;
  }
  
  throw new Error(`Unknown network type: ${network}`);
}

/**
 * Create x402 payment middleware for Express
 */
export function paymentMiddleware(
  payTo: PayToConfig,
  routes: RoutesConfig,
  facilitator: FacilitatorConfig,
  options?: MiddlewareOptions
) {
  const opts = { debug: true, ...options };
  
  return async function x402Middleware(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    const routeConfig = findRouteConfig(routes, req.method, req.path);
    
    if (!routeConfig) {
      return next();
    }
    
    log(`→ ${req.method} ${req.path} (${routeConfig.network}, ${routeConfig.price})`, opts);
    
    const paymentHeader = req.header("X-PAYMENT");
    
    let resolvedPayTo: string;
    try {
      resolvedPayTo = resolvePayTo(payTo, routeConfig.network);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log(`✗ Address resolution error: ${errorMessage}`, opts);
      res.status(500);
      return res.json({ error: errorMessage });
    }
    
    if (!paymentHeader) {
      log(`← 402 Payment Required (no X-PAYMENT header)`, opts);
      try {
        const paymentRequired = createPaymentRequired(
          resolvedPayTo,
          routeConfig,
          req.path
        );
        res.status(402);
        return res.json(paymentRequired);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log(`✗ Error creating payment requirement: ${errorMessage}`, opts);
        res.status(500);
        return res.json({ error: errorMessage });
      }
    }
    
    log(`  X-PAYMENT header present (${paymentHeader.length} chars)`, opts);
    
    const paymentRequirement = createPaymentRequirement(
      resolvedPayTo,
      routeConfig,
      req.path
    );
    
    const isFast = isFastNetwork(routeConfig.network);
    
    try {
      log(`  → Verifying payment with facilitator...`, opts);
      const verifyResult = await verifyPayment(
        paymentHeader,
        paymentRequirement,
        facilitator
      );
      
      if (!verifyResult.isValid) {
        log(`  ✗ Verification failed: ${verifyResult.invalidReason}`, opts);
        res.status(402);
        return res.json({
          error: verifyResult.invalidReason || "Payment verification failed",
          accepts: [paymentRequirement],
          payer: verifyResult.payer,
        });
      }
      
      log(`  ✓ Payment verified (payer: ${verifyResult.payer?.slice(0, 20)}...)`, opts);
      
      if (isFast) {
        log(`← 200 OK (Fast payment - no settlement needed)`, opts);
        res.setHeader(
          "X-PAYMENT-RESPONSE",
          encodePaymentResponse({
            success: true,
            network: verifyResult.network,
            payer: verifyResult.payer,
          })
        );
        return next();
      }
      
      log(`  → Settling EVM payment...`, opts);
      const settleResult = await settlePayment(
        paymentHeader,
        paymentRequirement,
        facilitator
      );
      
      if (!settleResult.success) {
        log(`  ✗ Settlement failed: ${settleResult.errorReason}`, opts);
        res.status(402);
        return res.json({
          error: settleResult.errorReason || "Payment settlement failed",
          accepts: [paymentRequirement],
          payer: verifyResult.payer,
        });
      }
      
      log(`  ✓ Payment settled (tx: ${settleResult.txHash?.slice(0, 20)}...)`, opts);
      log(`← 200 OK`, opts);
      
      res.setHeader(
        "X-PAYMENT-RESPONSE",
        encodePaymentResponse({
          success: true,
          txHash: settleResult.txHash,
          network: settleResult.network || verifyResult.network,
          payer: settleResult.payer || verifyResult.payer,
        })
      );
      
      return next();
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log(`✗ Payment error: ${errorMessage}`, opts);
      res.status(500);
      return res.json({
        error: `Payment processing error: ${errorMessage}`,
      });
    }
  };
}

/**
 * Simple middleware that returns 402 for all requests without X-PAYMENT
 */
export function paywall(
  payTo: PayToConfig,
  config: RouteConfig,
  facilitator: FacilitatorConfig,
  options?: MiddlewareOptions
) {
  return paymentMiddleware(
    payTo,
    { "*": config },
    facilitator,
    options
  );
}
