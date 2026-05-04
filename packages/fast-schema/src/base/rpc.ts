/**
 * Legacy JSON-RPC wire-form primitives.
 *
 * This palette describes the wire format the Fast network used before the
 * REST migration (PR #76, Apr 2026). It survives the migration solely
 * because `allset-sdk/src/bridge.ts` still encodes `TransactionCertificate`
 * to it for the AllSet cross-sign service — a JSON-RPC service that has
 * not migrated.
 *
 * **Direction in production:** encode-only. The cross-sign request handler
 * calls `Schema.encodeSync(TransactionCertificateFromRpc)(...)` to produce
 * the wire payload. Decode is exercised only by hand-authored test fixtures
 * (see `packages/allset-sdk/tests/sdk.test.ts`).
 *
 * **Wire shape:**
 *   - Addresses, byte arrays: hex strings (no 0x prefix), numeric arrays in some places
 *   - Amount / Balance: lowercase hex via Rust's `to_str_radix(16)` (no 0x, sign only on signed types)
 *   - Nonce / Quorum: JSON numbers (u64)
 *
 * Do not extend this palette without coordinating with the cross-sign
 * service owners. Once cross-sign migrates to REST, this entire palette
 * (and `TransactionCertificateFromRpc` etc.) can be deleted.
 */

import { Schema } from 'effect';
import {
  HexLowerInt320,
  HexLowerUint256,
  Uint8Array32FromNumberArray,
  Uint8Array64FromNumberArray,
  Uint8ArrayFromNumberArray,
  Uint64FromNumberOrStringOrSelf,
} from '../util/index.ts';
import { NetworkId } from './internal.ts';

export const AmountFromRpc = HexLowerUint256.pipe(Schema.brand('Amount'));
export const BalanceFromRpc = HexLowerInt320.pipe(Schema.brand('Balance'));
export const NonceFromRpc = Uint64FromNumberOrStringOrSelf.pipe(Schema.brand('Nonce'));
export const QuorumFromRpc = Uint64FromNumberOrStringOrSelf.pipe(Schema.brand('Quorum'));

export const NetworkIdFromRpc = NetworkId;

export const AddressFromRpc = Uint8Array32FromNumberArray.pipe(Schema.brand('Address'));
export const SignatureFromRpc = Uint8Array64FromNumberArray.pipe(Schema.brand('Signature'));
export const TokenIdFromRpc = Uint8Array32FromNumberArray.pipe(Schema.brand('TokenId'));
export const StateKeyFromRpc = Uint8Array32FromNumberArray.pipe(Schema.brand('StateKey'));
export const StateFromRpc = Uint8Array32FromNumberArray.pipe(Schema.brand('State'));
export const ClaimDataFromRpc = Uint8ArrayFromNumberArray.pipe(Schema.brand('ClaimData'));
export const UserDataFromRpc = Schema.NullOr(Uint8Array32FromNumberArray.pipe(Schema.brand('UserData')));
