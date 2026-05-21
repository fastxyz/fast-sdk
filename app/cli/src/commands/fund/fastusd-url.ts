const APP_BASE = "https://app.fast.xyz/send";

/**
 * Build the `app.fast.xyz/send` URL that opens the unified Fast funding flow.
 * The web app accepts both query params as optional and prompts the user when missing.
 */
export function buildFundFastUsdUrl(
  to: string,
  amount: string | undefined,
): string {
  const params = new URLSearchParams({ to });
  if (amount !== undefined) {
    params.set("amount", amount);
  }
  return `${APP_BASE}?${params.toString()}`;
}
