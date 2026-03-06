/**
 * utils.ts — Shared utilities for money SDK
 *
 * Decimal/amount conversion and path helpers.
 */
/**
 * Resolve a writable home directory.
 * Falls back to a temp directory when HOME/os.homedir() are unavailable.
 */
export declare function resolveHomeDir(): string;
/**
 * Expand `~` in a path string to the user's home directory.
 */
export declare function expandHome(p: string): string;
/** Convert human-readable decimal (e.g. "1.5") to raw bigint */
export declare function toRaw(humanAmount: string, decimals: number): bigint;
/** Convert raw amount to human-readable decimal */
export declare function toHuman(rawAmount: bigint | number | string, decimals: number): string;
/** Convert human-readable decimal to hex string (for Fast protocol) */
export declare function toHex(humanAmount: string, decimals: number): string;
/** Convert hex string to human-readable decimal (for Fast protocol) */
export declare function fromHex(hexAmount: string, decimals: number): string;
/**
 * Compare two decimal number strings without floating-point precision loss.
 * Normalises both strings to the same number of decimal places, converts to
 * BigInt, and compares. Returns -1, 0, or 1.
 */
export declare function compareDecimalStrings(a: string, b: string): number;
//# sourceMappingURL=utils.d.ts.map