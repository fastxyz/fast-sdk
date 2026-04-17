import type { Schema } from 'effect';
import type { TransactionVersion } from '../base/internal.ts';
import {
  TransactionRelease20260319Input,
  TransactionRelease20260407Input,
  type OperationInputParams,
} from './transaction.ts';

/**
 * Configuration for a specific transaction version.
 *
 * Adding a new version to this registry (plus its BCS layout and input schema)
 * is the ONLY change required in `@fastxyz/schema`. Downstream packages (SDK,
 * facilitator, wallet) need no code changes — just a dependency bump.
 */
export interface TransactionVersionConfig {
  wrapOperations(ops: OperationInputParams[]): Record<string, unknown>;
  extractOperations(decoded: Record<string, unknown>): unknown[];
  // biome-ignore lint/suspicious/noExplicitAny: generic schema stored as opaque ref
  inputSchema: Schema.Schema<any, any, never>;
}

export const TransactionVersionRegistry: Record<TransactionVersion, TransactionVersionConfig> = {
  Release20260319: {
    wrapOperations(ops: OperationInputParams[]): Record<string, unknown> {
      if (ops.length === 0) {
        throw new Error('Release20260319 transactions require at least one operation');
      }
      const claim = ops.length === 1
        ? ops[0]!
        : { type: 'Batch' as const, value: ops };
      return { claim };
    },

    extractOperations(decoded: Record<string, unknown>): unknown[] {
      const claim = decoded.claim;
      if (claim == null) return [];

      if (typeof claim === 'object' && !Array.isArray(claim)) {
        const rec = claim as Record<string, unknown>;
        // Batch variant (BCS shape: { Batch: [...] })
        if ('Batch' in rec && Array.isArray(rec.Batch)) {
          return rec.Batch;
        }
        // Batch variant (serde/domain shape: { type: 'Batch', value: [...] })
        if (rec.type === 'Batch' && Array.isArray(rec.value)) {
          return rec.value as unknown[];
        }
        // Single operation — return as one-element array
        return [claim];
      }
      return [];
    },

    inputSchema: TransactionRelease20260319Input,
  },

  Release20260407: {
    wrapOperations(ops: OperationInputParams[]): Record<string, unknown> {
      return { claims: ops };
    },

    extractOperations(decoded: Record<string, unknown>): unknown[] {
      return Array.isArray(decoded.claims) ? decoded.claims : [];
    },

    inputSchema: TransactionRelease20260407Input,
  },
};

/**
 * Get the version config for a transaction version string.
 * Accepts `string` (not just `TransactionVersion`) for runtime safety — the
 * facilitator's BCS decoder infers version tags from raw decoded records.
 */
export function getTransactionVersionConfig(version: string): TransactionVersionConfig {
  if (!(version in TransactionVersionRegistry)) {
    throw new Error(`Unknown transaction version: ${version}`);
  }
  return TransactionVersionRegistry[version as TransactionVersion];
}
