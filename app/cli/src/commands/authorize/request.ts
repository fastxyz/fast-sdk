import * as fs from "node:fs/promises";
import * as path from "node:path";
import { KeyHandoverAgent, type SerializedPending } from "@fastxyz/sdk/wallet";
import { Effect } from "effect";
import type { AuthorizeRequestArgs } from "../../cli.js";
import {
  FileIOError,
  InternalError,
  InvalidUsageError,
  PendingAlreadyExistsError,
} from "../../errors/index.js";
import { ClientConfig } from "../../services/config/client.js";
import { Output } from "../../services/output.js";
import type { Command } from "../index.js";

const PENDING_FILE_NAME = "handover-pending.json";

export const pendingFilePath = (): string => {
  const home = process.env.HOME ?? "~";
  return path.join(home, ".fast", PENDING_FILE_NAME);
};

/**
 * Validates an optional --url override. Returns the URL string if valid,
 * `undefined` if the user did not pass --url (SDK will use its default).
 * Throws `InvalidUsageError` if the URL is not parseable.
 */
export const validateWalletBaseUrl = (
  input: string | null | undefined,
): string | undefined => {
  if (input === undefined || input === null || input === "") return undefined;
  try {
    new URL(input);
  } catch {
    throw new InvalidUsageError({
      message: `Invalid --url value: ${input}`,
    });
  }
  return input;
};

const atomicWrite = (
  filePath: string,
  data: string,
): Effect.Effect<void, FileIOError> =>
  Effect.tryPromise({
    try: async () => {
      const tmp = `${filePath}.tmp`;
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(tmp, data, { mode: 0o600 });
      await fs.rename(tmp, filePath);
    },
    catch: (cause) =>
      new FileIOError({ message: `Failed to write ${filePath}`, cause }),
  });

export const authorizeRequest: Command<AuthorizeRequestArgs> = {
  cmd: "authorize-request",
  handler: (args: AuthorizeRequestArgs) =>
    Effect.gen(function* () {
      const output = yield* Output;
      const config = yield* ClientConfig;
      const filePath = pendingFilePath();

      // Check for existing pending file
      const existing = yield* Effect.tryPromise({
        try: () => fs.readFile(filePath, "utf-8").catch(() => null),
        catch: (cause) =>
          new FileIOError({ message: `Failed to read ${filePath}`, cause }),
      });

      if (existing !== null) {
        let parsed: SerializedPending | null = null;
        try {
          parsed = JSON.parse(existing) as SerializedPending;
        } catch {
          // Corrupt file — treat as expired and overwrite
        }

        if (parsed !== null) {
          const expiresAt = new Date(parsed.expires_at);
          if (expiresAt > new Date()) {
            return yield* Effect.fail(
              new PendingAlreadyExistsError({
                fingerprint: parsed.fingerprint,
                expiresAt: parsed.expires_at,
              }),
            );
          }
          // Expired — delete old and continue
          if (!config.json) {
            process.stderr.write(
              `Note: previous pending request (fingerprint ${parsed.fingerprint}) expired at ${parsed.expires_at}, replaced.\n`,
            );
          }
          yield* Effect.tryPromise({
            try: () => fs.unlink(filePath).catch(() => undefined),
            catch: (cause) =>
              new FileIOError({
                message: `Failed to delete ${filePath}`,
                cause,
              }),
          });
        }
      }

      // Resolve optional --url override
      const walletBaseUrl = yield* Effect.try({
        try: () => validateWalletBaseUrl(args.url ?? undefined),
        catch: (cause) =>
          cause instanceof InvalidUsageError
            ? cause
            : new InvalidUsageError({ message: String(cause) }),
      });

      // Generate auth request
      const agent = new KeyHandoverAgent(
        walletBaseUrl !== undefined ? { walletBaseUrl } : {},
      );
      const authResult = yield* Effect.tryPromise({
        try: () =>
          agent.generateAuthRequest({
            requester: args.requester ?? undefined,
          }),
        catch: (cause) =>
          new InternalError({
            message: "Failed to generate auth request",
            cause,
          }),
      });

      const state = yield* Effect.tryPromise({
        try: () => agent.exportPending(),
        catch: (cause) =>
          new InternalError({
            message: "Failed to export pending state",
            cause,
          }),
      });

      if (state === null) {
        return yield* Effect.fail(
          new InternalError({
            message:
              "exportPending() returned null immediately after generateAuthRequest()",
          }),
        );
      }

      yield* atomicWrite(filePath, JSON.stringify(state, null, 2));

      if (config.json) {
        yield* output.ok({
          auth_url: authResult.auth_url,
          request_fingerprint: authResult.request_fingerprint,
          request_expires_at: authResult.request_expires_at,
        });
      } else {
        yield* output.humanLine("Authorization URL:");
        yield* output.humanLine(`  ${authResult.auth_url}`);
        yield* output.humanLine("");
        yield* output.humanLine(
          `Fingerprint:    ${authResult.request_fingerprint}`,
        );
        yield* output.humanLine(
          `Expires at:     ${authResult.request_expires_at}`,
        );
        yield* output.humanLine("");
        yield* output.humanLine(
          "Show the URL to the wallet user. Once they paste back the handover",
        );
        yield* output.humanLine("code, run:");
        yield* output.humanLine(
          "  fast authorize complete --message '<paste here>'",
        );
        yield* output.humanLine("");
        yield* output.humanLine(
          `Note: a short-lived authorization key is stored at ${filePath} (mode 0600) for up to 5 minutes.`,
        );
      }
    }),
};
