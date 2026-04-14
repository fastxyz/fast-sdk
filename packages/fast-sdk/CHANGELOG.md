# @fastxyz/sdk

## 1.1.0

### Minor Changes

- Migrate from JSON-RPC to REST API. ProviderOptions.rpcUrl renamed to url. Proxy URLs changed from /proxy to /proxy-rest. Remove faucet API (faucetDrip method and faucet error classes). Add escrow query methods (getEscrowJob, getEscrowJobs). TransactionBuilder defaults to Release20260407.

### Patch Changes

- Updated dependencies
  - @fastxyz/schema@1.1.0
