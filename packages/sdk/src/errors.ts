/**
 * errors.ts — Structured error codes for Fast SDK.
 */

export type FastErrorCode =
	| 'INSUFFICIENT_BALANCE'
	| 'NETWORK_NOT_CONFIGURED'
	| 'TX_FAILED'
	| 'INVALID_ADDRESS'
	| 'TOKEN_NOT_FOUND'
	| 'INVALID_PARAMS'
	| 'UNSUPPORTED_OPERATION'
	| 'KEYFILE_NOT_FOUND';

export class FastError extends Error {
	readonly code: FastErrorCode;
	readonly note: string;

	constructor(
		code: FastErrorCode,
		message: string,
		opts?: { note?: string }
	) {
		super(message);
		this.name = 'FastError';
		this.code = code;
		this.note = opts?.note ?? '';
	}

	toJSON(): Record<string, unknown> {
		return {
			error: true,
			code: this.code,
			message: this.message,
			note: this.note,
		};
	}
}
