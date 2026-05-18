---
"@fastxyz/sdk": minor
---

Add `@fastxyz/sdk/wallet` popup-window wallet module. Exposes `FastWalletClient` with `connect()` / `disconnect()` / `sign()`, opening a configurable popup origin (defaulting to `https://app.fast.xyz`) for user interaction and returning the result via `postMessage`. Dapps must supply `metadata` (name, origin, optional icon) so the popup UI can identify the requesting dapp.
