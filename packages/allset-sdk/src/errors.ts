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
  | 'POST_PAYMENT_INCOMPLETE'
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

function toJsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array) return Array.from(value);
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, toJsonSafe(nested)]));
  }
  return value;
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

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      stage: this.stage,
      txHash: this.txHash,
      mayHaveSettled: this.mayHaveSettled,
      ...(this.relatedTxHash ? { relatedTxHash: this.relatedTxHash } : {}),
      recoveryEnvelope: toJsonSafe(this.recoveryEnvelope),
    };
  }
}

export type PostPaymentExecutionStage = 'transfer-cross-sign' | 'intent-cross-sign' | 'relay';
export type RelayOutcome = 'rejected' | 'unknown';

export interface RecoveryTransaction {
  readonly txHash: string;
  readonly recoveryEnvelope: unknown;
}

/**
 * One or more Fast transactions have verified success certificates, but a
 * later cross-sign or relay step did not complete. Reconcile the listed
 * transactions before continuing; rerunning executeIntent can submit a new
 * transfer and duplicate the operation.
 */
export class PostPaymentRecoveryError extends FastError {
  readonly stage: PostPaymentExecutionStage;
  readonly transfer: RecoveryTransaction;
  readonly intent?: RecoveryTransaction;
  readonly relayOutcome?: RelayOutcome;
  readonly cause?: unknown;

  constructor(params: {
    readonly stage: PostPaymentExecutionStage;
    readonly transfer: RecoveryTransaction;
    readonly intent?: RecoveryTransaction;
    readonly relayOutcome?: RelayOutcome;
    readonly cause?: unknown;
  }) {
    super(
      'POST_PAYMENT_INCOMPLETE',
      `Fast transaction submission succeeded, but ${params.stage} did not complete. Do not retry executeIntent blindly.`,
      {
        note: 'Reconcile the Fast transaction identities and recovery envelopes attached to this error before continuing.',
      },
    );
    this.name = 'PostPaymentRecoveryError';
    this.stage = params.stage;
    this.transfer = structuredClone(params.transfer);
    this.intent = params.intent ? structuredClone(params.intent) : undefined;
    this.relayOutcome = params.relayOutcome;
    this.cause = params.cause;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      stage: this.stage,
      transfer: toJsonSafe(this.transfer),
      ...(this.intent ? { intent: toJsonSafe(this.intent) } : {}),
      ...(this.relayOutcome ? { relayOutcome: this.relayOutcome } : {}),
    };
  }
}
