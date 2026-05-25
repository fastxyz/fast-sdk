import * as fs from "node:fs/promises";
import { Signer, toHex } from "@fastxyz/sdk";
import { KeyHandoverAgent, type SerializedPending } from "@fastxyz/sdk/wallet";
import { Effect } from "effect";
import type { AuthorizeCompleteArgs } from "../../cli.js";
import {
  CorruptPendingStateError,
  FileIOError,
  KeyHandoverProtocolError,
  MissingHandoverMessageError,
  NoPendingRequestError,
} from "../../errors/index.js";
import { ClientConfig } from "../../services/config/client.js";
import { Prompt } from "../../services/prompt.js";
import type { Command } from "../index.js";
import { pendingFilePath } from "./request.js";

const atomicWrite = (
  filePath: string,
  data: string,
): Effect.Effect<void, FileIOError> =>
  Effect.tryPromise({
    try: async () => {
      const tmp = `${filePath}.tmp`;
      await fs.writeFile(tmp, data, { mode: 0o600 });
      await fs.rename(tmp, filePath);
    },
    catch: (cause) =>
      new FileIOError({ message: `Failed to write ${filePath}`, cause }),
  });

const unlinkSilent = (filePath: string): Promise<void> =>
  fs.unlink(filePath).catch(() => undefined);

const flushStdout = (): Promise<void> =>
  new Promise<void>((resolve) => process.stdout.write("", () => resolve()));

export const authorizeComplete: Command<AuthorizeCompleteArgs> = {
  cmd: "authorize-complete",
  handler: (args: AuthorizeCompleteArgs) =>
    Effect.gen(function* () {
      const config = yield* ClientConfig;
      const prompt = yield* Prompt;
      const filePath = pendingFilePath();

      // Step 1: read pending state file
      const raw = yield* Effect.tryPromise({
        try: () => fs.readFile(filePath, "utf-8"),
        catch: () => new NoPendingRequestError(),
      });

      // Step 2: parse and validate
      let state: SerializedPending;
      try {
        const parsed = JSON.parse(raw) as SerializedPending;
        if (
          parsed.v !== 1 ||
          !parsed.hpke_private_key_jwk ||
          !parsed.request_payload
        ) {
          return yield* Effect.fail(
            new CorruptPendingStateError({
              reason: "missing required fields or unsupported version",
            }),
          );
        }
        state = parsed;
      } catch (err) {
        return yield* Effect.fail(
          new CorruptPendingStateError({
            reason: err instanceof Error ? err.message : String(err),
          }),
        );
      }

      // Step 3: restore agent
      const agent = yield* Effect.tryPromise({
        try: () => KeyHandoverAgent.restore(state),
        catch: (cause) =>
          new CorruptPendingStateError({
            reason: cause instanceof Error ? cause.message : String(cause),
          }),
      });

      // Step 4: get handover message
      let handoverMessage: string;
      if (args.message !== undefined && args.message !== null) {
        handoverMessage = args.message;
      } else if (args.stdin) {
        handoverMessage = yield* Effect.tryPromise({
          try: () =>
            new Promise<string>((resolve, reject) => {
              const chunks: Buffer[] = [];
              process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
              process.stdin.on("end", () =>
                resolve(Buffer.concat(chunks).toString("utf-8").trim()),
              );
              process.stdin.on("error", reject);
            }),
          catch: (cause) =>
            new FileIOError({ message: "Failed to read from stdin", cause }),
        });
      } else if (!config.nonInteractive) {
        handoverMessage = yield* prompt.input({ label: "Handover code:" });
      } else {
        return yield* Effect.fail(new MissingHandoverMessageError());
      }

      // Step 5: decrypt
      const result = yield* Effect.tryPromise({
        try: () => agent.decryptAuthPayload({ message: handoverMessage }),
        catch: (cause) =>
          new FileIOError({
            message: "Unexpected error from decryptAuthPayload",
            cause,
          }),
      });

      // Step 6: handle result
      if (result.status === "success") {
        const seedHex = `0x${result.private_key}`;
        const seedBytes = Buffer.from(result.private_key, "hex");

        let address: string | undefined;
        let publicKey: string | undefined;

        if (args.printAccount) {
          const signer = new Signer(seedBytes);
          address = yield* Effect.tryPromise({
            try: () => signer.getFastAddress(),
            catch: (cause) =>
              new FileIOError({
                message:
                  "Failed to derive Fast address — state file preserved for retry",
                cause,
              }),
          });
          const pubKeyBytes = yield* Effect.tryPromise({
            try: () => signer.getPublicKey(),
            catch: (cause) =>
              new FileIOError({
                message:
                  "Failed to derive public key — state file preserved for retry",
                cause,
              }),
          });
          publicKey = toHex(pubKeyBytes);
        }

        // Compose output in memory first
        if (config.json) {
          const data: Record<string, string> = { private_key: seedHex };
          if (address !== undefined) data.address = address;
          if (publicKey !== undefined) data.public_key = publicKey;
          yield* Effect.tryPromise({
            try: () => {
              process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
              return flushStdout();
            },
            catch: (cause) =>
              new FileIOError({ message: "Failed to write output", cause }),
          });
        } else if (
          args.printAccount &&
          address !== undefined &&
          publicKey !== undefined
        ) {
          yield* Effect.tryPromise({
            try: () => {
              process.stdout.write(`Private key:     ${seedHex}\n`);
              process.stdout.write(`Address:         ${address}\n`);
              process.stdout.write(`Public key:      ${publicKey}\n`);
              return flushStdout();
            },
            catch: (cause) =>
              new FileIOError({ message: "Failed to write output", cause }),
          });
        } else {
          yield* Effect.tryPromise({
            try: () => {
              process.stdout.write(`${seedHex}\n`);
              return flushStdout();
            },
            catch: (cause) =>
              new FileIOError({ message: "Failed to write output", cause }),
          });
        }

        // Delete pending file only after successful flush
        yield* Effect.promise(() => unlinkSilent(filePath));
        return;
      }

      // Error path
      const code = result.error.code;
      const msg = result.error.message;

      if (
        code === "MALFORMED_HANDOVER_MESSAGE" ||
        code === "INVALID_HANDOVER_CODE"
      ) {
        // Do not touch state file
        return yield* Effect.fail(
          new KeyHandoverProtocolError({ sdkCode: code, message: msg }),
        );
      }

      if (code === "DECRYPTION_FAILED") {
        // Re-export updated failure count, write back or delete
        const updated = yield* Effect.tryPromise({
          try: () => agent.exportPending(),
          catch: (cause) =>
            new FileIOError({
              message: "Failed to re-export pending state",
              cause,
            }),
        });
        if (updated !== null) {
          yield* atomicWrite(filePath, JSON.stringify(updated, null, 2));
        } else {
          yield* Effect.promise(() => unlinkSilent(filePath));
        }
        return yield* Effect.fail(
          new KeyHandoverProtocolError({ sdkCode: code, message: msg }),
        );
      }

      // TOO_MANY_FAILURES, REQUEST_EXPIRED, MISSING_PENDING_REQUEST, STORAGE_FAILED
      yield* Effect.promise(() => unlinkSilent(filePath));
      return yield* Effect.fail(
        new KeyHandoverProtocolError({ sdkCode: code, message: msg }),
      );
    }),
};
