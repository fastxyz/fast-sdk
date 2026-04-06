/**
 * Unified CLI entrypoint.
 *
 * Parses argv with optique, dispatches to command handlers, and handles all
 * errors in one place.
 */

import { formatDocPage } from "@optique/core/doc";
import { formatMessage } from "@optique/core/message";
import { getDocPageSync, parse } from "@optique/core/parser";
import { Option } from "effect";

import { type GlobalOptions, runHandler } from "./app.js";
import { type ParsedArgs, parser } from "./cli.js";
import { InternalError, InvalidUsageError } from "./errors/index.js";
import { writeFail } from "./services/output.js";

// Command handlers (will be updated in Task 5 to export Effect programs)
import { accountCreateHandler } from "./commands/account/create.js";
import { accountDeleteHandler } from "./commands/account/delete.js";
import { accountExportHandler } from "./commands/account/export.js";
import { accountImportHandler } from "./commands/account/import.js";
import { accountInfoHandler } from "./commands/account/info.js";
import { accountListHandler } from "./commands/account/list.js";
import { accountSetDefaultHandler } from "./commands/account/set-default.js";
import { infoBalanceHandler } from "./commands/info/balance.js";
import { infoHistoryHandler } from "./commands/info/history.js";
import { infoStatusHandler } from "./commands/info/status.js";
import { infoTxHandler } from "./commands/info/tx.js";
import { networkAddHandler } from "./commands/network/add.js";
import { networkListHandler } from "./commands/network/list.js";
import { networkRemoveHandler } from "./commands/network/remove.js";
import { networkSetDefaultHandler } from "./commands/network/set-default.js";
import { sendHandler } from "./commands/send.js";

const VERSION = "0.1.0";

const rawArgs = process.argv.slice(2);
const isJson = rawArgs.includes("--json");

// ---------------------------------------------------------------------------
// --version
// ---------------------------------------------------------------------------
if (rawArgs.includes("--version") || rawArgs.includes("-v")) {
  process.stdout.write(`${VERSION}\n`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// --help (show generated doc page)
// ---------------------------------------------------------------------------
if (
  rawArgs.length === 0 ||
  rawArgs.includes("--help") ||
  rawArgs.includes("-h")
) {
  const docPage = getDocPageSync(parser);
  if (docPage) {
    const text = formatDocPage("fast", docPage, {
      colors: process.stdout.isTTY ?? false,
    });
    process.stdout.write(`${text}\n`);
  } else {
    process.stdout.write("fast-cli v0.1.0\n");
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Parse argv
// ---------------------------------------------------------------------------
const result = parse(parser, rawArgs);

if (!result.success) {
  writeFail(
    new InvalidUsageError({ message: formatMessage(result.error) }),
    isJson,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Build GlobalOptions
// ---------------------------------------------------------------------------
const parsed: ParsedArgs = result.value;

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
const { cmd } = parsed;

const dispatch = (): Promise<void> => {
  switch (cmd) {
    case "account-create":
      return runHandler(globalOpts, accountCreateHandler(parsed));
    case "account-delete":
      return runHandler(globalOpts, accountDeleteHandler(parsed));
    case "account-export":
      return runHandler(globalOpts, accountExportHandler(parsed));
    case "account-import":
      return runHandler(globalOpts, accountImportHandler(parsed));
    case "account-info":
      return runHandler(globalOpts, accountInfoHandler(parsed));
    case "account-list":
      return runHandler(globalOpts, accountListHandler(parsed));
    case "account-set-default":
      return runHandler(globalOpts, accountSetDefaultHandler(parsed));
    case "info-balance":
      return runHandler(globalOpts, infoBalanceHandler(parsed));
    case "info-history":
      return runHandler(globalOpts, infoHistoryHandler(parsed));
    case "info-status":
      return runHandler(globalOpts, infoStatusHandler(parsed));
    case "info-tx":
      return runHandler(globalOpts, infoTxHandler(parsed));
    case "network-add":
      return runHandler(globalOpts, networkAddHandler(parsed));
    case "network-list":
      return runHandler(globalOpts, networkListHandler(parsed));
    case "network-remove":
      return runHandler(globalOpts, networkRemoveHandler(parsed));
    case "network-set-default":
      return runHandler(globalOpts, networkSetDefaultHandler(parsed));
    case "send":
      return runHandler(globalOpts, sendHandler(parsed));
    default: {
      // TypeScript exhaustiveness check
      const _: never = cmd;
      throw new Error(`Unknown command: ${_}`);
    }
  }
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
