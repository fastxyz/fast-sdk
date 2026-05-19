---
"@fastxyz/sdk": minor
---

Add `@fastxyz/sdk/wallet` popup-window wallet module. Exposes `FastWalletClient` with `connect()` / `disconnect()` / `sign()`, opening a configurable popup origin (defaulting to `https://app.fast.xyz`) for user interaction and returning the result via `postMessage`. Dapps must supply `metadata` (name, origin, optional icon) so the popup UI can identify the requesting dapp. Configurable `signUrl` / `connectUrl` are composed via `URL` + `URLSearchParams`, so popup URLs that already carry query parameters or fragments are preserved. Origins (`dappOrigin` and `metadata.origin`) are strictly validated against `URL#origin`, so paths, queries, and fragments are rejected. Returned addresses are validated as bech32m `fast1...` strings whose decoded payload is exactly 32 bytes.
