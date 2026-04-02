/**
 * Facilitator HTTP server
 *
 * Express middleware for x402 facilitator endpoints.
 * Network lists derived from config — no hardcoded SUPPORTED_* lists.
 */

import type { Request, Response, NextFunction } from 'express';
import type { PaymentPayload, SupportedPaymentKind } from '@fastxyz/x402-types';
import type { FacilitatorConfig } from './types.js';
import { verify } from './verify.js';
import { settle } from './settle.js';

function log(message: string, config?: FacilitatorConfig): void {
  if (config?.debug === false) return;
  console.log(`[x402-facilitator] ${message}`);
}

/**
 * JSON.parse reviver that converts numeric strings to BigInt when they look like
 * large integers (used for timestamp_nanos and other BigInt fields in Fast transactions).
 */
function bigIntReviver(_key: string, value: unknown): unknown {
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    const num = BigInt(value);
    if (num > Number.MAX_SAFE_INTEGER || num < Number.MIN_SAFE_INTEGER) {
      return num;
    }
  }
  return value;
}

function parseX402Payload(json: string): PaymentPayload {
  return JSON.parse(json, bigIntReviver) as PaymentPayload;
}

/**
 * Create facilitator Express routes.
 */
export function createFacilitatorRoutes(config: FacilitatorConfig = {}) {
  const routes: Array<{
    method: 'get' | 'post';
    path: string;
    handler: (req: Request, res: Response) => Promise<void>;
  }> = [];

  // POST /verify
  routes.push({
    method: 'post',
    path: '/verify',
    handler: async (req: Request, res: Response) => {
      log(`→ POST /verify`, config);
      try {
        const { paymentPayload, paymentRequirements } = req.body;

        if (!paymentPayload || !paymentRequirements) {
          log(`  ✗ Missing parameters`, config);
          res.status(400).json({
            isValid: false,
            invalidReason: 'missing_parameters',
          });
          return;
        }

        let decoded: PaymentPayload;
        if (typeof paymentPayload === 'string') {
          try {
            decoded = parseX402Payload(Buffer.from(paymentPayload, 'base64').toString());
          } catch {
            log(`  ✗ Invalid payload encoding`, config);
            res.status(400).json({
              isValid: false,
              invalidReason: 'invalid_payload_encoding',
            });
            return;
          }
        } else {
          decoded = paymentPayload;
        }

        log(`  Network: ${decoded.network}, Scheme: ${decoded.scheme}`, config);
        const result = await verify(decoded, paymentRequirements, config);
        log(
          `  ${result.isValid ? '✓' : '✗'} Verify result: ${result.isValid ? 'valid' : result.invalidReason}`,
          config,
        );
        res.json(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`  ✗ Error: ${message}`, config);
        res.status(500).json({
          isValid: false,
          invalidReason: `verification_error: ${message}`,
        });
      }
    },
  });

  // POST /settle
  routes.push({
    method: 'post',
    path: '/settle',
    handler: async (req: Request, res: Response) => {
      log(`→ POST /settle`, config);
      try {
        const { paymentPayload, paymentRequirements } = req.body;

        if (!paymentPayload || !paymentRequirements) {
          log(`  ✗ Missing parameters`, config);
          res.status(400).json({
            success: false,
            errorReason: 'missing_parameters',
          });
          return;
        }

        let decoded: PaymentPayload;
        if (typeof paymentPayload === 'string') {
          try {
            decoded = parseX402Payload(Buffer.from(paymentPayload, 'base64').toString());
          } catch {
            log(`  ✗ Invalid payload encoding`, config);
            res.status(400).json({
              success: false,
              errorReason: 'invalid_payload_encoding',
            });
            return;
          }
        } else {
          decoded = paymentPayload;
        }

        log(`  Network: ${decoded.network}, settling...`, config);
        const result = await settle(decoded, paymentRequirements, config);
        log(
          `  ${result.success ? '✓' : '✗'} Settle result: ${result.success ? `tx=${result.txHash?.slice(0, 20)}...` : result.errorReason}`,
          config,
        );
        res.json(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`  ✗ Error: ${message}`, config);
        res.status(500).json({
          success: false,
          errorReason: `settlement_error: ${message}`,
        });
      }
    },
  });

  // GET /supported — derived from config
  routes.push({
    method: 'get',
    path: '/supported',
    handler: async (_req: Request, res: Response) => {
      const paymentKinds: SupportedPaymentKind[] = [];

      // Add EVM networks from config
      if (config.evmChains) {
        for (const [network, chainConfig] of Object.entries(config.evmChains)) {
          paymentKinds.push({
            x402Version: 1,
            scheme: 'exact',
            network,
            extra: {
              asset: chainConfig.usdcAddress,
              name: chainConfig.usdcName || 'USD Coin',
              version: chainConfig.usdcVersion || '2',
            },
          });
        }
      }

      // Add Fast networks from config
      if (config.fastNetworks) {
        for (const network of Object.keys(config.fastNetworks)) {
          paymentKinds.push({
            x402Version: 1,
            scheme: 'exact',
            network,
          });
        }
      }

      res.json({ paymentKinds });
    },
  });

  return routes;
}

/**
 * Create facilitator Express middleware.
 */
export function createFacilitatorServer(config: FacilitatorConfig = {}) {
  const routes = createFacilitatorRoutes(config);

  return async function facilitatorMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    for (const route of routes) {
      if (req.method.toLowerCase() === route.method && req.path === route.path) {
        return route.handler(req, res);
      }
    }
    next();
  };
}
