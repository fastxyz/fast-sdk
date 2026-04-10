CREATE TABLE `accounts` (
	`name` text PRIMARY KEY NOT NULL,
	`fast_address` text NOT NULL,
	`evm_address` text NOT NULL,
	`encrypted_key` blob NOT NULL,
	`encrypted` integer DEFAULT true NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `custom_networks` (
	`name` text PRIMARY KEY NOT NULL,
	`config` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `history` (
	`hash` text PRIMARY KEY NOT NULL,
	`type` text DEFAULT 'transfer' NOT NULL,
	`from` text NOT NULL,
	`to` text NOT NULL,
	`amount` text NOT NULL,
	`formatted` text NOT NULL,
	`token_name` text NOT NULL,
	`token_id` text NOT NULL,
	`network` text NOT NULL,
	`status` text NOT NULL,
	`timestamp` text NOT NULL,
	`explorer_url` text,
	`route` text DEFAULT 'fast' NOT NULL,
	`chain_id` integer
);
--> statement-breakpoint
CREATE INDEX `idx_history_timestamp` ON `history` (`timestamp`);--> statement-breakpoint
CREATE TABLE `metadata` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
