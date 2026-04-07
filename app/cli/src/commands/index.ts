import type { Effect } from "effect";
import type { CommandName } from "../cli.js";
import type { ClientError } from "../errors/index.js";
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
import { pay } from "./pay.js";
import { send } from "./send.js";

export const commands = [
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
  pay,
];

/**
 * A command entry: a discriminant + an Effect handler.
 *
 * Generic `TArgs` narrows the handler's argument type at the definition site
 * (e.g., `Command<AccountCreateArgs>`). The default `unknown` is used in
 * the commands array where heterogeneous commands are collected — type safety
 * is guaranteed by the optique parser matching the right args to the right cmd.
 */
export interface Command<TArgs = unknown> {
  readonly cmd: CommandName;
  readonly handler: (args: TArgs) => Effect.Effect<void, ClientError, unknown>;
}
