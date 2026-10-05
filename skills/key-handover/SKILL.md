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

### 1. Generate the request

```bash
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

### 2. Decrypt the code (run exactly one of these)

`fast authorize complete` consumes the pending request: a second run fails
with `NO_PENDING_REQUEST`, and the user has to approve again. So pick one
form and run it once.

**To use the wallet with the `fast` CLI** (the usual case). `authorize
complete` only decrypts the key; it doesn't add an account, so `fast send`
and `fast info balance` would keep using the CLI's own account. Decrypt
straight into a key file and import it, so the key never appears in your
output, the shell history or the process list. Set `NAME` to an account name
that isn't in `fast account list` yet (the import fails with
`ACCOUNT_EXISTS` otherwise), and set `FAST_PASSWORD` first if the key should
be stored encrypted.

```bash
NAME=app-wallet     # an account name not in `fast account list` yet
KEYFILE=$(mktemp)   # created with mode 0600
if ! fast authorize complete --message '<the code they pasted>' --print-account --json \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);if(!r.private_key){process.stderr.write(s);process.exit(1)}process.stderr.write(`Approved address: ${r.address}\n`);process.stdout.write(JSON.stringify({privateKey:r.private_key}))})' \
  > "$KEYFILE"; then
  rm -f "$KEYFILE"; false   # nothing was decrypted; the error is on stderr
elif fast account import --name "$NAME" --key-file "$KEYFILE" --json; then
  rm -f "$KEYFILE"
else
  echo "Import failed. The decrypted key is kept in $KEYFILE (mode 0600): fix the error, retry the import with a new --name and --key-file, then delete the file." >&2
  false
fi
```

Note the `Approved address` it prints: that is the wallet the user approved.

If the import fails, the request is already consumed, so don't run
`authorize complete` again. Fix the cause, then rerun only the import, with
an explicit `--name` (without one, the import picks an automatic
`account-N` name):

```bash
NAME=app-wallet-2   # another name not in `fast account list`
fast account import --name "$NAME" --key-file "$KEYFILE" --json && rm -f "$KEYFILE"
```

From then on, use only the account that the successful import returned:
check that its `data.fastAddress` is the `Approved address`, then pass
`--account <data.name>` to the commands that should use it (or run
`fast account set-default <data.name>` if the user wants it as the default).
Never fall back to a name whose import failed: an account with that name
already existed and holds a different key.
Don't use `fast account import --private-key`: it puts the key on the
command line.

**When the key is needed outside the CLI** (for example, your own SDK code):

```bash
fast authorize complete --message '<the code they pasted>' --json
# → { "private_key": "0x..." }   (a bare object, not the usual { "ok": true, "data": ... })
```

After success, confirm to the user that the key was received. **Do not echo
the private key back to them** — they already have it in their wallet.
