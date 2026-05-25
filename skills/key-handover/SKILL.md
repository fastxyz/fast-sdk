---
name: key-handover
description: Hand off a Fast account's signing key from the user's wallet to your agent runtime using fast-cli's `authorize` commands. Use when the user wants to authorize you to sign on their behalf for a Fast account.
---

# Key handover (fast-cli)

## Setup

Check if fast-cli is installed:

```bash
fast --version
```

If it's not installed, ask the user to install it and wait for them to confirm
— **do not install it yourself**. Show them this command:

```bash
npm install -g @fastxyz/cli
```

## Flow

```bash
# 1. Generate the request.
fast authorize request --requester "my-agent" --json
# → { "auth_url": "...", "request_fingerprint": "123456", "request_expires_at": "..." }
```

If the user specified a particular authorize URL (e.g., a dev or staging
environment), pass it via `--url <URL>`.

Show `auth_url` and the 6-digit `request_fingerprint` to the user. Tell them
to open the URL in their Fast wallet, verify the fingerprint matches,
approve, then paste back the encrypted handover code.

**STOP and wait.** Do not fabricate or guess the handover code. It can only
come from the user after they approve in their wallet.

```bash
# 2. Once the user pastes the code, decrypt it.
fast authorize complete --message '<the code they pasted>' --json
# → { "private_key": "0x..." }
```

After success, confirm to the user that the key was received. **Do not echo
the private key back to them** — they already have it in their wallet.
