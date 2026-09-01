import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const avatars = sqliteTable("avatars", {
  subject: text("subject").primaryKey(),
  publicId: text("public_id").notNull().unique(),
  filename: text("filename").notNull(),
  version: text("version").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const sessions = sqliteTable(
  "sessions",
  {
    idHash: text("id_hash").primaryKey(),
    subject: text("subject").notNull(),
    username: text("username").notNull(),
    displayName: text("display_name").notNull(),
    email: text("email").notNull(),
    emailVerified: integer("email_verified", { mode: "boolean" }),
    authenticationMethods: text("authentication_methods").notNull().default("[]"),
    pictureUrl: text("picture_url"),
    delegatedCredentials: text("delegated_credentials"),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [index("sessions_expires_at_idx").on(table.expiresAt)],
);

export const oidcTransactions = sqliteTable(
  "oidc_transactions",
  {
    idHash: text("id_hash").primaryKey(),
    state: text("state").notNull(),
    nonce: text("nonce").notNull(),
    codeVerifier: text("code_verifier").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [index("oidc_transactions_expires_at_idx").on(table.expiresAt)],
);
