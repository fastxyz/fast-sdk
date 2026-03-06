/**
 * errors.ts — Structured error codes for Fast SDK.
 *
 * Every throwable error from the SDK is a FastError with a machine-readable
 * `code`. Agents can switch on `code` instead of parsing message strings.
 */
export class FastError extends Error {
    code;
    note;
    constructor(code, message, opts) {
        super(message);
        this.name = 'FastError';
        this.code = code;
        this.note = opts?.note ?? '';
    }
    toJSON() {
        return {
            error: true,
            code: this.code,
            message: this.message,
            note: this.note,
        };
    }
}
//# sourceMappingURL=errors.js.map