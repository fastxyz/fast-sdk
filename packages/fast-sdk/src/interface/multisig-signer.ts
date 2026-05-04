import { bcsSchema } from "@fastxyz/schema";
import { hash } from "../core/crypto/bcs";
import { run } from "../core/run";
import { toFastAddress } from "./convert";

/**
 * BCS-input shape for `MultiSigConfig`. Matches the on-chain Rust struct
 * `MultiSigConfig { authorized_signers, quorum, nonce }` and is the exact
 * input that `bcsSchema.MultiSigConfig.serialize()` accepts.
 *
 * Distinct from the REST-decoded `MultiSigConfig` type re-exported from
 * `@fastxyz/schema`, which uses camelCase (`authorizedSigners`).
 */
export type MultiSigConfig = {
  authorized_signers: Uint8Array[];
  quorum: bigint;
  nonce: bigint;
};

/**
 * Derive the 32-byte address of a multisig account from its config.
 * Matches the Rust `MultiSigConfig::address()` algorithm:
 * `keccak256(BCS::serialize(MultiSigConfig{ authorized_signers, quorum, nonce }))`.
 */
export async function deriveMultiSigAddressBytes(
  config: MultiSigConfig,
): Promise<Uint8Array> {
  return run(hash(bcsSchema.MultiSigConfig, config));
}

/**
 * Derive the bech32m `fast1...` address of a multisig account from its config.
 */
export async function deriveMultiSigAddress(
  config: MultiSigConfig,
): Promise<string> {
  return toFastAddress(await deriveMultiSigAddressBytes(config));
}
