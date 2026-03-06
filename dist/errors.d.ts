/**
 * errors.ts — Structured error codes for Fast SDK.
 *
 * Every throwable error from the SDK is a FastError with a machine-readable
 * `code`. Agents can switch on `code` instead of parsing message strings.
 */
export type FastErrorCode = 'INSUFFICIENT_BALANCE' | 'CHAIN_NOT_CONFIGURED' | 'TX_FAILED' | 'INVALID_ADDRESS' | 'TOKEN_NOT_FOUND' | 'INVALID_PARAMS' | 'UNSUPPORTED_OPERATION';
export declare class FastError extends Error {
    readonly code: FastErrorCode;
    readonly note: string;
    constructor(code: FastErrorCode, message: string, opts?: {
        note?: string;
    });
    toJSON(): Record<string, unknown>;
}
//# sourceMappingURL=errors.d.ts.map