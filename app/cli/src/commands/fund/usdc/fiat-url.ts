const RAMP_BASE = "https://ramp.fast.xyz";

/**
 * Build the `ramp.fast.xyz` URL for the fiat on-ramp flow.
 * Uses URLSearchParams so the address can't be smuggled as raw query text
 * (e.g. an address containing `&to=other` would otherwise produce duplicate params).
 */
export function buildRampUrl(toAddress: string): string {
  const params = new URLSearchParams({ to: toAddress });
  return `${RAMP_BASE}/?${params.toString()}`;
}
