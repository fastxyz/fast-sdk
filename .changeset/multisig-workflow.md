---
'@fastxyz/sdk': minor
---

Add a browser/Node-neutral `MultiSigWorkflow` that prepares an inspectable
unsigned transaction, validates current nonce/sender/network/config, prevents
implicit proposal replacement, submits the exact prepared bytes, and supports
current-nonce voting and deliberate signature retry. Export the workflow from
the package root and `@fastxyz/sdk/multisig`. Limit the published package to
compiled `dist` artifacts plus npm's standard README/LICENSE metadata.
