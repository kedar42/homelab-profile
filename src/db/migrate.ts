import { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { SQL } from "bun";
import { drizzle as drizzlePostgres } from "drizzle-orm/bun-sql";
import { migrate as migratePostgres } from "drizzle-orm/bun-sql/migrator";
import { drizzle as drizzleSqlite } from "drizzle-orm/bun-sqlite";
import { migrate as migrateSqlite } from "drizzle-orm/bun-sqlite/migrator";
import { type DatabaseConfig, loadDatabaseConfig } from "./config";

const projectRoot = join(import.meta.dir, "..", "..");

export async function migrateDatabase(config: DatabaseConfig): Promise<void> {
  if (config.driver === "sqlite") {
    await mkdir(dirname(config.path), { recursive: true });
    const client = new Database(config.path, { create: true, strict: true });
    try {
      client.run("PRAGMA journal_mode = WAL");
      migrateSqlite(drizzleSqlite({ client }), {
        migrationsFolder: join(projectRoot, "drizzle-sqlite"),
      });
    } finally {
      client.close();
    }
    console.log(`Applied SQLite migrations to ${config.path}`);
    return;
  }

  const client = new SQL(config.url, { max: 1 });
  try {
    await migratePostgres(drizzlePostgres({ client }), {
      migrationsFolder: join(projectRoot, "drizzle"),
    });
  } finally {
    await client.close();
  }
  console.log("Applied PostgreSQL migrations");
}

if (import.meta.main) {
  await migrateDatabase(loadDatabaseConfig());
}
