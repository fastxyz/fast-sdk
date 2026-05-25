---
"@fastxyz/sdk": patch
"@fastxyz/cli": minor
---

Add the encrypted key-handover flow.

- `@fastxyz/sdk/wallet`: new `KeyHandoverAgent` (`generateAuthRequest` /
  `decryptAuthPayload`) implementing the HPKE Base / DHKEM(X25519,
  HKDF-SHA256) / AES-256-GCM protocol bound to the byte-exact request
  payload. Wallet-side `parseAuthRequest` / `sealHandover` helpers and
  `KEY_HANDOVER_ERROR` codes are exported. New `KeyHandoverAgent.exportPending()`
  / `restore()` enable cross-process flows. Fix: `decryptAuthPayload` now
  routes `INVALID_HANDOVER_CODE` distinctly from `MALFORMED_HANDOVER_MESSAGE`.
- `@fastxyz/cli`: new `fast authorize request` / `fast authorize complete`
  commands that wrap the protocol so shell-based agents can obtain a Fast
  account private key without writing SDK glue. State is persisted at
  `~/.fast/handover-pending.json` (mode 0600, ~5 min, single-pending)
  between the two commands.
