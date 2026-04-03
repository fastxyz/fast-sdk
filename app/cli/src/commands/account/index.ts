import { Command } from "@effect/cli"
import { accountCreate } from "./create.js"
import { accountImport } from "./import.js"
import { accountList } from "./list.js"
import { accountSetDefault } from "./set-default.js"
import { accountInfo } from "./info.js"
import { accountExport } from "./export.js"
import { accountDelete } from "./delete.js"

export const accountCommand = Command.make("account").pipe(
  Command.withDescription("Manage accounts"),
  Command.withSubcommands([
    accountCreate,
    accountImport,
    accountList,
    accountSetDefault,
    accountInfo,
    accountExport,
    accountDelete,
  ]),
)
