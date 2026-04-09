# @fastxyz/fast-cli

Fast CLI for account management, token transfers, network queries, and x402 payments.

## What this package does

The Fast CLI is the primary way to interact with the Fast network. It provides terminal commands for creating accounts, checking balances, sending tokens, funding via fiat on-ramps, and paying for x402-protected resources. All skill operations in this monorepo rely on the CLI under the hood.

## Installation

```bash
npm install -g @fastxyz/fast-cli
```

Or use via pnpm in the repo:

```bash
pnpm cli --help
```

## Common Commands

### Account Management

```bash
# Create a new account
fast account create --name my-account

# List all accounts
fast account list

# Delete an account
fast account delete --name my-account
```

### Balance and Network Info

```bash
# Check balance for an address
fast info balance --address fast1...

# Check balance for an account by name
fast info balance --account my-account
```

### Sending Tokens

```bash
# Send tokens to an address
fast send --to fast1recipient... --amount 1000 --token 0x...

# Send using account name as sender
fast send --account my-account --to fast1recipient... --amount 1000 --token 0x...
```

### Fiat On-Ramp

```bash
# Fund your account via fiat on-ramp
fast fund fiat --network mainnet
```

### x402 Payments

```bash
# Pay for an x402-protected resource
fast pay https://api.example.com/protected --network mainnet
```

## See Also

- Root [README](../README.md) for monorepo overview
- [@fastxyz/sdk](../packages/fast-sdk/README.md) for SDK documentation
