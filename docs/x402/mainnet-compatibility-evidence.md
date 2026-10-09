# x402 Release 1 — mainnet compatibility evidence

Recorded 2026-10-08. Original versioned candidate: `fb2ce143c8ea868105a6e23d3c623878a0dd0bf4` (PR #186). Runtime x402 sources were unchanged during these experiments. The local harness adapters were not the subsequently retargeted PR #187 head; this is historical operational evidence, not a claim that the updated harness was rerun.

Published baselines: client 1.0.10 and server 1.0.1. Candidate client/server/facilitator/types: 1.1.0. Four combinations per network each paid exactly 1000 raw units, returned HTTP 200 and credited the controlled recipient. Total: 4000 fastUSD units on FAST and 4000 USDC units on Base ($0.008 combined). Base aggregate gas including L1 cost: 2171618745856 wei (0.000002171618745856 ETH). No FAST mainnet fee was charged in the recorded experiment.

## FAST mainnet

Each certificate had three distinct cryptographically verified signatures. Certificates were separately fetched by sender/nonce and their transaction hashes recomputed. This uses official-RPC trust; it is not independent validator-membership provisioning.

| Client/server | Nonce | Header | Confirmed transaction |
| --- | --- | --- | --- |
| 1.0 / 1.0 | 0 | X-PAYMENT | [59b338…2c00](https://explorer.fast.xyz/txs/0x59b338a9bbd5594c4d10993f8348d8b48cbd186c68fcc8053c2ff841155b2c00) |
| 1.0 / 1.1 | 1 | X-PAYMENT | [c3e67d…92e9](https://explorer.fast.xyz/txs/0xc3e67d0e5901d896710a432b98faa1b6a097a5345a6fd83965462b1114f192e9) |
| 1.1 / 1.0 | 2 | X-PAYMENT | [ea3e53…1b48](https://explorer.fast.xyz/txs/0xea3e53895346de83d46e59646b0ce82ba029b353c8e95cbfaadf24855bb21b48) |
| 1.1 / 1.1 | 3 | PAYMENT-SIGNATURE (v2) | [7434e8…6017](https://explorer.fast.xyz/txs/0x7434e81224c69f805ea2f540993378a8672fb3a4f86caeb28f596c4a313d6017) |

Payer fastUSD: 4000 → 0; recipient: 0 → 4000; payer nonce: 0 → 4, before later wallet refunds.

## Base mainnet — chain 8453

Native USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, EIP-712 `USD Coin`, version 2.

| Client/server | Receipt block | Outcome | Confirmed transaction |
| --- | --- | --- | --- |
| 1.0 / 1.0 | 52352662 | HTTP 200; confirmed by read-only reconciliation | [083b6a…43e2](https://basescan.org/tx/0x083b6ae1e498f4a0a4a6ebeba357b94d8b2465c02df6d907198958d9587043e2) |
| 1.0 / 1.1 | 52352858 | HTTP 200; confirmed by read-only reconciliation | [7a3e04…d2c7](https://basescan.org/tx/0x7a3e04f9147e62a99bf98810b772b7999af2ce50932b37d118015c1ea0cad2c7) |
| 1.1 / 1.0 | 52352927 | HTTP 200; X-PAYMENT; confirmed | [2ec4ca…b65b](https://basescan.org/tx/0x2ec4ca861308fd05891bfe47fe02778f297b280bf05dfd595f540f55940ab65b) |
| 1.1 / 1.1 | 52352929 | HTTP 200; PAYMENT-SIGNATURE (v2); confirmed | [af2b4f…e0d8](https://basescan.org/tx/0xaf2b4fe7ce2811c7306ca5e3f0d9cbd0982f30898a4e18040fd4160a6900e0d8) |

The first payment's immediate balance assertion read a stale zero. Later receipt, Transfer event and balance queries confirmed its 1000-unit credit. The second payment returned HTTP 200, but its executor stopped during verification; read-only pinned-block queries confirmed the additional 1000-unit credit. The original second exception was suppressed, so no specific RPC root cause is claimed. Neither payment was repeated. Execution continued only with unexecuted pairs after reconciliation.

Payer USDC: 10000 → 6000; recipient: 0 → 4000; facilitator ETH: 100000000000000 → 97828381254144 wei, before refunds. The recipient supplied facilitator gas, independently of the payer.

## Candidate tarball SHA-256

| Package | SHA-256 |
| --- | --- |
| x402-client 1.1.0 | `41c569f5912b9b538672e8664275528ff14fc20424807340f010a44bb4431416` |
| x402-facilitator 1.1.0 | `0ed8b65425338d9b904236317849a1a21c46820906c60c3289b2786dd788f979` |
| x402-server 1.1.0 | `ec7fd9f5916813f268cfcfb0a484221f9907c6556fa585a44db3d4d2004c24d3` |
| x402-types 1.1.0 | `8277ec3e880a0a6de70b268a29207b1dde31ac1ce5d712a2079613533b37f292` |

These eight reconciled outcomes establish the recorded mainnet compatibility experiment. They are not eight uninterrupted passes from the new harness head, do not attest future package publication, and do not authorize another funded run. The maintenance of PR #187 executes offline tests only.
