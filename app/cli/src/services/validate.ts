/**
 * Lightweight input validators used across CLI commands.
 * Each returns a descriptive error string on failure, or null on success.
 */

const VALID_HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const;

export type HttpMethod = (typeof VALID_HTTP_METHODS)[number];

/** Validate that a string is a valid HTTP/HTTPS URL. */
export function validateUrl(value: string): string | null {
  try {
    const u = new URL(value);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return `URL must start with http:// or https:// (got "${value}")`;
    }
    return null;
  } catch {
    return `Invalid URL: "${value}"`;
  }
}

/** Validate that a string is a recognised HTTP method. */
export function validateHttpMethod(value: string): string | null {
  const upper = value.toUpperCase();
  if (!VALID_HTTP_METHODS.includes(upper as HttpMethod)) {
    return `Invalid HTTP method "${value}". Must be one of: ${VALID_HTTP_METHODS.join(", ")}.`;
  }
  return null;
}

/**
 * Validate a "Key: Value" HTTP header string.
 * The separator must be a colon followed by at least one character.
 */
export function validateHeader(value: string): string | null {
  const idx = value.indexOf(":");
  if (idx <= 0) {
    return `Invalid header "${value}". Expected format: "Key: Value"`;
  }
  return null;
}

/**
 * Validate an account or network name.
 * Names must be 1–64 characters, using only letters, digits, hyphens, and underscores.
 */
export function validateName(value: string, kind = "name"): string | null {
  if (value.length === 0) {
    return `${kind} cannot be empty`;
  }
  if (value.length > 64) {
    return `${kind} is too long (max 64 characters)`;
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
    return `${kind} "${value}" contains invalid characters. Use only letters, digits, hyphens, and underscores.`;
  }
  return null;
}

/**
 * Validate a transaction hash.
 * Accepts 0x-prefixed 64-char hex (32-byte) or bare 64-char hex.
 */
export function validateTxHash(value: string): string | null {
  const bare = value.startsWith("0x") ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]{64}$/.test(bare)) {
    return `Invalid transaction hash "${value}". Expected a 64-character hex string (optionally 0x-prefixed).`;
  }
  return null;
}

/**
 * Validate a human-readable amount string.
 * Returns a descriptive error, or null if valid.
 */
export function validateAmount(value: string): string | null {
  const n = Number.parseFloat(value);
  if (Number.isNaN(n)) {
    return `Invalid amount "${value}". Expected a positive number (e.g., 10 or 1.5).`;
  }
  if (n <= 0) {
    return `Amount must be greater than zero (got "${value}").`;
  }
  return null;
}
