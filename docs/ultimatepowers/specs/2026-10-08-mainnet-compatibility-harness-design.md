# Mainnet compatibility harness alignment

Approved by the user on 2026-10-08. Scope: update PR #187, targeting develop; no new payments, publication or production-verifier changes.

The eight-case matrix targets the SDK-pinned FAST mainnet with fastUSD and Base chain 8453 with native USDC. The four client/server combinations use published 1.0 baselines and the current workspace candidate. Mainnet execution requires both the existing live opt-in and an explicit mainnet-spending acknowledgement, external credentials, controlled recipients and bounded facilitator gas funding. The facilitator can share the recipient wallet, but neither can share the payer wallet.

FAST uses the existing empty-committee RPC-trust path, retaining the production minimum of three valid distinct signatures. Cases additionally require fetched certificate/hash confirmation and exact recipient credit. Base uses USD Coin/version 2 and confirms its receipt and recipient credit at the receipt block, avoiding an immediate latest-state balance assumption. No payment retries, topology downgrade, new quorum policy, bridge or automatic refund is added.

Documentation records the eight already-confirmed payments from candidate fb2ce143c8ea868105a6e23d3c623878a0dd0bf4, including the first two Base read-only reconciliations. Historical evidence does not count as a new execution of the retargeted harness. The obsolete standalone suite is retargeted to FAST mainnet and remains outside the matrix gate. Ordinary tests remain offline; missing spending opt-in must fail the release-gate command and skip the non-gate live command.
