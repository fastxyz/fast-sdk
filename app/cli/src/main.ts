/**
 * Unified CLI entrypoint.
 *
 * Parses argv with optique's runParserSync (handles --help, --version,
 * and parse errors automatically), dispatches to command handlers.
 */

import { runParserSync } from "@optique/core/facade";
import type { Effect } from "effect";
import { Option } from "effect";

import { type GlobalOptions, runHandler } from "./app.js";
import { type CommandName, type ParsedArgs, parser } from "./cli.js";
import { InternalError, InvalidUsageError } from "./errors/index.js";
import { writeFail } from "./services/output.js";

const VERSION = "0.1.0";
const rawArgs = process.argv.slice(2);
const isJson = rawArgs.includes("--json");

const parsed: ParsedArgs = runParserSync(parser, "fast", rawArgs, {
  colors: process.stdout.isTTY ?? false,
  help: { onShow: () => process.exit(0) },
  version: { value: VERSION, onShow: () => process.exit(0) },
  onError: (exitCode) => {
    // runParserSync already printed the error to stderr.
    // For --json callers, also write a structured envelope.
    if (isJson) {
      writeFail(new InvalidUsageError({ message: "Invalid arguments" }), true);
    }
    process.exit(exitCode);
  },
});

// ---------------------------------------------------------------------------
// Build GlobalOptions
// ---------------------------------------------------------------------------
const globalOpts: GlobalOptions = {
  json: parsed.json,
  debug: parsed.debug,
  nonInteractive: parsed.nonInteractive,
  network: parsed.network,
  account: parsed.account != null ? Option.some(parsed.account) : Option.none(),
  password:
    parsed.password != null ? Option.some(parsed.password) : Option.none(),
};

// ---------------------------------------------------------------------------
// Dispatch to command handler
// ---------------------------------------------------------------------------
type Handler = (args: any) => Effect.Effect<void, any, any>;

const handlers: Record<CommandName, () => Promise<Handler>> = {
  "account-create": () =>
    import("./commands/account/create.js").then((m) => m.accountCreateHandler),
  "account-delete": () =>
    import("./commands/account/delete.js").then((m) => m.accountDeleteHandler),
  "account-export": () =>
    import("./commands/account/export.js").then((m) => m.accountExportHandler),
  "account-import": () =>
    import("./commands/account/import.js").then((m) => m.accountImportHandler),
  "account-info": () =>
    import("./commands/account/info.js").then((m) => m.accountInfoHandler),
  "account-list": () =>
    import("./commands/account/list.js").then((m) => m.accountListHandler),
  "account-set-default": () =>
    import("./commands/account/set-default.js").then(
      (m) => m.accountSetDefaultHandler,
    ),
  "info-balance": () =>
    import("./commands/info/balance.js").then((m) => m.infoBalanceHandler),
  "info-history": () =>
    import("./commands/info/history.js").then((m) => m.infoHistoryHandler),
  "info-status": () =>
    import("./commands/info/status.js").then((m) => m.infoStatusHandler),
  "info-tx": () =>
    import("./commands/info/tx.js").then((m) => m.infoTxHandler),
  "network-add": () =>
    import("./commands/network/add.js").then((m) => m.networkAddHandler),
  "network-list": () =>
    import("./commands/network/list.js").then((m) => m.networkListHandler),
  "network-remove": () =>
    import("./commands/network/remove.js").then((m) => m.networkRemoveHandler),
  "network-set-default": () =>
    import("./commands/network/set-default.js").then(
      (m) => m.networkSetDefaultHandler,
    ),
  send: () => import("./commands/send.js").then((m) => m.sendHandler),
};

const dispatch = async (): Promise<void> => {
  const handler = await handlers[parsed.cmd]();
  return runHandler(globalOpts, handler(parsed));
};

dispatch().catch((err: unknown) => {
  writeFail(
    new InternalError({
      message: err instanceof Error ? err.message : String(err),
      cause: err,
    }),
    isJson,
  );
  process.exit(1);
});
