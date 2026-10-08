# Mainnet x402 compatibility harness

The approved compatibility experiment completed four client/server pairs on **FAST mainnet** and **Base mainnet** using the versioned candidate `fb2ce143c8ea868105a6e23d3c623878a0dd0bf4`. See [payment evidence](../../docs/x402/mainnet-compatibility-evidence.md) for all eight hashes, package hashes and the two Base read-only reconciliations. This harness is aligned with that experiment; those historical results are **not a newly executed run of this harness revision**.

The matrix uses genuine published npm baselines (`@fastxyz/x402-client@1.0.10` and `@fastxyz/x402-server@1.0.1`) via `-v1` aliases and the workspace client/server as the candidate 1.1 implementation. Workspace package versions need not yet say 1.1 before versioning. All cases use the current dual-protocol facilitator; baseline implementations are never aliases of current source.

Pairs 1.0/1.0, 1.0/1.1, 1.1/1.0 and 1.1/1.1 run sequentially on FAST, then Base. Each case pays 1000 raw units ($0.001 at six decimals): **$0.008 total plus Base gas**. FAST uses fastUSD; Base uses USDC. There are no bridges or payment retries. Ephemeral servers bind to loopback and close in `finally`.

## Offline checks

```sh
pnpm --filter @fastxyz/x402-e2e build
pnpm --filter @fastxyz/x402-e2e test
# Without X402_LIVE_MATRIX=1, the live suite skips all eight cases:
pnpm --filter @fastxyz/x402-e2e test:live-matrix
```

Ordinary tests exclude both payment files and never spend funds. Neither suite loads `.env`. A skipped live run is not a gate pass. Matrix opt-in without the mainnet-spending acknowledgement fails before execution in both live commands; it is not treated as a skipped run. The older standalone FAST suite also requires `X402_LIVE_FAST=1` and `X402_MAINNET_SPENDING=1`; it is not the eight-case matrix gate.

## Explicitly authorized mainnet execution

This command spends real funds. Provision dedicated, controlled wallets and supply variables externally; never commit private keys or print them. Prior experiments do not authorize another run, and their temporary wallet balances were returned to the original funders.

| Variable | Required value/purpose |
| --- | --- |
| `X402_LIVE_MATRIX` | `1`, enables the matrix |
| `X402_MAINNET_SPENDING` | `1`, explicit acknowledgement of real mainnet spending |
| `FAST_MAINNET_RPC_URL` | `https://api.fast.xyz/proxy-rest`, pinned to SDK `mainnet.url` |
| `FAST_MAINNET_SIGNER_PRIVATE_KEY` | Funded fastUSD payer, 32-byte hex |
| `FAST_MAINNET_RECIPIENT_PRIVATE_KEY` | Separate controlled FAST recipient |
| `BASE_RPC_URL` | HTTPS RPC, checked for chain ID 8453 before payment |
| `BASE_PAYER_PRIVATE_KEY` | Funded Base USDC payer |
| `BASE_RECIPIENT_PRIVATE_KEY` | Separate controlled Base recipient |
| `BASE_FACILITATOR_PRIVATE_KEY` | Limited-balance gas wallet; may be the recipient, never the payer |
| `X402_CONTROLLED_RECIPIENTS` | `1`, confirms control of recipients |
| `X402_MAX_FACILITATOR_ETH_WEI` | Positive maximum permitted gas-wallet balance in wei |

Private keys accept one optional `0x` prefix. Payers must differ from their recipients; the EVM facilitator may be the recipient because gas spends ETH while payment credit is USDC. Limit the FAST payer's fastUSD, Base payer's USDC and facilitator's ETH to the authorized funds. The positive gas balance must not exceed the configured ceiling before each case. This bounds funded ETH at risk, not a guaranteed gas price. Do not refill wallets during a run.

FAST trusts the SDK-pinned official mainnet RPC as network authority and uses the existing empty-committee facilitator path. **Production verification is unchanged: at least three distinct valid certificate signatures are still required.** A separate case-level certificate lookup, matching sender/nonce, independently recomputed transaction hash and exact 1000-unit recipient credit are mandatory. This verifies compatibility under RPC trust, not independently provisioned validator-membership authentication. Missing certificates, RPC errors and failed assertions fail the gate after a payment may already have occurred.

FAST token: SDK `mainnet.defaultToken.tokenId` (`0xc655a12330da6af361d281b197996d2bc135aaed3b66278e729c2222291e9130`), fastUSD, six decimals. Base USDC: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, six decimals, EIP-712 name `USD Coin`, version `2`. Token decimals and Base chain ID are checked before spending.

```sh
# Only after separate authorization and complete external configuration:
pnpm --filter @fastxyz/x402-e2e test:live-gate
```

The gate fails without opt-in, unsafe/incomplete configuration, any failed case or fewer than eight successes. Assertions check the legacy challenge, v2 `PAYMENT-REQUIRED` for candidate servers, paid content and exact amount/network/recipient/asset. Old/mixed pairs send `X-PAYMENT`; new/new sends `PAYMENT-SIGNATURE`. FAST reports raw `1000`; Base reports `0.001`. Base confirms a successful receipt and balance at its block, rather than an immediate `latest` read. Published 1.0 EVM clients read the settlement hash from content, so the content route echoes the middleware's real receipt hash without changing the baseline package.

The live runner stops scheduling cases after the first failure (`bail: 1`); the failed case's `finally` cleanup still runs, and the remaining cases cannot initiate payments. An interrupted matrix cannot satisfy the eight-success gate. Reconcile the recorded transaction before authorizing a new run. A failure after submission is not proof that nothing was paid. No automatic repayment or resume is provided. Offline green checks do not constitute a fresh live execution or authorize merge/publication.
