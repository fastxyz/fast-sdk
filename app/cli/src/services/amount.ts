import { InvalidAmountError } from '../errors/index.js';

/** Format base units as an exact decimal string (`100000`, 6 → `0.1`), trimming trailing zeros. */
export const formatBaseUnits = (amount: bigint, decimals: number): string => {
  const negative = amount < 0n;
  const digits = (negative ? -amount : amount).toString();
  if (decimals === 0) return `${negative ? '-' : ''}${digits}`;
  const padded = digits.padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, '');
  return `${negative ? '-' : ''}${fraction ? `${whole}.${fraction}` : whole}`;
};

/**
 * Parse a positive human-readable amount (`10`, `1.5`) into base units using
 * string arithmetic, so the result is exact (no float rounding). Errors use the
 * same wording as `fast send` and fail with INVALID_AMOUNT.
 */
export const parsePositiveAmount = (input: string, decimals: number, tokenLabel: string): bigint => {
  const trimmed = input.trim();
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(trimmed)) {
    throw new InvalidAmountError({
      message: `Invalid amount "${input}". Expected a positive number (e.g., 10 or 1.5).`,
    });
  }
  const [whole = '', fraction = ''] = trimmed.split('.');
  if (fraction.length > decimals) {
    throw new InvalidAmountError({
      message: `Amount has too many decimal places for ${tokenLabel} (max ${decimals})`,
    });
  }
  const raw = BigInt(`${whole || '0'}${fraction.padEnd(decimals, '0')}`);
  if (raw <= 0n) {
    throw new InvalidAmountError({
      message: `Amount must be greater than zero (got "${input}").`,
    });
  }
  return raw;
};
