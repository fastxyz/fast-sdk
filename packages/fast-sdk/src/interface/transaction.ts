import type {
  BurnInputParams,
  ExternalClaimInputParams,
  MintInputParams,
  NetworkId,
  NonceInput,
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
import { TransactionInput } from "@fastxyz/schema";
import { Schema } from "effect";
import { SignatureFromInput } from "@fastxyz/schema";
import { verifyVersionedTransactionSignature } from "../core/crypto/envelope";
import { run } from "../core/run";
import type { FastSigner } from "./signer";
import { SigningError } from "../core/error/crypto";

/** Options for constructing a {@link TransactionBuilder}. */
export interface TransactionBuilderOptions {
  /** Target network (e.g. `"fast:testnet"`, `"fast:mainnet"`). */
  networkId: NetworkId;
  /** Signer that provides the sender public key and transaction signature. */
  signer: FastSigner;
  /** Sender's next nonce, typically from {@link FastProvider.getAccountInfo}. */
  nonce: NonceInput;
  /** BCS transaction version tag. Defaults to `"Release20260319"`. */
  version?: TransactionVersion;
  /** Whether the transaction should be stored in archival nodes. Defaults to `false`. */
  archival?: boolean;
  /** Token used to pay fees, or `null` for the native token. */
  feeToken?: TokenIdInput | null;
}

/**
 * Fluent builder for constructing and signing Fast transactions.
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
export class TransactionBuilder {
  private options: TransactionBuilderOptions;
  private operations: OperationInputParams[] = [];

  constructor(options: TransactionBuilderOptions) {
    this.options = options;
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

  /** Update the nonce for the next {@link sign} call. */
  setNonce(nonce: NonceInput): this {
    this.options = { ...this.options, nonce };
    return this;
  }

  /** Replace the signer for the next {@link sign} call. */
  setSigner(signer: FastSigner): this {
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
   * A single operation produces a direct claim type; two or more
   * operations are wrapped in a `Batch`. The transaction is BCS-encoded,
   * domain-prefixed, and signed with the configured signer's Ed25519 key.
   *
   * @returns A signed {@link TransactionEnvelope} ready for submission.
   */
  async sign(): Promise<TransactionEnvelope> {
    const { signer, networkId, nonce, version, archival, feeToken } =
      this.options;
    const sender = await signer.getPublicKey();
    const ops = this.operations;
    const claim =
      ops.length === 1 ? ops[0]! : { type: "Batch" as const, value: ops };

    const txInput = {
      networkId,
      sender,
      nonce,
      timestampNanos: BigInt(Date.now()) * 1_000_000n,
      claim,
      archival: archival ?? false,
      feeToken: feeToken ?? null,
    };

    const internal = Schema.decodeUnknownSync(TransactionInput)(txInput);
    const type: TransactionVersion = version ?? "Release20260319";
    const versioned = { type, value: internal };
    const rawSignature = await signer.signTransaction(versioned);
    const matchesSigner = await run(
      verifyVersionedTransactionSignature(rawSignature, versioned, sender),
    );
    if (!matchesSigner) {
      throw new SigningError({
        cause: new Error(
          "Signer returned a transaction signature that does not match its public key.",
        ),
      });
    }
    const signature = Schema.decodeUnknownSync(SignatureFromInput)(rawSignature);

    return {
      transaction: versioned,
      signature: { type: "Signature" as const, value: signature },
    };
  }
}
