CREATE TABLE `avatars` (
	`subject` text PRIMARY KEY NOT NULL,
	`public_id` text NOT NULL,
	`filename` text NOT NULL,
	`version` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `avatars_public_id_unique` ON `avatars` (`public_id`);--> statement-breakpoint
CREATE TABLE `oidc_transactions` (
	`id_hash` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`nonce` text NOT NULL,
	`code_verifier` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `oidc_transactions_expires_at_idx` ON `oidc_transactions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id_hash` text PRIMARY KEY NOT NULL,
	`subject` text NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`email` text NOT NULL,
	`picture_url` text,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sessions_expires_at_idx` ON `sessions` (`expires_at`);