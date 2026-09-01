import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const avatars = pgTable("avatars", {
  subject: text("subject").primaryKey(),
  publicId: uuid("public_id").defaultRandom().notNull().unique(),
  filename: text("filename").notNull(),
  version: uuid("version").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    idHash: text("id_hash").primaryKey(),
    subject: text("subject").notNull(),
    username: text("username").notNull(),
    displayName: text("display_name").notNull(),
    email: text("email").notNull(),
    pictureUrl: text("picture_url"),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [index("sessions_expires_at_idx").on(table.expiresAt)],
);

export const oidcTransactions = pgTable(
  "oidc_transactions",
  {
    idHash: text("id_hash").primaryKey(),
    state: text("state").notNull(),
    nonce: text("nonce").notNull(),
    codeVerifier: text("code_verifier").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [index("oidc_transactions_expires_at_idx").on(table.expiresAt)],
);

export type AvatarRecord = typeof avatars.$inferSelect;
export type SessionRecord = typeof sessions.$inferSelect;
export type OidcTransactionRecord = typeof oidcTransactions.$inferSelect;
