import type {
  BurnInputParams,
  EscrowInputParams,
  ExternalClaimInputParams,
  LatestTransaction,
  MintInputParams,
  NetworkId,
  NonceInput,
  OperationFor,
  OperationInputParams,
  StateInitializationInputParams,
  StateResetInputParams,
  StateUpdateInputParams,
  TokenCreationInputParams,
  TokenIdInput,
  TokenManagementInputParams,
  TokenTransferInputParams,
  TransactionEnvelope,
  TransactionVersion,
} from "@fastxyz/schema";
import {
  encodeAsVersion,
  LatestTransactionVersion,
  TransactionRelease20260407Input,
  VersionBridges,
  VersionedTransactionFromBcs,
} from "@fastxyz/schema";
import { Schema } from "effect";
import { buildSignedEnvelope } from "../core/crypto/envelope";
import { run } from "../core/run";
import type { Signer } from "./signer";

/** Options for constructing a {@link TransactionBuilder}. */
export interface TransactionBuilderOptions<
  V extends TransactionVersion = typeof LatestTransactionVersion,
> {
  /** Target network (e.g. `"fast:testnet"`, `"fast:mainnet"`). */
  networkId: NetworkId;
  /** Signer whose private key will sign the transaction. */
  signer: Signer;
  /** Sender's next nonce, typically from {@link FastProvider.getAccountInfo}. */
  nonce: NonceInput;
  /** BCS transaction version tag. Defaults to `"Release20260407"`. */
  version?: V;
  /** Whether the transaction should be stored in archival nodes. Defaults to `false`. */
  archival?: boolean;
  /** Token used to pay fees, or `null` for the native token. */
  feeToken?: TokenIdInput | null;
}

/**
 * Fluent builder for constructing and signing Fast transactions.
 *
 * Generic on `V extends TransactionVersion` (defaults to the latest version).
 * Version-restricted operations (e.g. `addEscrow`) narrow to `never` when `V`
 * does not include that operation — providing compile-time exclusion.
 *
 * Add one or more operations, then call {@link sign} to produce a
 * signed {@link TransactionEnvelope}. A single operation becomes a
 * direct claim; multiple operations are automatically batched.
 *
 * The builder is reusable — call {@link reset} between transactions
 * and update the nonce with {@link setNonce}.
 *
 * @example
 * ```ts
 * const builder = new TransactionBuilder({
 *   networkId: "fast:testnet",
 *   signer,
 *   nonce: account.nextNonce,
 * });
 *
 * const envelope = await builder
 *   .addTokenTransfer({ tokenId, recipient, amount: 1000n, userData: null })
 *   .sign();
 *
 * await provider.submitTransaction(envelope);
 * ```
 */
export class TransactionBuilder<
  V extends TransactionVersion = typeof LatestTransactionVersion,
