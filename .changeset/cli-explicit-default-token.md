---
"@fastxyz/cli": minor
"@fastxyz/x402-client": patch
---

CLI: `send` and `fund usdc crypto` now resolve omitted `--token` to `network.defaultToken.symbol` (sourced from the SDK — `fastUSD` on mainnet, `testUSDC` on testnet) instead of silently falling back to the first chain's first token. When the resolved token isn't available on the targeted chain, the CLI errors with the new `CommandUnsupportedForTokenError` (exit code 2, `COMMAND_UNSUPPORTED_FOR_TOKEN`); typos still surface as `TokenNotFoundError`.

The PR-#87 default-resolution helpers (`pickDefaultTokenName`, `resolveDefaultToken`, `selectSendTokenName`) and the CLI-only `fastTokens` map are removed in favor of the single SDK-driven path. Custom networks added via `fast network add` should now use `defaultToken` in their JSON.

x402-client: `X402PayResult.payment.amount` for Fast payments now returns the raw integer string (smallest-unit form) instead of a hardcoded-6-decimals humanization. The wire format does not carry decimals; consumers should humanize using their own token-decimals registry. The CLI's `fast pay` command was updated to humanize for display.

Also removes the broken `"… raw → … USDC"` diagnostic log line in `x402-client/src/fast.ts`.
