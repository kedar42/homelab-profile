ALTER TABLE `sessions` ADD `email_verified` integer;--> statement-breakpoint
ALTER TABLE `sessions` ADD `authentication_methods` text DEFAULT '[]' NOT NULL;