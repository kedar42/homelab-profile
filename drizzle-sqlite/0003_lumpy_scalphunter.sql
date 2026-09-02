ALTER TABLE `avatars` ADD `authentik_linked_at` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `authentik_user_pk` integer;--> statement-breakpoint
ALTER TABLE `sessions` DROP COLUMN `delegated_credentials`;