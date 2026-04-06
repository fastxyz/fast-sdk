/**
 * Unified CLI entrypoint.
 *
 * Two-pass parse: first lenient pass extracts global flags (--json, --help,
 * --version) via a parser with passThrough. Second pass parses the full
 * command tree. ZERO raw argv parsing — all flag detection goes through optique.
 */

import { formatDocPage } from "@optique/core/doc";
import { formatMessage } from "@optique/core/message";
import { getDocPageSync, parse } from "@optique/core/parser";
import { type Effect, Option } from "effect";

import { type GlobalOptions, runHandler } from "./app.js";
import { globalPreParser, parser } from "./cli.js";
import { commands } from "./commands/index.js";
import {
  type ClientError,
  InternalError,
  InvalidUsageError,
} from "./errors/index.js";
import { getAppName, getVersion } from "./services/config/app.js";
import { writeFail } from "./services/output.js";

const argv = process.argv.slice(2);

const pre = parse(globalPreParser, argv);
const isJson = pre.success && pre.value.json;
const isHelp = argv.length === 0 || (pre.success && pre.value.help);
const isVersion = pre.success && pre.value.version;

if (isVersion) {
  process.stdout.write(`${getVersion()}\n`);
  process.exit(0);
}

if (isHelp) {
  const docPage = getDocPageSync(parser);
  if (docPage) {
    process.stdout.write(
      `${formatDocPage(getAppName(), docPage, { colors: process.stdout.isTTY ?? false })}\n`,
    );
  }
  process.exit(0);
}

const result = parse(parser, argv);

if (!result.success) {
  writeFail(
    new InvalidUsageError({ message: formatMessage(result.error) }),
    isJson,
  );
  process.exit(1);
}

const parsed = result.value;

const globalOpts: GlobalOptions = {
  json: parsed.json,
  debug: parsed.debug,
  nonInteractive: parsed.nonInteractive,
  network: parsed.network,
  account: Option.fromNullable(parsed.account),
  password: Option.fromNullable(parsed.password),
};

const dispatch = () => {
  const entry = commands.find((c) => c.cmd === parsed.cmd);
  if (!entry) {
    writeFail(
      new InternalError({ message: `Unknown command: ${parsed.cmd}` }),
      isJson,
    );
    return process.exit(1);
  }

  const handler = entry.handler as (
    args: typeof parsed,
  ) => Effect.Effect<void, ClientError, unknown>;
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
