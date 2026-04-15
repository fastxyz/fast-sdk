import { fromFastAddress, Signer, toHex } from "@fastxyz/sdk";
import { Effect } from "effect";
import type { AccessKeyCreateArgs } from "../../cli.js";
import { TransactionFailedError } from "../../errors/index.js";
import {
  buildAuthorizeAccessKeyEnvelope,
  type AccessKeyPermissionName,
} from "../../services/access-key-protocol.js";
import {
  decimalToBaseUnits,
  DEFAULT_ACCESS_KEY_CLIENT_ID,
  DEFAULT_ACCESS_KEY_LABEL,
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
import { resolveToken } from "../../services/token-resolver.js";
import type { Command } from "../index.js";

const ALLOWED_OPERATIONS: AccessKeyPermissionName[] = ["TokenTransfer"];

export const accessKeyCreate: Command<AccessKeyCreateArgs> = {
  cmd: "access-key-create",
  handler: (args: AccessKeyCreateArgs) =>
    Effect.gen(function* () {
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
      const tokenName = args.token ?? "USDC";
      const token = resolveToken(tokenName, network);
      const clientId = args.clientId?.trim() || DEFAULT_ACCESS_KEY_CLIENT_ID;
      const label = args.label?.trim() || DEFAULT_ACCESS_KEY_LABEL;
      const maxTotalSpend = decimalToBaseUnits(args.maxTotalSpendUsdc, token.decimals);
      const expiresAt = new Date(
        Date.now() + Math.max(1, args.expiresInHours) * 60 * 60 * 1000,
      ).toISOString();
      const expiresAtNanos = BigInt(Date.parse(expiresAt)) * 1_000_000n;
      const allowedTokens = [toHex(token.fastTokenId)];

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

      const delegatedSeed = crypto.getRandomValues(new Uint8Array(32));
      const delegatedSigner = new Signer(delegatedSeed);
      const delegatePublicKey = toHex(
        yield* Effect.tryPromise({
          try: () => delegatedSigner.getPublicKey(),
          catch: (cause) =>
            new TransactionFailedError({
              message: "Failed to derive delegated public key",
              cause,
            }),
        }),
      );

      if (!config.nonInteractive && !config.json) {
        yield* output.humanLine(`Create access key for ${ownerAccount.name}`);
        yield* output.humanLine(`  Owner:       ${ownerAccount.fastAddress}`);
        yield* output.humanLine(`  Label:       ${label}`);
        yield* output.humanLine(`  Client ID:   ${clientId}`);
        yield* output.humanLine(`  Token:       ${tokenName}`);
        yield* output.humanLine(`  Spend cap:   ${args.maxTotalSpendUsdc} ${tokenName}`);
        yield* output.humanLine(`  Expires at:  ${expiresAt}`);
        yield* output.humanLine(`  Key manager: ${keyManager.baseUrl}`);
        yield* output.humanLine("");
        const confirmed = yield* prompt.confirm("Create access key?");
        if (!confirmed) {
          return;
        }
      }

      const prepared = yield* Effect.tryPromise({
        try: () =>
          buildAuthorizeAccessKeyEnvelope({
            signer,
            ownerFastAddress: ownerAccount.fastAddress,
            networkId: network.networkId,
            nonce,
            timestampNanos: nowNanos(),
            delegatePublicKeyHex: delegatePublicKey,
            clientId,
            expiresAtNanos,
            allowedOperations: ALLOWED_OPERATIONS,
            allowedTokenIds: allowedTokens,
            maxTotalSpend,
          }),
        catch: (cause) =>
          new TransactionFailedError({
            message: "Failed to build access-key authorization transaction",
            cause,
          }),
      });

      const submission = yield* Effect.tryPromise({
        try: () => submitRawTransaction(network.rpcUrl, prepared.envelope),
        catch: (cause) =>
          cause instanceof TransactionFailedError
            ? cause
            : new TransactionFailedError({
                message: "Failed to submit access-key authorization transaction",
                cause,
              }),
      });

      const certificate = extractSuccessCertificate(submission);
      const storageResult = yield* Effect.either(
        accessKeyStore.put({
          accessKeyId: prepared.accessKeyId,
          ownerAccountName: ownerAccount.name,
          ownerFastAddress: ownerAccount.fastAddress,
          network: config.network,
          delegatePublicKey,
          privateKey: delegatedSeed,
          password,
          label,
          clientId,
          createdAt: new Date().toISOString(),
        }),
      );
      const registrationResult = yield* Effect.either(
        keyManager.registerAccessKey({
          ownerAccountAddress: ownerAccount.fastAddress,
          accessKeyId: prepared.accessKeyId,
          delegatePublicKey,
          label,
          source: "cli",
          txHash: prepared.txHash,
          certificate,
          policy: {
            clientId,
            expiresAt,
            allowedOperations: [...ALLOWED_OPERATIONS],
            allowedTokens,
            maxTotalSpend,
          },
        }),
      );
      const storedLocally = storageResult._tag === "Right";
      const registeredToKeyManager = registrationResult._tag === "Right";
      const registrationPolicy =
        registrationResult._tag === "Right"
          ? registrationResult.right.policy
          : {
              clientId,
              expiresAt,
              allowedOperations: [...ALLOWED_OPERATIONS],
              allowedTokens,
              maxTotalSpend,
            };

      const explorerUrl = `${network.explorerUrl}/txs/${prepared.txHash}`;
      yield* output.humanLine(`Created access key "${label}"`);
      yield* output.humanLine(`  Access key:  ${prepared.accessKeyId}`);
      yield* output.humanLine(`  Transaction: ${prepared.txHash}`);
      yield* output.humanLine(`  Explorer:    ${explorerUrl}`);
      yield* output.humanLine(`  Client ID:   ${registrationPolicy.clientId}`);
      if (!storedLocally) {
        yield* output.humanLine(
          `  Warning: local signer storage failed: ${storageResult.left.message}`,
        );
      }
      if (!registeredToKeyManager) {
        yield* output.humanLine(
          `  Warning: key-manager registration failed: ${registrationResult.left.message}`,
        );
      }
      yield* output.ok({
        accessKeyId: prepared.accessKeyId,
        txHash: prepared.txHash,
        explorerUrl,
        ownerAccount: ownerAccount.fastAddress,
        delegatePublicKey,
        label,
        clientId,
        expiresAt,
        allowedOperations: ALLOWED_OPERATIONS,
        allowedTokens,
        maxTotalSpend,
        source: "cli",
        storedLocally,
        registeredToKeyManager,
        storageError: storedLocally ? null : storageResult.left.message,
        keyManagerError: registeredToKeyManager ? null : registrationResult.left.message,
      });
    }),
};
