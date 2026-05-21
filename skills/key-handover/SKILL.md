---
name: key-handover
description: Hand off control of a Fast agent account to a local agent using the encrypted key-handover flow in @fastxyz/sdk. Use when the user wants to authorize an agent to sign for a Fast (FastSet) account — generate an authorization link plus a verification code, then decrypt the wallet's encrypted handover code to obtain the account private key.
---

# Key handover

How an agent obtains signing authority for a Fast agent account through the
encrypted key-handover flow in [`@fastxyz/sdk`](https://www.npmjs.com/package/@fastxyz/sdk),
imported from `@fastxyz/sdk/wallet`.

## Constraints (read first)

1. **One process for the whole flow.** `generateAuthRequest` and
   `decryptAuthPayload` must run on the *same* `KeyHandoverAgent` instance in a
   *single long-lived process*. The request-local HPKE private key lives only in
   memory; if the process exits between generate and decrypt, the request is
   unrecoverable and you must start over. Never run generate in one `node`
   invocation and decrypt in another. The hard part is that the process must
   stay alive *while you wait for the user to paste the handover code* — keep
   one process running across that pause; do not exit and resume.

2. **Never fabricate the handover code.** After generating the request you MUST
   stop and wait for the human to authorize in their wallet and paste back the
   encrypted handover code. Do not invent, guess, or proceed without it.

3. **The decrypted result is a raw private key.** `decryptAuthPayload` returns
   the account's ed25519 seed in plaintext. Never log it, echo it to the user,
   write it to disk, or place it in tool output.

## Flow

```ts
import { KeyHandoverAgent, KEY_HANDOVER_ERROR } from "@fastxyz/sdk/wallet";

const agent = new KeyHandoverAgent(); // one instance, kept alive for both steps

// 1. Generate the request.
const req = await agent.generateAuthRequest({ requester: "my-agent" });
// req.auth_url            -> open in the Fast wallet
// req.request_fingerprint -> 6-digit code the user verifies in the wallet
// req.request_expires_at  -> ISO time, ~5 minutes out

// 2. Show the user auth_url + the 6-digit code, then WAIT for them to authorize
//    in the wallet and paste back the encrypted handover code.

// 3. Decrypt the pasted code.
const res = await agent.decryptAuthPayload({ message: pastedFromUser });
if (res.status === "success") {
  // res.private_key: the account's ed25519 seed (32-byte hex). You now hold the key.
  // 4. Tell the user the key was received. That ends the flow — do not reveal the key.
} else {
  // res.error.code / res.error.message — e.g. expired, too many failures, malformed.
}
```

After a successful decrypt, simply confirm to the user that the key was
received; that is the end of the flow.

What to tell the user at step 2: open `auth_url` in their Fast wallet, type the
6-digit `request_fingerprint` to confirm the request matches, approve, then copy
the encrypted code back to you. The link expires at `request_expires_at`.

## API

- `new KeyHandoverAgent(opts?)` — `opts.walletBaseUrl` overrides the authorize
  page URL (defaults to the production wallet); `opts.now`, `opts.handleTtlMs`
  are for testing.
- `generateAuthRequest({ requester? })` →
  `{ auth_url, request_fingerprint, request_expires_at }`.
- `decryptAuthPayload({ message })` →
  `{ status: "success", private_key }` | `{ status: "error", error: { code, message } }`.
  `message` may be the bare base64url code or a chat message that quotes it.
- `KEY_HANDOVER_ERROR` — error-code constants for matching `error.code`.

## Notes

- The 6-digit fingerprint lets the user confirm the request shown in the wallet
  is the one you generated; it is computed identically on both sides.
- A fresh `generateAuthRequest` discards any previous pending request.
