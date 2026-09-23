# @fastxyz/fastid-sdk

Programmatic client for [Fast ID](https://id.fast.xyz), for Node 20.19 or newer.
This package was moved from `fast-id/fastset-id-sdk` and renamed from
`@fastxyz/id-sdk`; update imports to `@fastxyz/fastid-sdk`. The client API is
unchanged. The package is licensed under Apache-2.0, as specified in this
directory's LICENSE, independently of the monorepo's root license.
Copyright (c) Pi Squared, Inc.

## Install before the first npm publication

From the public fast-sdk checkout:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @fastxyz/fastid-sdk... build
corepack pnpm --filter @fastxyz/fastid-sdk pack --pack-destination /tmp/fastid-sdk-pack
# From your consumer project (use the emitted tarball filename):
npm install /tmp/fastid-sdk-pack/fastxyz-fastid-sdk-*.tgz
```

After npm publication, the package name is `@fastxyz/fastid-sdk`. Building and
using it requires no access to the private Fast ID repository.

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
