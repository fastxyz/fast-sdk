/**
 * client.ts — fast() factory function
 *
 * The primary entry point for the Fast SDK. Returns a FastClient
 * with simple one-liner methods for agents.
 */
import type { FastClient, NetworkType } from './types.js';
/**
 * Create a Fast chain client.
 *
 * @example
 * ```ts
 * const f = fast({ network: 'testnet' });
 * await f.setup();
 * await f.balance();
 * await f.send({ to: 'fast1...', amount: '1.0' });
 * ```
 */
export declare function fast(opts?: {
    network?: NetworkType;
}): FastClient;
//# sourceMappingURL=client.d.ts.map