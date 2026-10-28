---
"@fastxyz/sdk": patch
---

Parse valid `VALIDATOR_REJECTED` / `InsufficientFundingForFee` responses as
`InsufficientFundingError`, preserving exact balances and exposing the required
fee and token bytes. Keep malformed and unknown validator responses as `RestError`
and preserve compatibility with existing `InsufficientFundingError` constructors.
