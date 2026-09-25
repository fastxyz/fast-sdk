# @fastxyz/sign-sdk

Public Node SDK for agents that create canonical Fast Sign artifact attestations.

The caller supplies an explicitly authorized signer, Fast provider, destinations,
fee policy, and durable journal. Importing this package does not authorize a
signature or fee. Indeterminate submissions must be recovered by exact read-only
evidence and are never retried blindly.

This package supports the Fast Sign artifact-attestation workflow only. It does
not expose a generic `ExternalClaim` builder, browser outbox, CLI, keystore,
custody, backend, indexer, database, or deployment implementation.
