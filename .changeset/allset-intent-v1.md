---
"@fastxyz/allset-sdk": minor
"@fastxyz/cli": patch
---

Opt-in `allset/intent/v1` claim encoding. With `claimEncoding: 'v1'`, `chainId` and `bridgeContract`, `executeWithdraw` / `executeIntent` sign a self-describing canonical-JSON `claim_data` and tag the transfer's `user_data` with `allset/transfer/v1:<chainId>`, so the Fast App signing pop-up and the explorer can read what is authorized (AllSet#576). All v1 inputs are validated before the Fast transfer is signed. The default stays `'legacy'` until cross-sign and the Fast App decoder ship. New exports: `encodeIntentClaimV1`, `decodeIntentClaimV1`, `intentClaimV1ToAbi`, `intentV1ToLegacy`, `intentsToV1`, `prepareIntentClaimV1`, `finishIntentClaimV1`, `buildClaimBytes`, `transferUserDataTag`, `readTransferUserDataTag`, `bytes32ToFastAddress`, and the JSON Schema at `schemas/allset-intent-v1.json`. The CLI now passes `chainId`, `bridgeContract` and `display` from its network config (no behavior change yet).
