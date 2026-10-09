---
'@fastxyz/cli': patch
---

Request the withdrawal token balance explicitly during multisig AllSet preflight, avoiding a false insufficient-balance error when the API omits unrequested token balances. Existing preflight-only journals can be resumed without creating a new payment.
