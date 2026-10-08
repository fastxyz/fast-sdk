# @fastxyz/x402-fast

Server-side `exact` mechanism for `@x402/core` 2.28.0. Register an
`ExactFastScheme` with core for `fast:mainnet` or `fast:testnet`.
Only upfront payment flow is supported. This package currently contains no
client, certificate verification, facilitator, settlement, or replay handling.

Money prices (`"$0.10"`, `"0.10"`, or `0.1`) use the network's default token:
mainnet fastUSD or testnet testUSDC, each with 6 decimals. Conversion uses decimal
strings and integer arithmetic; prices with more than 6 fractional digits,
scientific notation, whitespace, zero, or negatives are rejected rather than
rounded. Large or precision-sensitive prices should be supplied as strings;
numeric values must be finite and within the safe integer range.

Explicit `{ asset, amount, extra? }` prices support arbitrary canonical lowercase
32-byte Fast token identifiers with a positive canonical atomic integer amount
within the u256 range. They do not imply a dollar peg. `getAssetDecimals` returns
6 only for the network's known default token, and undefined for other assets.
Applications remain responsible for validating recipient addresses and timeout
policy. No payment is transferred by this package.
