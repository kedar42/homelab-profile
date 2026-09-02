ALTER TABLE "avatars" ADD COLUMN "authentik_linked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "authentik_user_pk" integer;--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "delegated_credentials";