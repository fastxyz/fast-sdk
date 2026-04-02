/**
 * Shared test types for facilitator tests.
 * Replaces the old `import type { FastTransactionCertificate } from '@fastxyz/sdk/core'`
 */

export interface FastTransactionCertificate {
  envelope: {
    transaction: unknown;
    signature: unknown;
  };
  signatures: unknown[];
}
