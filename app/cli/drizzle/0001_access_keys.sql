CREATE TABLE `access_keys` (
	`access_key_id` text PRIMARY KEY NOT NULL,
	`owner_account_name` text NOT NULL,
	`owner_fast_address` text NOT NULL,
	`network` text NOT NULL,
	`delegate_public_key` text NOT NULL,
	`encrypted_private_key` blob NOT NULL,
	`encrypted` integer DEFAULT true NOT NULL,
	`label` text,
	`client_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_access_keys_owner_network` ON `access_keys` (`owner_fast_address`,`network`);
