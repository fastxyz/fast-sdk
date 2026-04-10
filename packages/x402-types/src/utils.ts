/**
 * Shared utilities for x402.
 * Pure functions with zero dependencies.
 */

/**
 * Parse a human-readable price string into raw token units.
 *
 * Supports formats:
 * - "$0.10" → "100000"
 * - "0.1 USDC" → "100000"
 * - "100000" → "100000" (passthrough)
 *
 * @param price  Human-readable price string
 * @param decimals  Token decimals (default: 6 for USDC)
 */
export function parsePrice(price: string, decimals: number = 6): string {
  const cleaned = price
    .replace(/[$,\s]/g, '')
    .replace(/usdc/i, '')
    .trim();

  if (/^\d+$/.test(cleaned)) {
    return cleaned;
  }

  const value = parseFloat(cleaned);
  if (isNaN(value)) {
    throw new Error(`Invalid price format: ${price}`);
  }

  const amount = Math.round(value * Math.pow(10, decimals));
  return amount.toString();
}

/**
 * Encode a value as a base64 JSON string (for X-PAYMENT / X-PAYMENT-RESPONSE).
 */
export function encodePayload(value: unknown): string {
  // Use Buffer (available in Node.js) for base64 encoding
  return Buffer.from(JSON.stringify(value)).toString('base64');
}

/**
 * Decode a base64 JSON string.
 */
export function decodePayload<T = unknown>(encoded: string): T {
  return JSON.parse(Buffer.from(encoded, 'base64').toString('utf-8')) as T;
}
