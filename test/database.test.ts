import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertProductionDatabase, loadDatabaseConfig } from "../src/db/config";
import { migrateDatabase } from "../src/db/migrate";
import { createProfileRepository } from "../src/db/repository";

describe("database configuration", () => {
  test("defaults to an embedded SQLite database", () => {
    const config = loadDatabaseConfig({});
    expect(config.driver).toBe("sqlite");
    if (config.driver === "sqlite") expect(config.path.endsWith("/data/profile.sqlite")).toBe(true);
  });

  test("requires an explicit URL and driver for PostgreSQL production", () => {
    expect(() => loadDatabaseConfig({ DATABASE_DRIVER: "postgres" })).toThrow(
      "DATABASE_URL is required",
    );
    const postgres = loadDatabaseConfig({
      DATABASE_DRIVER: "postgres",
      DATABASE_URL: "postgresql://profile:profile@localhost/profile",
    });
    expect(() => assertProductionDatabase(postgres)).not.toThrow();
    expect(() => assertProductionDatabase(loadDatabaseConfig({}))).toThrow(
      "Production requires DATABASE_DRIVER=postgres",
    );
  });

  test("rejects unknown database drivers", () => {
    expect(() => loadDatabaseConfig({ DATABASE_DRIVER: "mysql" })).toThrow(
      "DATABASE_DRIVER must be sqlite or postgres",
    );
  });
});

describe("SQLite profile repository", () => {
  test("migrates a fresh file and implements the repository contract", async () => {
    const directory = await mkdtemp(join(tmpdir(), "profile-sqlite-test-"));
    const config = { driver: "sqlite" as const, path: join(directory, "profile.sqlite") };
    await migrateDatabase(config);
    const repository = createProfileRepository(config);
    const now = new Date();

    try {
      await repository.ping();
      await repository.createSession({
        idHash: "session-hash",
        subject: "subject-1",
        username: "developer",
        displayName: "Local Developer",
        email: "developer@localhost",
        pictureUrl: null,
        expiresAt: new Date(now.getTime() + 60_000),
      });
      expect(await repository.findSession("session-hash", now)).toMatchObject({
        subject: "subject-1",
        username: "developer",
      });

      await repository.createOidcTransaction({
        idHash: "transaction-hash",
        state: "state",
        nonce: "nonce",
        codeVerifier: "verifier",
        expiresAt: new Date(now.getTime() + 60_000),
      });
      expect(await repository.consumeOidcTransaction("transaction-hash", now)).toMatchObject({
        state: "state",
      });
      expect(await repository.consumeOidcTransaction("transaction-hash", now)).toBeNull();

      const firstAvatar = await repository.upsertAvatar({
        subject: "subject-1",
        publicId: "3f6bf3d8-069f-4e2d-9e52-ccf50b065f82",
        filename: "first.webp",
        version: "8e36fdcf-c920-4e15-bf42-5ca12f48a9f0",
        updatedAt: now,
      });
      const replacedAvatar = await repository.upsertAvatar({
        ...firstAvatar,
        publicId: "44de0ccd-b09e-46eb-adc0-6ba078e9852b",
        filename: "second.webp",
        version: "0147a8b1-0671-465a-b937-41069f2acb01",
        updatedAt: new Date(now.getTime() + 1_000),
      });
      expect(replacedAvatar.publicId).toBe(firstAvatar.publicId);
      expect((await repository.findAvatarBySubject("subject-1"))?.filename).toBe("second.webp");

      await repository.deleteSession("session-hash");
      expect(await repository.findSession("session-hash", now)).toBeNull();
    } finally {
      await repository.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
