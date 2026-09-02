import { boolean, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const avatars = pgTable("avatars", {
  subject: text("subject").primaryKey(),
  publicId: uuid("public_id").defaultRandom().notNull().unique(),
  filename: text("filename").notNull(),
  version: uuid("version").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  authentikLinkedAt: timestamp("authentik_linked_at", { withTimezone: true, mode: "date" }),
});

export const sessions = pgTable(
  "sessions",
  {
    idHash: text("id_hash").primaryKey(),
    subject: text("subject").notNull(),
    username: text("username").notNull(),
    displayName: text("display_name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified"),
    authenticationMethods: text("authentication_methods").notNull().default("[]"),
    pictureUrl: text("picture_url"),
    authentikUserPk: integer("authentik_user_pk"),
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
