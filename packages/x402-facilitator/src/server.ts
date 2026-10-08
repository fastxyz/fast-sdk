/**
 * Facilitator HTTP server
 *
 * Express middleware for x402 facilitator endpoints.
 * Network lists derived from config — no hardcoded SUPPORTED_* lists.
 */

import type { Request, Response, NextFunction } from 'express';
import { toCanonicalNetwork, type PaymentPayload, type PaymentPayloadV2, type SupportedPaymentKind } from '@fastxyz/x402-types';
import { privateKeyToAccount } from 'viem/accounts';
import type { FacilitatorConfig } from './types.js';
import { verify } from './verify.js';
import { settle } from './settle.js';

function log(message: string, config?: FacilitatorConfig): void {
  if (config?.debug === false) return;
  console.log(`[x402-facilitator] ${message}`);
}

/** Decode protocol JSON without changing amount or authorization string types. */
function parseX402Payload(json: string): PaymentPayload | PaymentPayloadV2 {
  // BCS certificate converters handle decimal strings locally; protocol strings stay strings.
  return JSON.parse(json) as PaymentPayload | PaymentPayloadV2;
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

        let decoded: PaymentPayload | PaymentPayloadV2;
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

        log(`  Verifying x402 v${decoded.x402Version}`, config);
        const result = await verify(decoded, paymentRequirements, config);
        log(`  ${result.isValid ? '✓' : '✗'} Verify result: ${result.isValid ? 'valid' : result.invalidReason}`, config);
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

        let decoded: PaymentPayload | PaymentPayloadV2;
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

        log(`  Settling x402 v${decoded.x402Version}`, config);
        const result = await settle(decoded, paymentRequirements, config);
        log(`  ${result.success ? '✓' : '✗'} Settle result: ${result.success ? `tx=${result.txHash?.slice(0, 20)}...` : result.errorReason}`, config);
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

      const kinds = paymentKinds.flatMap((kind) => {
        try {
          return [
            {
              ...kind,
              x402Version: 2,
              network: toCanonicalNetwork(kind.network),
              ...(kind.network.startsWith('fast') && { extra: { ...kind.extra, paymentFlow: 'upfront' } }),
            },
          ];
        } catch {
          return [];
        }
      });
      const signers =
        config.evmPrivateKey && Object.keys(config.evmChains ?? {}).length ? { 'eip155:*': [privateKeyToAccount(config.evmPrivateKey).address] } : {};
      res.json({ paymentKinds, kinds, extensions: [], signers });
    },
  });

  return routes;
}

/**
 * Create facilitator Express middleware.
 */
export function createFacilitatorServer(config: FacilitatorConfig = {}) {
  const routes = createFacilitatorRoutes(config);

  return async function facilitatorMiddleware(req: Request, res: Response, next: NextFunction) {
    for (const route of routes) {
      if (req.method.toLowerCase() === route.method && req.path === route.path) {
        return route.handler(req, res);
      }
    }
    next();
  };
}
