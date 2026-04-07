/**
 * Unified CLI entrypoint.
 *
 * Two-pass parse: first lenient pass extracts global flags (--json,
 * --version) via a passThrough pre-parser. Second pass parses the full
 * command tree.
 *
 * Help is detected separately: optique's greedy passThrough swallows
 * --help after command tokens, so we check argv directly. This is the
 * standard pattern — every CLI framework special-cases help detection.
 * getDocPageSync then generates contextual docs per subcommand.
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

// ── Version ─────────────────────────────────────────────────────────────────

if (pre.success && pre.value.version) {
  process.stdout.write(`${getVersion()}\n`);
  process.exit(0);
}

// ── Help ────────────────────────────────────────────────────────────────────

if (argv.length === 0 || argv.includes("--help")) {
  const contextArgs = argv.filter((a) => a !== "--help");
  const rawDoc = getDocPageSync(parser, contextArgs);
  if (rawDoc) {
    // For subcommands, use optique's output directly.
    // For top-level, split into "Commands" and "Global options" sections.
    const doc =
      contextArgs.length > 0
        ? rawDoc
        : {
            ...rawDoc,
            usage: undefined,
            brief: [{ type: "text" as const, text: `Usage: ${getAppName()} <command> [options]` }],
            sections: [
              {
                title: "Commands",
                entries: rawDoc.sections
                  .flatMap((s) => ("entries" in s ? s.entries : []))
                  .filter((e) => e.term.type === "command"),
              },
              {
                title: "Global options",
                entries: rawDoc.sections
                  .flatMap((s) => ("entries" in s ? s.entries : []))
                  .filter((e) => e.term.type === "option"),
              },
            ],
            footer: [
              { type: "text" as const, text: `Run \`${getAppName()} <command> --help\` for command details.` },
            ],
          };
    process.stdout.write(
      `${formatDocPage(getAppName(), doc, { colors: process.stdout.isTTY ?? false })}\n`,
    );
  }
  process.exit(0);
}

// ── Full parse ──────────────────────────────────────────────────────────────

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
