import { bcsSchema } from "@fastxyz/schema";
import { getPublicKeyAsync } from "@noble/ed25519";
import { Data, Redacted } from "effect";
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

export class MultiSigConfigInvalidError extends Data.TaggedError(
  "MultiSigConfigInvalidError",
)<{ readonly reason: string }> {
  override get message() {
    return `Invalid multisig config: ${this.reason}`;
  }
}

export class NotAuthorizedSignerError extends Data.TaggedError(
  "NotAuthorizedSignerError",
) {
  override get message() {
    return "secret key is not in config.authorized_signers";
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
    throw new MultiSigConfigInvalidError({
      reason: `authorized_signers must have at least 2 entries (got ${signers.length})`,
    });
  }
  if (config.quorum < 1n) {
    throw new MultiSigConfigInvalidError({
      reason: `quorum must be >= 1 (got ${config.quorum})`,
    });
  }
  if (config.quorum > BigInt(signers.length)) {
    throw new MultiSigConfigInvalidError({
      reason: `quorum (${config.quorum}) exceeds signer count (${signers.length})`,
    });
  }
  for (let i = 0; i < signers.length; i++) {
    for (let j = i + 1; j < signers.length; j++) {
      if (bytesEqual(signers[i]!, signers[j]!)) {
        throw new MultiSigConfigInvalidError({
          reason: `duplicate signer at indices ${i} and ${j}`,
        });
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

export interface MultiSigSignerInit {
  config: MultiSigConfig;
  secretKey: Uint8Array;
}

/**
 * A multisig member signer.
 *
 * Wraps a `MultiSigConfig` and a single member's ed25519 secret key.
 * Validation is lazy: the constructor stores the config + secret without
 * checking; the first method call invokes {@link assertAuthorizedSigner}
 * (which validates the config and confirms the secret derives a pubkey
 * present in `config.authorized_signers`). Subsequent calls reuse the
 * cached "validated" flag and cached public key.
 *
 * The secret key is wrapped in `Redacted` so it never appears in logs,
 * stack traces, or `inspect`/`toString` output.
 */
export class MultiSigSigner {
  readonly config: MultiSigConfig;
  private readonly secretKey: Redacted.Redacted<Uint8Array>;
  private validatedOnce = false;
  private cachedPublicKey?: Uint8Array;

  constructor(init: MultiSigSignerInit) {
    this.config = {
      authorized_signers: init.config.authorized_signers.map(
        (s) => new Uint8Array(s),
      ),
      quorum: init.config.quorum,
      nonce: init.config.nonce,
    };
    this.secretKey = Redacted.make(init.secretKey);
  }

  private async ensureValid(): Promise<void> {
    if (this.validatedOnce) return;
    await assertAuthorizedSigner(this.config, Redacted.value(this.secretKey));
    this.validatedOnce = true;
  }

  async getSignerPublicKey(): Promise<Uint8Array> {
    await this.ensureValid();
    this.cachedPublicKey ??= await getPublicKeyAsync(
      Redacted.value(this.secretKey),
    );
    return this.cachedPublicKey;
  }

  async getDerivedAddressBytes(): Promise<Uint8Array> {
    await this.ensureValid();
    return deriveMultiSigAddressBytes(this.config);
  }

  async getFastAddress(): Promise<string> {
    await this.ensureValid();
    return deriveMultiSigAddress(this.config);
  }
}
