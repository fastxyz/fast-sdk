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

import type { DocPage } from "@optique/core/doc";
import { formatDocPage } from "@optique/core/doc";
import { formatMessage } from "@optique/core/message";
import type { Message } from "@optique/core/message";
import { getDocPageSync, parse } from "@optique/core/parser";
import { Effect, Option } from "effect";

import { type GlobalOptions, runHandler } from "./app.js";
import { globalPreParser, parser } from "./cli.js";
import { commands } from "./commands/index.js";
import {
  type ClientError,
  InternalError,
  InvalidUsageError,
} from "./errors/index.js";
import { getAppName, getVersion } from "./services/config/app.js";
import { writeFail, writeOk } from "./services/output.js";

// ---------------------------------------------------------------------------
// Helpers — convert DocPage to a plain JSON-serialisable object
// ---------------------------------------------------------------------------

const messageToString = (msg: Message | undefined): string | undefined => {
  if (!msg || msg.length === 0) return undefined;
  return msg
    .map((t) => {
      switch (t.type) {
        case "text":
          return t.text;
        case "optionName":
          return t.optionName;
        case "optionNames":
          return t.optionNames.join(", ");
        case "metavar":
          return t.metavar;
        case "value":
          return t.value;
        case "values":
          return t.values.join(", ");
        case "lineBreak":
          return "\n";
        default:
          return "";
      }
    })
    .join("");
};

const docPageToJson = (doc: DocPage) => {
  const result: Record<string, unknown> = {};
  for (const section of doc.sections) {
    const key = (section.title ?? "entries").toLowerCase().replace(/\s+/g, "_");
    result[key] = section.entries.map((e) => {
      const base: Record<string, unknown> = {};
      if (e.term.type === "command") base.name = e.term.name;
      else if (e.term.type === "option") base.name = e.term.names.join(", ");
      else if (e.term.type === "argument") base.name = e.term.metavar;
      const desc = messageToString(e.description);
      if (desc) base.description = desc;
      const def = messageToString(e.default);
      if (def) base.default = def;
      return base;
    });
  }
  return result;
};

const argv = process.argv.slice(2);
const pre = parse(globalPreParser, argv);
const isJson = argv.includes("--json");

// ── Version ─────────────────────────────────────────────────────────────────

if (pre.success && pre.value.version) {
  process.stdout.write(`${getVersion()}\n`);
  process.exit(0);
}

// ── Help ────────────────────────────────────────────────────────────────────

if (argv.length === 0 || argv.includes("--help")) {
  const contextArgs = argv.filter((a) => a !== "--help" && a !== "--json");
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

    if (isJson) {
      writeOk(docPageToJson(doc), true);
    } else {
      process.stdout.write(
        `${formatDocPage(getAppName(), doc, { colors: process.stdout.isTTY ?? false })}\n`,
      );
    }
  }
  process.exit(0);
}

// ── Full parse ──────────────────────────────────────────────────────────────

const KNOWN_COMMANDS = ["account", "network", "info", "send", "fund", "pay"] as const;

const SUBCOMMANDS: Record<string, readonly string[]> = {
  account: ["create", "import", "list", "set-default", "info", "export", "delete"],
  network: ["list", "add", "set-default", "remove"],
  info: ["status", "balance", "tx", "history"],
  fund: ["fiat", "crypto"],
};

/** Simple Levenshtein distance for short strings. */
const levenshtein = (a: string, b: string): number => {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
};

const suggest = (token: string, candidates: readonly string[]): string | null => {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = levenshtein(token.toLowerCase(), c);
    if (d < bestDist && d <= 2) {
      bestDist = d;
      best = c;
    }
  }
  return best;
};

const result = parse(parser, argv);

if (!result.success) {
  const firstToken = argv.find((a) => !a.startsWith("-"));
  let msg = formatMessage(result.error);

  if (firstToken && !KNOWN_COMMANDS.includes(firstToken as never)) {
    const suggestion = suggest(firstToken, KNOWN_COMMANDS);
    msg = suggestion
      ? `Unknown command '${firstToken}'. Did you mean '${suggestion}'?`
      : `Unknown command '${firstToken}'. Available: ${KNOWN_COMMANDS.join(", ")}.`;
  } else if (firstToken && firstToken in SUBCOMMANDS) {
    const subs = SUBCOMMANDS[firstToken];
    const secondToken = argv.find((a) => a !== firstToken && !a.startsWith("-"));
    if (!secondToken) {
      msg = `Missing subcommand for '${firstToken}'. Available: ${subs.join(", ")}.`;
    } else {
      const s = suggest(secondToken, subs);
      msg = s
        ? `Unknown subcommand '${secondToken}' for '${firstToken}'. Did you mean '${s}'?`
        : `Unknown subcommand '${secondToken}' for '${firstToken}'. Available: ${subs.join(", ")}.`;
    }
  }

  writeFail(new InvalidUsageError({ message: msg }), isJson);
  process.exit(1);
}

const parsed = result.value;

// Resolve network: explicit --network > DB default > hardcoded fallback
const resolveNetwork = async (): Promise<string> => {
  if (parsed.network) return parsed.network;
  try {
    const { Effect: Eff, ManagedRuntime, Layer } = await import("effect");
    const { NetworkConfigService } = await import("./services/storage/network.js");
    const { DatabaseLive } = await import("./services/storage/database.js");
    const { AppConfigLive } = await import("./services/config/app.js");
    const layer = Layer.provide(NetworkConfigService.Default, Layer.merge(DatabaseLive, AppConfigLive));
    const runtime = ManagedRuntime.make(layer);
    const name = await runtime.runPromise(
      Eff.flatMap(NetworkConfigService, (s) => s.getDefault()).pipe(
        Eff.catchAll(() => Eff.succeed("testnet")),
      ),
    );
    await runtime.dispose();
    return name;
  } catch {
    return "testnet";
  }
};

const network = await resolveNetwork();

const globalOpts: GlobalOptions = {
  json: parsed.json,
  debug: parsed.debug,
  nonInteractive: parsed.nonInteractive,
  network,
  account: Option.fromNullable(parsed.account),
  password: Option.fromNullable(parsed.password),
};

if (parsed.debug) {
  const dbPath = `${process.env.HOME ?? "~"}/.fast/fast.db`;
  process.stderr.write(`[debug] command:         ${parsed.cmd}\n`);
  process.stderr.write(`[debug] network:         ${network}\n`);
  process.stderr.write(`[debug] account:         ${parsed.account ?? "(default)"}\n`);
  process.stderr.write(`[debug] non-interactive: ${parsed.nonInteractive}\n`);
  process.stderr.write(`[debug] db:              ${dbPath}\n`);
}

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
