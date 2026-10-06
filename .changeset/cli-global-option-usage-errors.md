---
"@fastxyz/cli": patch
---

Usage errors now find the command after global options that take a value: `fast --network mainnet send` reports the missing `<address>` instead of "Unknown command 'mainnet'", and the same holds for `--account` and `--password`.
