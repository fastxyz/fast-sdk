---
'@fastxyz/x402-types': minor
'@fastxyz/x402-client': minor
'@fastxyz/x402-server': minor
'@fastxyz/x402-facilitator': minor
'@fastxyz/cli': patch
---

Add x402 v2 wire compatibility while preserving the existing v1-shaped APIs.
Clients answer in the version advertised by the seller; v1-only sellers continue
to receive X-PAYMENT. Dual-version servers and facilitators accept either form.
The CLI inherits v2 dry-run and payment support without command-code changes.

The four x402 packages target 1.1.0. Publishing remains gated on the approved
live testnet version matrix and drop-in consumer checks; this changeset alone
does not establish those gates or authorize publication.
