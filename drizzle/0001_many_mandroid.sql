ALTER TABLE "sessions" ADD COLUMN "email_verified" boolean;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "authentication_methods" text DEFAULT '[]' NOT NULL;