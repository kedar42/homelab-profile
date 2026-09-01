import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/sqlite-schema.ts",
  out: "./drizzle-sqlite",
  dbCredentials: {
    url: process.env.SQLITE_DATABASE_PATH ?? "./data/profile.sqlite",
  },
  strict: true,
  verbose: true,
});
