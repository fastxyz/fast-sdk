import { Schema } from "effect"

export class AccountEntry extends Schema.Class<AccountEntry>("AccountEntry")({
  name: Schema.String,
  createdAt: Schema.String,
}) {}

export class AccountsFile extends Schema.Class<AccountsFile>("AccountsFile")({
  default: Schema.NullOr(Schema.String),
  accounts: Schema.Array(AccountEntry),
}) {}
