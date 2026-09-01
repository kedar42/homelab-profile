import { resolve } from "node:path";

export type DatabaseConfig =
  | { driver: "sqlite"; path: string }
  | { driver: "postgres"; url: string };

export function loadDatabaseConfig(
  env: Record<string, string | undefined> = process.env,
): DatabaseConfig {
  const driver = env.DATABASE_DRIVER?.trim().toLowerCase() || "sqlite";
  if (driver === "sqlite") {
    return {
      driver,
      path: resolve(env.SQLITE_DATABASE_PATH?.trim() || "./data/profile.sqlite"),
    };
  }
  if (driver === "postgres") {
    const url = env.DATABASE_URL?.trim();
    if (!url) throw new Error("DATABASE_URL is required when DATABASE_DRIVER=postgres");
    return { driver, url };
  }
  throw new Error("DATABASE_DRIVER must be sqlite or postgres");
}

export function assertProductionDatabase(
  config: DatabaseConfig,
): asserts config is Extract<DatabaseConfig, { driver: "postgres" }> {
  if (config.driver !== "postgres") {
    throw new Error("Production requires DATABASE_DRIVER=postgres");
  }
}
