import type { Effect } from "effect";
import type { CommandName } from "../cli.js";
import { accountCreate } from "./account/create.js";
import { accountDelete } from "./account/delete.js";
import { accountExport } from "./account/export.js";
import { accountImport } from "./account/import.js";
import { accountInfo } from "./account/info.js";
import { accountList } from "./account/list.js";
import { accountSetDefault } from "./account/set-default.js";
import { infoBalance } from "./info/balance.js";
import { infoHistory } from "./info/history.js";
import { infoStatus } from "./info/status.js";
import { infoTx } from "./info/tx.js";
import { networkAdd } from "./network/add.js";
import { networkList } from "./network/list.js";
import { networkRemove } from "./network/remove.js";
import { networkSetDefault } from "./network/set-default.js";
import { send } from "./send.js";

export const commands: Command[] = [
  accountCreate,
  accountDelete,
  accountExport,
  accountImport,
  accountInfo,
  accountList,
  accountSetDefault,
  infoBalance,
  infoHistory,
  infoStatus,
  infoTx,
  networkAdd,
  networkList,
  networkRemove,
  networkSetDefault,
  send,
];

/**
 * A command entry: a discriminant + an Effect handler.
 * Uses `any` for args because each handler accepts its own narrow arg type
 * (e.g., AccountCreateArgs), while the dispatcher passes ParsedArgs.
 * Type safety is guaranteed by the optique parser — args are always valid
 * for the matched command.
 */
export interface Command {
  readonly cmd: CommandName;
  // biome-ignore lint/suspicious/noExplicitAny: handlers use narrow arg types; safety comes from the parser
  readonly handler: (args: any) => Effect.Effect<void, any, any>;
}
