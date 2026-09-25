# @fastxyz/fastid-sdk

Programmatic client for [Fast ID](https://id.fast.xyz), for Node 20.19 or newer.
This package was moved from `fast-id/fastset-id-sdk` and renamed from
`@fastxyz/id-sdk`; update imports to `@fastxyz/fastid-sdk`. The client API is
unchanged. The package is licensed under Apache-2.0, as specified in this
directory's LICENSE, independently of the monorepo's root license.
Copyright (c) Pi Squared, Inc.

## Install

The [public package](https://www.npmjs.com/package/@fastxyz/fastid-sdk) is
available on npm. Pin a version in an agent project:

```sh
npm install @fastxyz/fastid-sdk@0.1.0
```

It builds and runs without access to the private Fast ID repository. The
following source-tarball path is only for testing an unpublished change from a
public `fast-sdk` checkout:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @fastxyz/fastid-sdk... build
corepack pnpm --filter @fastxyz/fastid-sdk pack --pack-destination /tmp/fastid-sdk-pack
# From your consumer project (use the emitted tarball filename):
npm install /tmp/fastid-sdk-pack/fastxyz-fastid-sdk-*.tgz
```

```ts
import { IdClient, KeySigner } from '@fastxyz/fastid-sdk';

const signer = await KeySigner.generate();
const client = new IdClient({ network: 'fast:testnet', signer });
const availability = await client.availability('agent.sdk');
```

The client supports public identity reads, name/website/GitHub/ORCID/X claims,
DOI imports, profile updates, revocation, sealed reports and sharing URLs. Use
`fast:mainnet` when intending to use production. Paid operations use the supplied
signer; preserve pending or indeterminate results instead of paying again.
`retryRegistration` retries registration only and never submits another payment.
When a paid submission is indeterminate, `IndeterminateSubmissionError` exposes
`nonce`, `txIdHex`, and `recoveryEnvelope` (also grouped as `recovery`) for
reconciliation. The envelope is an in-memory structured clone of the signed
submission, not a JSON-safe persistence record; do not create another paid
transaction until the original has been reconciled.
`claimName()` performs a fail-closed identity preflight: a transport failure,
invalid HTTP status, malformed response, or wrong-account/network response stops
before availability, fee resolution, signing, provider submission, or registration.
This contract is specific to the SDK; the website keeps its existing behavior,
and the preflight does not remove races between a read and a later registration.
GitHub/ORCID OAuth uses the existing browser page, the same wallet/network and a
known provider identity; the SDK polls the persisted proof, without receiving
OAuth callbacks or tokens. See the served [agent guide](https://id.fast.xyz/AGENTS.md)
for the full capability and recovery contracts.

## Claim a name and read it back (testnet)

This example **submits a Fast transaction that may carry a network fee**. Use
only a testnet key whose owner has authorized the particular claim and any
applicable fee, and fund that address when a fee applies. Never put a private
key in the source file or print it. A production integration can supply its own
authorized `Signer` instead of loading a key from the environment.

1. Check the current network fee before authorizing the operation:

   | Network | Public `GET /v1/network-info` |
   |---|---|
   | Testnet | https://testnet.api.fast.xyz/proxy-rest/v1/network-info |
   | Mainnet | https://api.fast.xyz/proxy-rest/v1/network-info |

   Confirm `data.network_id`, then find the entry in `data.fees.entries` whose
   `token_id` equals `data.fees.default`. Its `fixed_amount` is a decimal string
   in **atomic units**, not a display amount. For a nonzero fee, fetch the token
   metadata and decimals from `GET /v1/tokens?token_ids=<default>` on the same
   `proxy-rest` origin. An empty authoritative fee list or a zero default fee
   means no fee; a failed or malformed request does **not** mean no fee. The SDK
   resolves the authoritative schedule during the claim and refuses unavailable
   or ambiguous fee data. This preview does not pin the schedule or enforce a
   spending ceiling if the network changes it before submission.

2. Provide `FAST_ID_NAME` and a privately held `FAST_ID_PRIVATE_KEY` (a bare
   64-character hex Ed25519 key) to a Node 20.19+ process. Save the following
   as `claim.mjs` and run `node claim.mjs` **once for this authorization**. Do
   not use a newly generated, unfunded key for a paid claim, and do not rerun
   this script to retry a late read-back.

   ```js
   import { IdClient, KeySigner } from '@fastxyz/fastid-sdk';

   const name = process.env.FAST_ID_NAME;
   const privateKey = process.env.FAST_ID_PRIVATE_KEY;
   if (!name || !privateKey) throw new Error('Missing name or authorized key');

   const signer = await KeySigner.fromPrivateKey(privateKey);
   const client = new IdClient({ network: 'fast:testnet', signer });

   // Advisory read. claimName performs its own fresh, fail-closed preflight.
   const availability = await client.availability(name);
   if (!availability.available) throw new Error('Name is not available');

   const claim = await client.claimName(name); // Signs and submits one claim.

   // Separate index read-back of the registered name and its exact claim tx.
   const identity = await client.identity(signer.address);
   const record = await client.resolve(name);
   if (
     identity.name !== name ||
     identity.name_claim_tx !== claim.txIdHex ||
     record.name !== name ||
     record.address !== signer.address ||
     record.name_claim_tx !== claim.txIdHex
   ) {
     throw new Error('Claim not yet visible in reads; retry reads, not payment');
   }

   console.log({
     txIdHex: claim.txIdHex,
     profileUrl: client.share.profileUrl(name),
   });
   ```

3. This read-back confirms what the Fast ID index currently reports; it is not
   an independent validator-quorum proof of on-chain settlement. If it is not
   yet visible, repeat **only** `identity` and `resolve` with the saved name,
   address and transaction ID; never rerun `claim.mjs` or call `claimName`
   merely because a read is late. If `claimName` throws
   `RegistrationPendingError`, durably save `error.pending` and pass that same
   record to `client.retryRegistration(...)`; this retries registration only.
   If it throws `IndeterminateSubmissionError`, retain its recovery data and
   reconcile the transaction before taking any further paid action. Its
   `recoveryEnvelope` is an in-memory structured clone, **not** a JSON-safe
   persistence format. See the [agent guide](https://id.fast.xyz/AGENTS.md)
   for the remaining recovery and evidence limits.

## Development and web parity

```sh
corepack pnpm --filter @fastxyz/fastid-sdk typecheck
corepack pnpm --filter @fastxyz/fastid-sdk test
```

The tests consume committed fixtures in `test/fixtures/parity`. Their generator
imports private website modules and stays in Fast ID. Fast ID's parity gate
compares fresh web output with these files at a pinned full fast-sdk commit SHA.
For a protocol change, generate into this directory from an authorized Fast ID
checkout, commit the SDK/fixture change, then update that private gate's SHA.
No private repository access is required by this package's build or tests.
