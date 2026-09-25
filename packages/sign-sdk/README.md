# @fastxyz/sign-sdk

Public Node SDK for agents that create canonical Fast Sign artifact attestations.

The caller supplies an explicitly authorized signer, Fast provider, destinations,
fee policy, and durable journal. Importing this package does not authorize a
signature or fee. Indeterminate submissions must be recovered by exact read-only
evidence and are never retried blindly.

This package supports the Fast Sign artifact-attestation workflow only. It does
not expose a generic `ExternalClaim` builder, browser outbox, CLI, keystore,
custody, backend, indexer, database, or deployment implementation.

## Install

Requires Node.js 20.19 or later:

```sh
npm install @fastxyz/sign-sdk@0.1.0
```

The package installs its `@fastxyz/sdk` dependency. If your application imports
`FastProvider` or another API from `@fastxyz/sdk` directly, declare that package
as a direct dependency too. The SDK source and its Fast network dependency live
in [fastxyz/fast-sdk](https://github.com/fastxyz/fast-sdk).

## Settle a file fingerprint

`hashFile(path)` computes the SHA-256 of a local regular file without uploading
its bytes. Alternatively, supply a digest computed elsewhere as **exactly 64
lowercase hexadecimal characters, without `0x`**. The same procedure applies to
documents, creative works, PDFs and other files: Fast Sign settles the digest
of the exact bytes supplied, not a judgment about their contents.

```ts
import {
  createSignClient,
  hashFile,
  type SignClientOptions,
  type Relationship,
} from "@fastxyz/sign-sdk";

async function settleFile(
  filePath: string,
  operationId: string,
  relationship: Relationship,
  authorized: SignClientOptions,
) {
  const sha256 = await hashFile(filePath);
  const client = createSignClient(authorized);
  return client.signDigest({ operationId, sha256, relationship });
}
```

The caller must provide `network`, `proxyUrl`, `indexOrigin`, an explicitly
authorized `signer`, a Fast settlement `provider`, a **durable** `journal`, and
`feePolicy`. Use `createFastSdkProviderAdapter` if adapting a compatible
`@fastxyz/sdk` provider. Obtain the index origin from trusted deployment
configuration; `sign.fast.xyz` has no write API and this package does not
discover an index origin or authorize use of a key. Keep the same safe,
operation-specific `operationId` and journal when recovering; do not create a
new operation to retry an uncertain submission.

`signDigest` returns either `settlement: "settled"` (with a receipt and a
separate registration state) or `settlement: "unknown"`. An unknown result
may already have settled: use `recoverSettlement` with the journal and a
reader bound to the configured Fast proxy, **never blindly submit again**.
If a settled result says `recoveryPersisted: false`, preserve its receipt and
repair durable recovery before depending on journal-based operations.

## Check the result

For a settled receipt, `verifyReceipt({ receipt, network, reader })` reads back
the exact transaction through a caller-supplied reader bound to the configured
proxy. It reports `verified` or `not_observed`; its trust model is the configured
proxy, **not validator-quorum verification**. With a durably persisted receipt,
`createRecordClient({ network, indexOrigin, journal }).checkRegistration(receipt)`
checks the exact reverse-index record independently of settlement. A pending
registration is not proof that settlement failed; registration recovery uses
the same receipt, not a second signing transaction.

```ts
import {
  createRecordClient,
  verifyReceipt,
  type PendingRegistration,
  type RecoveryJournal,
  type SettlementReader,
  type SignNetwork,
} from "@fastxyz/sign-sdk";

async function readBack(
  receipt: PendingRegistration,
  network: SignNetwork,
  reader: SettlementReader,
  indexOrigin: string,
  journal: RecoveryJournal,
) {
  const settlement = await verifyReceipt({ receipt, network, reader });
  const registration = await createRecordClient({ network, indexOrigin, journal })
    .checkRegistration(receipt);
  return { settlement, registration };
}
```

The reader and index origin must be independently configured for the same
network, and `checkRegistration` requires the durably saved receipt. Keep
`not_observed` and `pending` distinct from a verified, registered result.

For public **mainnet** file/hash lookup, use
[Fast Sign Verify](https://sign.fast.xyz/verify).
That page serves `fast:mainnet`; absence of a testnet receipt there is not a
testnet failure. For testnet, use the testnet-bound receipt reader and index
origin with `verifyReceipt` and `checkRegistration` as shown above. There is no
JSON verification API on the Fast Sign website; its reverse index is a separate
service. On that mainnet page, verify a stamped PDF's signed-original prefix by
dropping the stamped file there. Hashing the entire stamped container
usually produces a *different* digest because the stamp is an unsigned append.
See [Fast Sign's semantics guide](https://sign.fast.xyz/llms.txt) for what a
verified signature does—and does not—prove.

## Query the current settlement fee

The SDK reads the Fast proxy's current default fee schedule at the same network
as the settlement:

| Network | `GET /v1/network-info` |
|---|---|
| Testnet | https://testnet.api.fast.xyz/proxy-rest/v1/network-info |
| Mainnet | https://api.fast.xyz/proxy-rest/v1/network-info |

Check `data.network_id`, then find the entry in `data.fees.entries` whose
`token_id` equals `data.fees.default`. Its `fixed_amount` is an **atomic-unit
decimal string**, not a display amount. For a nonzero amount, fetch token name
and decimals from `GET /v1/tokens?token_ids=<default>` on the *same* proxy-rest
origin. Do not freeze today's quote into an agent instruction.

`feePolicy` must explicitly authorize the token and maximum atomic amount;
for an authoritative zero-fee schedule it must use `tokenId: null` and
`maxAtomicAmount: "0"`. The SDK fetches the schedule again before submission
and refuses a changed schedule. Leave the optional `feeFreeNetwork` fallback
disabled unless the operator separately authorized its narrow transport-failure
behavior; an unavailable or malformed response is **not**, by itself,
permission to assume zero. Importing the package is not authorization to spend.
