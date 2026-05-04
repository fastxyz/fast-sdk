import { bcsSchema } from "@fastxyz/schema";
import { getPublicKeyAsync } from "@noble/ed25519";
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

export class MultiSigConfigInvalidError extends Error {
  readonly _tag = "MultiSigConfigInvalidError" as const;
  constructor(message: string) {
    super(message);
    this.name = "MultiSigConfigInvalidError";
  }
}

export class NotAuthorizedSignerError extends Error {
  readonly _tag = "NotAuthorizedSignerError" as const;
  constructor(message = "secret key is not in config.authorized_signers") {
    super(message);
    this.name = "NotAuthorizedSignerError";
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function validateConfig(config: MultiSigConfig): void {
  const signers = config.authorized_signers;
  if (signers.length < 2) {
    throw new MultiSigConfigInvalidError(
      `authorized_signers must have at least 2 entries (got ${signers.length})`,
    );
  }
  if (config.quorum < 1n) {
    throw new MultiSigConfigInvalidError(
      `quorum must be >= 1 (got ${config.quorum})`,
    );
  }
  if (config.quorum > BigInt(signers.length)) {
    throw new MultiSigConfigInvalidError(
      `quorum (${config.quorum}) exceeds signer count (${signers.length})`,
    );
  }
  for (let i = 0; i < signers.length; i++) {
    for (let j = i + 1; j < signers.length; j++) {
      if (bytesEqual(signers[i]!, signers[j]!)) {
        throw new MultiSigConfigInvalidError(
          `duplicate signer at indices ${i} and ${j}`,
        );
      }
    }
  }
}

export async function assertAuthorizedSigner(
  config: MultiSigConfig,
  secretKey: Uint8Array,
): Promise<void> {
  validateConfig(config);
  const pk = await getPublicKeyAsync(secretKey);
  const matched = config.authorized_signers.some((s) => bytesEqual(s, pk));
  if (!matched) throw new NotAuthorizedSignerError();
}
