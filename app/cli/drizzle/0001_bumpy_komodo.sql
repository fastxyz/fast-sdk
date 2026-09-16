-- Migrate accounts to tagged-union (single | multisig).
-- SQLite cannot DROP NOT NULL or ADD CHECK via ALTER TABLE; rebuild via temp table.
CREATE TABLE `accounts_new` (
	`name` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL DEFAULT 'single',
	`fast_address` text NOT NULL,
	`evm_address` text,
	`encrypted_key` blob,
	`encrypted` integer,
	`multisig_config` text,
	`is_default` integer NOT NULL DEFAULT 0,
	`created_at` text NOT NULL,
	CONSTRAINT `accounts_kind_payload_check` CHECK (
		(kind = 'single' AND evm_address IS NOT NULL AND encrypted_key IS NOT NULL AND encrypted IS NOT NULL AND multisig_config IS NULL) OR
		(kind = 'multisig' AND evm_address IS NULL AND encrypted_key IS NULL AND encrypted IS NULL AND multisig_config IS NOT NULL)
	)
);
--> statement-breakpoint
INSERT INTO `accounts_new`
	(name, kind, fast_address, evm_address, encrypted_key, encrypted, multisig_config, is_default, created_at)
SELECT
	name, 'single', fast_address, evm_address, encrypted_key, encrypted, NULL, is_default, created_at
FROM `accounts`;
--> statement-breakpoint
DROP TABLE `accounts`;
--> statement-breakpoint
ALTER TABLE `accounts_new` RENAME TO `accounts`;
