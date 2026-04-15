import { fromFastAddress, Signer } from "@fastxyz/sdk";
import { Effect } from "effect";
import type { AccessKeyRevokeArgs } from "../../cli.js";
import { InvalidUsageError, TransactionFailedError } from "../../errors/index.js";
import { buildRevokeAccessKeyEnvelope } from "../../services/access-key-protocol.js";
import {
  submitRawTransaction,
  extractSuccessCertificate,
  nowNanos,
} from "../../services/access-key-runtime.js";
import { KeyManagerApi } from "../../services/api/key-manager.js";
import { Output } from "../../services/output.js";
import { Prompt } from "../../services/prompt.js";
import { AccessKeyStore } from "../../services/storage/access-key.js";
import { AccountStore } from "../../services/storage/account.js";
import { NetworkConfigService } from "../../services/storage/network.js";
import { FastRpc } from "../../services/api/fast.js";
import { ClientConfig } from "../../services/config/client.js";
import type { Command } from "../index.js";

const isHex32 = (value: string) => /^(0x)?[0-9a-fA-F]{64}$/.test(value);

export const accessKeyRevoke: Command<AccessKeyRevokeArgs> = {
  cmd: "access-key-revoke",
  handler: (args: AccessKeyRevokeArgs) =>
    Effect.gen(function* () {
      if (!isHex32(args.accessKeyId)) {
        return yield* Effect.fail(
          new InvalidUsageError({
            message: `Invalid access key ID "${args.accessKeyId}". Expected a 32-byte hex string.`,
          }),
        );
      }

      const accounts = yield* AccountStore;
      const accessKeyStore = yield* AccessKeyStore;
      const config = yield* ClientConfig;
      const keyManager = yield* KeyManagerApi;
      const networkService = yield* NetworkConfigService;
      const output = yield* Output;
      const prompt = yield* Prompt;
      const rpc = yield* FastRpc;

      const ownerAccount = yield* accounts.resolveAccount(config.account);
      const network = yield* networkService.resolve(config.network);

      if (!config.nonInteractive && !config.json) {
        yield* output.humanLine(`Revoke access key ${args.accessKeyId}`);
        yield* output.humanLine(`  Owner: ${ownerAccount.fastAddress}`);
        yield* output.humanLine("");
        const confirmed = yield* prompt.confirm("Revoke access key?");
        if (!confirmed) {
          return;
        }
      }

      const password = ownerAccount.encrypted
        ? yield* prompt.password()
        : null;
      const { seed } = yield* accounts.export(ownerAccount.name, password);
      const signer = new Signer(seed);

      const accountInfo = yield* rpc.getAccountInfo({
        address: fromFastAddress(ownerAccount.fastAddress),
        tokenBalancesFilter: null,
        stateKeyFilter: null,
        certificateByNonce: null,
      } as never);
      const nonce = (accountInfo as { nextNonce?: bigint }).nextNonce ?? 0n;

      const prepared = yield* Effect.tryPromise({
        try: () =>
          buildRevokeAccessKeyEnvelope({
            signer,
            ownerFastAddress: ownerAccount.fastAddress,
            networkId: network.networkId,
            nonce,
            timestampNanos: nowNanos(),
            accessKeyId: args.accessKeyId,
          }),
        catch: (cause) =>
          new TransactionFailedError({
            message: "Failed to build access-key revocation transaction",
            cause,
          }),
      });

      const submission = yield* Effect.tryPromise({
        try: () => submitRawTransaction(network.rpcUrl, prepared.envelope),
        catch: (cause) =>
          cause instanceof TransactionFailedError
            ? cause
            : new TransactionFailedError({
                message: "Failed to submit access-key revocation transaction",
                cause,
              }),
      });

      const certificate = extractSuccessCertificate(submission);
      const registrationResult = yield* Effect.either(
        keyManager.registerAccessKeyRevocation({
          ownerAccountAddress: ownerAccount.fastAddress,
          accessKeyId: args.accessKeyId,
          txHash: prepared.txHash,
          certificate,
        }),
      );
      const removalResult = yield* Effect.either(
        accessKeyStore.remove(args.accessKeyId),
      );
      const registeredToKeyManager = registrationResult._tag === "Right";
      const removedLocally = removalResult._tag === "Right";

      const explorerUrl = `${network.explorerUrl}/txs/${prepared.txHash}`;
      yield* output.humanLine(`Revoked access key ${args.accessKeyId}`);
      yield* output.humanLine(`  Transaction: ${prepared.txHash}`);
      yield* output.humanLine(`  Explorer:    ${explorerUrl}`);
      if (!registeredToKeyManager) {
        yield* output.humanLine(
          `  Warning: key-manager revocation sync failed: ${registrationResult.left.message}`,
        );
      }
      if (!removedLocally) {
        yield* output.humanLine(
          `  Warning: local key cleanup failed: ${removalResult.left.message}`,
        );
      }
      yield* output.ok({
        accessKeyId: args.accessKeyId,
        txHash: prepared.txHash,
        explorerUrl,
        registeredToKeyManager,
        removedLocally,
        keyManagerError: registeredToKeyManager ? null : registrationResult.left.message,
        localRemovalError: removedLocally ? null : removalResult.left.message,
      });
    }),
};
