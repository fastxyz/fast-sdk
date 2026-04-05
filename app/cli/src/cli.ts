import { Command } from "@effect/cli";
import { accountCommand } from "./commands/account/index.js";
import { infoCommand } from "./commands/info/index.js";
import { networkCommand } from "./commands/network/index.js";
import { sendCommand } from "./commands/send.js";
import { makeAppLayer } from "./layers.js";
import { rootOptions } from "./services/cli-config.js";

export const rootCommand = Command.make("fast", rootOptions).pipe(
  Command.withDescription(
    "Fast CLI - Account, network, and transaction management",
  ),
  Command.provide(makeAppLayer),
  Command.withSubcommands([
    accountCommand,
    networkCommand,
    infoCommand,
    sendCommand,
  ]),
);
