---
'@fastxyz/cli': minor
---

Add the key-handover flow to `@fastxyz/sdk/wallet`. An agent calls `KeyHandoverAgent.generateAuthRequest()` to produce an HPKE-encrypted authorization request (an `auth_url` plus a 6-digit verification code); the user approves it in the Fast wallet, and `decryptAuthPayload()` turns the returned handover code into the account's ed25519 private key. Also exports the wallet-side helpers `parseAuthRequest` / `sealHandover` and the `KEY_HANDOVER_ERROR` codes. Uses HPKE Base mode — DHKEM(X25519, HKDF-SHA256) with AES-256-GCM — binding the ciphertext to the exact request bytes; `decryptAuthPayload` accepts either a bare base64url code or a quoted chat message.
