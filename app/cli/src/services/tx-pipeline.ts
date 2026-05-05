import {
  bcsSchema,
  type NetworkId,
  type OperationInputParams,
  type TransactionEnvelope,
  VersionedTransactionFromBcs,
} from "@fastxyz/schema";
import { hashHex, TransactionBuilder } from "@fastxyz/sdk";
import { Effect, Schema } from "effect";
import { TransactionFailedError } from "../errors/index.js";
import { FastRpc } from "./api/fast.js";
import type { ResolvedSigner } from "./signer-resolver.js";

export interface TxPipelineSuccess {
  readonly status: "success";
  readonly envelope: TransactionEnvelope;
  readonly txHash: string;
  readonly nonce: bigint;
}

export interface TxPipelineIncomplete {
  readonly status: "incomplete-multisig";
  readonly envelope: TransactionEnvelope;
  readonly txHash: null;
  readonly nonce: bigint;
}

export type TxPipelineResult = TxPipelineSuccess | TxPipelineIncomplete;

export interface SubmitOperationParams {
  readonly resolved: ResolvedSigner;
  readonly networkId: NetworkId;
  readonly operation: OperationInputParams;
}

const opAsBuilderCall = (
  builder: TransactionBuilder,
  op: OperationInputParams,
): TransactionBuilder => {
  switch (op.type) {
    case "TokenTransfer":
      return builder.addTokenTransfer(op.value);
    case "TokenCreation":
      return builder.addTokenCreation(op.value);
    case "TokenManagement":
      return builder.addTokenManagement(op.value);
    case "Mint":
      return builder.addMint(op.value);
    case "Burn":
      return builder.addBurn(op.value);
    case "StateInitialization":
      return builder.addStateInitialization(op.value);
    case "StateUpdate":
      return builder.addStateUpdate(op.value);
    case "StateReset":
      return builder.addStateReset(op.value);
    case "ExternalClaim":
      return builder.addExternalClaim(op.value);
    case "LeaveCommittee":
      return builder.addLeaveCommittee();
    case "Escrow":
      return builder.addEscrow(op.value);
    default:
      throw new Error(
        `unsupported operation type: ${(op as { type: string }).type}`,
      );
  }
};

export const submitOperation = (
  params: SubmitOperationParams,
): Effect.Effect<TxPipelineResult, TransactionFailedError, FastRpc> =>
  Effect.gen(function* () {
    const rpc = yield* FastRpc;

    // 1. Resolve sender bytes
    const senderBytes = yield* Effect.tryPromise({
      try: () =>
        params.resolved.kind === "single"
          ? params.resolved.signer.getPublicKey()
          : params.resolved.signer.getDerivedAddressBytes(),
      catch: (cause) =>
        new TransactionFailedError({
          message: "Failed to resolve sender bytes",
          cause,
        }),
    });

    // 2. Fetch nonce
    const accountInfoRpc = yield* rpc
      .getAccountInfo({
        address: senderBytes,
        tokenBalancesFilter: null,
        stateKeyFilter: null,
        certificateByNonce: null,
      } as never)
      .pipe(
        Effect.mapError(
          (cause) =>
            new TransactionFailedError({
              message: "Failed to fetch account info",
              cause,
            }),
        ),
      );
    const nonce =
      (accountInfoRpc as { nextNonce?: bigint } | null)?.nextNonce ?? 0n;

    // 3. Build + sign envelope
    let envelope: TransactionEnvelope;
    if (params.resolved.kind === "single") {
      const singleSigner = params.resolved.signer;
      const builder = new TransactionBuilder({
        networkId: params.networkId,
        signer: singleSigner,
        nonce,
      });
      envelope = yield* Effect.tryPromise({
        try: () => opAsBuilderCall(builder, params.operation).sign(),
        catch: (cause) =>
          new TransactionFailedError({
            message: "Failed to sign transaction",
            cause,
          }),
      });
    } else {
      const multisigSigner = params.resolved.signer;
      envelope = yield* Effect.tryPromise({
        try: () =>
          multisigSigner.signTransaction({
            networkId: params.networkId,
            nonce,
            operations: [params.operation],
          }),
        catch: (cause) =>
          new TransactionFailedError({
            message: "Failed to sign multisig transaction",
            cause,
          }),
      });
    }

    // 4. Submit
    const submitResult = yield* rpc.submitTransaction(envelope).pipe(
      Effect.mapError(
        (cause) =>
          new TransactionFailedError({
            message: "Failed to submit transaction",
            cause,
          }),
      ),
    );

    // 5. Branch on result type
    const submitObj = (submitResult as { type?: string } | null) ?? null;
    if (submitObj?.type === "IncompleteMultiSig") {
      return {
        status: "incomplete-multisig",
        envelope,
        txHash: null,
        nonce,
      } satisfies TxPipelineIncomplete;
    }

    // 6. Success: compute hash
    const bcsInput = yield* Schema.encode(VersionedTransactionFromBcs)(
      envelope.transaction,
    ).pipe(
      Effect.mapError(
        (cause) =>
          new TransactionFailedError({
            message: "Failed to encode transaction for hashing",
            cause,
          }),
      ),
    );
    const txHash = yield* Effect.tryPromise({
      try: () => hashHex(bcsSchema.VersionedTransaction, bcsInput),
      catch: (cause) =>
        new TransactionFailedError({
          message: "Failed to compute transaction hash",
          cause,
        }),
    });

    return {
      status: "success",
      envelope,
      txHash,
      nonce,
    } satisfies TxPipelineSuccess;
  });
