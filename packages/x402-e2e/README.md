# Live x402 compatibility gate

Status: **pending live execution**. Offline checks do not establish on-chain compatibility or authorize publishing. No live payments were made while creating this harness.

The dedicated matrix uses genuine published npm baselines (`@fastxyz/x402-client@1.0.10` and `@fastxyz/x402-server@1.0.1`) via `-v1` aliases, and the workspace client/server as the candidate 1.1 implementation. Workspace version numbers need not yet say 1.1 before minor changesets are applied. The old implementation is never an alias of current source. All cases use the current dual-protocol facilitator.

Four client/server pairs (1.0/1.0, 1.0/1.1, 1.1/1.0, 1.1/1.1) run sequentially on Fast testnet, then sequentially on Base Sepolia. Each case makes one $0.001 USDC payment (1000 raw units at six decimals): eight payments, **$0.008 total plus additional network/gas fees**. There are no bridges or harness retries. Each case owns ephemeral loopback-only facilitator/content servers, closed in `finally`.

## Offline checks

The EVM content route echoes the middleware's real `X-PAYMENT-RESPONSE` transaction hash into its JSON body. This is needed because the genuine published 1.0 client only reads settlement hashes from the body, not receipt headers. It is an application response adaptation, not a modification of either baseline package; the hash must still correspond to a successful on-chain receipt.

```sh
pnpm --filter @fastxyz/x402-e2e build
pnpm --filter @fastxyz/x402-e2e test
pnpm --filter @fastxyz/x402-e2e test:live-matrix
```

The ordinary test configuration excludes both live payment files, so the default command never pays. The last command skips all eight cases without explicit opt-in; a skipped run is **not** a release gate pass. Neither suite auto-loads `.env`. The older standalone Fast suite also requires `X402_LIVE_FAST=1`; do not use it as the eight-case release gate.

## Operator-provisioned live run

Only run after explicitly authorizing these testnet transfers. Supply environment variables externally; never commit keys or print their values:

| Variable                               | Required value/purpose                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------ |
| `X402_LIVE_MATRIX`                     | `1`, explicit spending opt-in                                                              |
| `FAST_TEST_RPC_URL`                    | `https://testnet.api.fast.xyz/proxy-rest`, pinned to `@fastxyz/sdk/networks` `testnet.url` |
| `FAST_TEST_SIGNER_PRIVATE_KEY`         | Funded testnet USDC payer, 32-byte hex                                                     |
| `FAST_TEST_RECIPIENT_PRIVATE_KEY`      | Separate operator-controlled recipient, not a public/fixed seed                            |
| `BASE_SEPOLIA_RPC_URL`                 | HTTPS RPC; remote chain ID must equal 84532 before any payment                             |
| `BASE_SEPOLIA_PAYER_PRIVATE_KEY`       | Funded Base Sepolia USDC payer                                                             |
| `BASE_SEPOLIA_RECIPIENT_PRIVATE_KEY`   | Separate operator-controlled recipient                                                     |
| `BASE_SEPOLIA_FACILITATOR_PRIVATE_KEY` | Separate, limited-balance gas wallet                                                       |
| `X402_CONTROLLED_RECIPIENTS`           | `1`, confirms ownership/control of both recipients                                         |
| `X402_MAX_FACILITATOR_ETH_WEI`         | Positive maximum permitted balance of the limited gas wallet, in wei                       |

Private keys accept a single optional `0x` prefix. Payer/recipient keys must be distinct; all three EVM wallets must be distinct. Provision the facilitator with only the ETH you authorize spending; its on-chain balance must be positive and no greater than your configured ceiling before each case. This bounds funds at risk in that wallet, not a promised per-transaction gas price. Do not refill it during a run. Fast transaction fees are additional: similarly limit funds in the Fast payer.

This compatibility harness trusts the pinned official Fast testnet RPC as its network authority and does not require independently provisioned committee keys. It uses the facilitator's existing RPC-trust path (which emits a warning), without changing production verification. A Fast matrix case is counted only after the separate RPC certificate lookup succeeds, its independently recomputed transaction hash matches the paid result, and the recipient balance increases by exactly 1000 units. RPC errors, missing certificates, mismatched hashes, or balance failures fail the gate; they are never skipped. This tests compatibility, not independent validator-membership authentication. The older standalone Fast suite is still not the publication gate.

Base Sepolia USDC is `0x036CbD53842c5426634e7929541eC2318f3dCF7e`, with EIP-712 name `USDC`, version `2`. Fast token ID is `0xd73a0679a2be46981e2a8aedecd951c8b6690e7d5f8502b34ed3ff4cc2163b46`. Both token decimals are independently checked before payment.

```sh
# With the complete environment provisioned and X402_LIVE_MATRIX=1:
pnpm --filter @fastxyz/x402-e2e test:live-gate
```

The gate fails without opt-in, on incomplete/unsafe configuration, on any failed assertion, or without all eight successes. Assertions cover the legacy 402 body for every server, v2 `PAYMENT-REQUIRED` only for the candidate server, actual paid request headers (`X-PAYMENT` for old/mixed pairs, `PAYMENT-SIGNATURE` for new/new), paid content, payment network/recipient/asset, transaction hash confirmation, and an exact 1000-raw-unit recipient balance increase. Fast reports raw amount `1000`; EVM currently reports humanized `0.001` in both baseline and candidate. Base checks the successful receipt; Fast independently fetches the payer certificate by nonce and recomputes its transaction hash. No successful live gate or publication is claimed until the operator runs this command and records all eight passes.
