# fast CLI

A command-line tool for the [Fast network](https://fast.xyz) — manage accounts, send USDC, bridge tokens between EVM chains and Fast, fund via fiat, and pay x402-protected APIs.

## Installation

**Requires Node.js 18+**

```bash
npm install -g @fastxyz/cli
```

Verify:

```bash
fast --version
fast --help
```

## Quick Start

```bash
# Create an account
fast account create

# Check balances
fast info balance

# Send USDC
fast send fast1abc...xyz 10

# Bridge from Arbitrum Sepolia to Fast
fast fund crypto 50 --chain arbitrum-sepolia

# Pay an x402-protected API
fast pay https://api.example.com/resource
```

## Environment

| Variable | Description |
|---|---|
| `FAST_PASSWORD` | Keystore password (preferred over `--password` flag) |

## AI Agent Skill

Install the Copilot CLI skill to let AI agents operate the `fast` CLI on your behalf:

```bash
npx skills add https://github.com/fastxyz/fast-sdk/tree/main/skills
```

The skill teaches the agent how to bootstrap, install, and use every `fast` command — including bridging flows, x402 payments, and JSON-mode scripting.

## Documentation

Full command reference and workflows: [`skills/fast/SKILL.md`](https://github.com/fastxyz/fast-sdk/tree/main/skills/fast/SKILL.md)
