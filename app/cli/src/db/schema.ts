import {
  blob,
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const accounts = sqliteTable("accounts", {
  name: text("name").primaryKey(),
  fastAddress: text("fast_address").notNull(),
  evmAddress: text("evm_address").notNull(),
  encryptedKey: blob("encrypted_key", { mode: "buffer" }).notNull(),
  encrypted: integer("encrypted", { mode: "boolean" })
    .notNull()
    .default(true),
  isDefault: integer("is_default", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: text("created_at").notNull(),
});

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

export const accessKeys = sqliteTable(
  "access_keys",
  {
    accessKeyId: text("access_key_id").primaryKey(),
    ownerAccountName: text("owner_account_name").notNull(),
    ownerFastAddress: text("owner_fast_address").notNull(),
    network: text("network").notNull(),
    delegatePublicKey: text("delegate_public_key").notNull(),
    encryptedPrivateKey: blob("encrypted_private_key", { mode: "buffer" }).notNull(),
    encrypted: integer("encrypted", { mode: "boolean" })
      .notNull()
      .default(true),
    label: text("label"),
    clientId: text("client_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_access_keys_owner_network").on(table.ownerFastAddress, table.network)],
);
