/**
 * Shared test types for facilitator tests.
 */

export interface FastTransactionCertificate {
  envelope: {
    transaction: unknown;
    signature: unknown;
  };
  signatures: unknown[];
}
