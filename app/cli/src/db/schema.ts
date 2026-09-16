import { sql } from "drizzle-orm";
import {
  blob,
  check,
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const accounts = sqliteTable(
  "accounts",
  {
    name: text("name").primaryKey(),
    kind: text("kind").notNull().default("single"),
    fastAddress: text("fast_address").notNull(),
    evmAddress: text("evm_address"),
    encryptedKey: blob("encrypted_key", { mode: "buffer" }),
    encrypted: integer("encrypted", { mode: "boolean" }),
    multisigConfig: text("multisig_config"),
    isDefault: integer("is_default", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    check(
      "accounts_kind_payload_check",
      sql`(${table.kind} = 'single' AND ${table.evmAddress} IS NOT NULL AND ${table.encryptedKey} IS NOT NULL AND ${table.encrypted} IS NOT NULL AND ${table.multisigConfig} IS NULL) OR (${table.kind} = 'multisig' AND ${table.evmAddress} IS NULL AND ${table.encryptedKey} IS NULL AND ${table.encrypted} IS NULL AND ${table.multisigConfig} IS NOT NULL)`,
    ),
  ],
);

export const history = sqliteTable(
  "history",
  {
    hash: text("hash").primaryKey(),
    type: text("type").notNull().default("transfer"),
    from: text("from").notNull(),
    to: text("to").notNull(),
    amount: text("amount").notNull(),
    formatted: text("formatted").notNull(),
    tokenName: text("token_name").notNull(),
    tokenId: text("token_id").notNull(),
    network: text("network").notNull(),
    status: text("status").notNull(),
    timestamp: text("timestamp").notNull(),
    explorerUrl: text("explorer_url"),
    route: text("route").notNull().default("fast"),
    chainId: integer("chain_id"),
  },
  (table) => [index("idx_history_timestamp").on(table.timestamp)],
);

export const customNetworks = sqliteTable("custom_networks", {
  name: text("name").primaryKey(),
  config: text("config").notNull(),
});

export const metadata = sqliteTable("metadata", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
