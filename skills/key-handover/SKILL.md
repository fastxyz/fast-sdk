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

If it's not installed, install it yourself, as the `fast` skill's Agent
Bootstrap does: tell the user in one line first ("Installing the Fast CLI,
`@fastxyz/cli`."), and don't use `sudo`. It needs Node.js 20, 22 or newer.

```bash
npm install -g @fastxyz/cli@latest
```

If a global install isn't allowed, run the commands below through
`npx -y @fastxyz/cli@latest` instead of `fast`.

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
# → { "private_key": "0x..." }   (a bare object, not the usual { "ok": true, "data": ... })
```

After success, confirm to the user that the key was received. **Do not echo
the private key back to them** — they already have it in their wallet.

`authorize complete` only decrypts the key; it doesn't add an account to the
CLI, so `fast send` and `fast info balance` keep using the CLI's own account.
To use the handed-over wallet with the CLI, decrypt it straight into a key
file and import that, so the key never appears in your output, the shell
history or the process list:

```bash
# Set FAST_PASSWORD first if the key should be stored encrypted.
KEYFILE=$(mktemp)   # created with mode 0600
fast authorize complete --message '<the code they pasted>' --json \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);if(!r.private_key){process.stderr.write(s);process.exit(1)}process.stdout.write(JSON.stringify({privateKey:r.private_key}))})' \
  > "$KEYFILE" \
  && fast account import --name app-wallet --key-file "$KEYFILE" --json
rm -f "$KEYFILE"
```

Then pass `--account app-wallet` to the commands that should use it, or run
`fast account set-default app-wallet` if the user wants it as the default.
Don't use `fast account import --private-key`: it puts the key on the
command line.
