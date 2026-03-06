/**
 * @pi2labs/fast-sdk — Fast chain SDK for AI agents
 *
 * Primary API: fast({ network: 'testnet' }) → FastClient
 */

// Primary API — what agents use
export { fast } from './client.js';

// Errors
export { FastError } from './errors.js';
export type { FastErrorCode } from './errors.js';

// Types
export type { FastClient, NetworkType } from './types.js';
