/**
 * errors.ts — Structured error codes for AllSet SDK.
 *
 * Every throwable error from the SDK is a FastError with a machine-readable
 * `code`. Agents can switch on `code` instead of parsing message strings.
 */
export type FastErrorCode =
  | 'INSUFFICIENT_BALANCE'
  | 'NETWORK_NOT_CONFIGURED'
  | 'TX_FAILED'
  | 'TX_INDETERMINATE'
  | 'INVALID_ADDRESS'
  | 'TOKEN_NOT_FOUND'
  | 'INVALID_PARAMS'
  | 'UNSUPPORTED_OPERATION'
  | 'KEYFILE_NOT_FOUND';

export class FastError extends Error {
  readonly code: FastErrorCode;
  readonly note: string;

  constructor(code: FastErrorCode, message: string, opts?: { note?: string }) {
    super(message);
    this.name = 'FastError';
    this.code = code;
    this.note = opts?.note ?? '';
  }

  toJSON(): Record<string, unknown> {
    return { name: this.name, code: this.code, message: this.message, note: this.note };
  }
}

/**
 * The Fast network may have accepted a transaction, but its certificate could
 * not be correlated to the exact signed envelope. Callers must inspect the
 * recorded transaction before attempting any recovery; retrying the whole
 * flow can duplicate a transfer or claim.
 */
export class IndeterminateTransactionError extends FastError {
  readonly mayHaveSettled = true as const;
  readonly txHash: string;
  readonly stage: 'transfer' | 'intent';
  readonly recoveryEnvelope: unknown;
  readonly relatedTxHash?: string;
  readonly cause?: unknown;

  constructor(params: {
    readonly stage: 'transfer' | 'intent';
    readonly txHash: string;
    readonly recoveryEnvelope: unknown;
    readonly relatedTxHash?: string;
    readonly cause?: unknown;
  }) {
    super(
      'TX_INDETERMINATE',
      `${params.stage} transaction ${params.txHash} may have settled, but its certificate could not be correlated. Do not retry the flow blindly.`,
      {
        note: 'Inspect the transaction and use recoveryEnvelope before attempting a follow-up action.',
      },
    );
    this.name = 'IndeterminateTransactionError';
    this.stage = params.stage;
    this.txHash = params.txHash;
    this.recoveryEnvelope = params.recoveryEnvelope;
    this.relatedTxHash = params.relatedTxHash;
    this.cause = params.cause;
  }
}