> {
  private options: TransactionBuilderOptions<V>;
  /**
   * Internal operation store uses `OperationInputParams` (the raw input form)
   * so that existing `add*` convenience methods continue to work without
   * requiring callers to pre-brand their values. The typed `add(op)` entry
   * accepts `OperationFor<V>` (branded) and stores it via a runtime cast.
   */
  private operations: OperationInputParams[] = [];

  constructor(options: TransactionBuilderOptions<V>) {
    this.options = options;
  }

  /**
   * Type-safe primary entry: add an operation that is valid for version `V`.
   *
   * Also performs a runtime defence-in-depth check against
   * `VersionBridges[V].supportedOperations` before storing.
   *
   * @param op - A branded {@link OperationFor}<V> value.
   */
  add(op: OperationFor<V>): this {
    // Runtime defence: validate op type is in the version's supported set.
    const version = (this.options.version ?? LatestTransactionVersion) as TransactionVersion;
    const supported = VersionBridges[version].supportedOperations;
    if (!supported.includes((op as { type: string }).type)) {
      throw new Error(
        `Operation '${(op as { type: string }).type}' is not supported by ${version}`,
      );
    }
    // Cast: OperationFor<V> (branded) is structurally compatible with OperationInputParams.
    this.operations.push(op as unknown as OperationInputParams);
    return this;
  }

  /** Add a token transfer operation. */
  addTokenTransfer(params: TokenTransferInputParams): this {
    this.operations.push({ type: "TokenTransfer", value: params });
    return this;
  }

  /** Add a token creation operation (deploys a new token). */
  addTokenCreation(params: TokenCreationInputParams): this {
    this.operations.push({ type: "TokenCreation", value: params });
    return this;
  }

  /** Add a token management operation (update admin, minters). */
  addTokenManagement(params: TokenManagementInputParams): this {
    this.operations.push({ type: "TokenManagement", value: params });
    return this;
  }

  /** Add a mint operation (requires minter authority). */
  addMint(params: MintInputParams): this {
    this.operations.push({ type: "Mint", value: params });
    return this;
  }

  /** Add a burn operation. */
  addBurn(params: BurnInputParams): this {
    this.operations.push({ type: "Burn", value: params });
    return this;
  }

  /** Add a state initialization operation (create a new state key). */
  addStateInitialization(params: StateInitializationInputParams): this {
    this.operations.push({ type: "StateInitialization", value: params });
    return this;
  }

  /** Add a state update operation (transition state with a compute claim reference). */
  addStateUpdate(params: StateUpdateInputParams): this {
    this.operations.push({ type: "StateUpdate", value: params });
    return this;
  }

  /** Add a state reset operation (reset state to a new value). */
  addStateReset(params: StateResetInputParams): this {
    this.operations.push({ type: "StateReset", value: params });
    return this;
  }

  /** Add an external claim with verifier signatures. */
  addExternalClaim(params: ExternalClaimInputParams): this {
    this.operations.push({ type: "ExternalClaim", value: params });
    return this;
  }

  /** Add a leave-committee operation (no parameters). */
  addLeaveCommittee(): this {
    this.operations.push({ type: "LeaveCommittee" });
    return this;
  }

  /**
   * Add an escrow operation (CreateConfig, CreateJob, Submit, Reject, Complete).
   *
   * Narrowed to `never` when `V` is `'Release20260319'` (which does not support
   * Escrow). Only callable when `V` includes `'Escrow'` in its supported operations.
   */
  addEscrow(
    params: EscrowInputParams,
  ): OperationFor<V> extends { type: "Escrow" } ? this : never {
    this.operations.push({ type: "Escrow", value: params });
    // Conditional return type defeats TS's ability to track the type through
    // the body, so we cast. The compile-time contract is enforced by callers
    // via the conditional return type; runtime correctness is enforced by
    // the runtime check inside `add()` (or the BCS bridge's capability check
    // in `encodeAsVersion`).
    return this as never;
  }

  /** Update the nonce for the next {@link sign} call. */
  setNonce(nonce: NonceInput): this {
    this.options = { ...this.options, nonce };
    return this;
  }

  /** Replace the signer for the next {@link sign} call. */
  setSigner(signer: Signer): this {
    this.options = { ...this.options, signer };
    return this;
  }

  /** Clear all queued operations so the builder can be reused. */
  reset(): this {
    this.operations = [];
    return this;
  }

  /**
   * Build and sign the transaction.
   *
   * Constructs a canonical {@link LatestTransaction}, encodes it as the
   * target version via {@link encodeAsVersion}, BCS-encodes it, domain-prefixes
   * it, and signs it with the configured signer's Ed25519 key.
   *
   * @returns A signed {@link TransactionEnvelope} ready for submission.
   */
  async sign(): Promise<TransactionEnvelope> {
    if (this.operations.length === 0) {
      throw new Error("TransactionBuilder.sign() requires at least one operation");
    }
    const { signer, networkId, nonce, version, archival, feeToken } =
      this.options;
    const sender = await signer.getPublicKey();
    const privateKey = await signer.getPrivateKey();
    const targetVersion: TransactionVersion =
      version ?? LatestTransactionVersion;

    // Step 1: Build a canonical LatestTransaction by decoding through the
    // Release20260407 input schema (handles nonce coercion, address parsing, etc.).
    // The resulting type is structurally identical to LatestTransaction.Type
    // (same brands: Address, Uint8Array32, Nonce, Uint64…). We cast to satisfy
    // encodeAsVersion's parameter type.
    const latestInputDecoded = Schema.decodeUnknownSync(
      TransactionRelease20260407Input,
    )({
      networkId,
      sender,
      nonce,
      timestampNanos: BigInt(Date.now()) * 1_000_000n,
      claims: this.operations,
      archival: archival ?? false,
      feeToken: feeToken ?? null,
    });

    // Step 2: Use encodeAsVersion to produce the version-specific wire form,
    // applying the capability check (e.g. Escrow is rejected for Release20260319).
    const versionedEncoded = encodeAsVersion(
      latestInputDecoded as unknown as LatestTransaction,
      targetVersion,
    );

    // Step 3: Decode the wire form back to the VersionedTransactionFromBcs.Type
    // domain representation, which buildSignedEnvelope expects.
    const versioned = Schema.decodeUnknownSync(VersionedTransactionFromBcs)(
      versionedEncoded,
    );

    // Step 4: BCS-encode, domain-prefix, and sign.
    return run(
      buildSignedEnvelope(
        privateKey,
        versioned as Parameters<typeof buildSignedEnvelope>[1],
      ),
    );
  }
}
