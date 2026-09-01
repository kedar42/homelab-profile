import { SQL } from "bun";
import { and, eq, gt, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sql";
import {
  type AvatarRecord,
  avatars,
  type OidcTransactionRecord,
  oidcTransactions,
  type SessionRecord,
  sessions,
} from "./schema";

export interface ProfileRepository {
  ping(): Promise<void>;
  createSession(record: SessionRecord): Promise<void>;
  findSession(idHash: string, now?: Date): Promise<SessionRecord | null>;
  deleteSession(idHash: string): Promise<void>;
  createOidcTransaction(record: OidcTransactionRecord): Promise<void>;
  consumeOidcTransaction(idHash: string, now?: Date): Promise<OidcTransactionRecord | null>;
  findAvatarBySubject(subject: string): Promise<AvatarRecord | null>;
  findAvatarByPublicId(publicId: string): Promise<AvatarRecord | null>;
  upsertAvatar(record: AvatarRecord): Promise<AvatarRecord>;
  deleteExpired(now?: Date): Promise<void>;
  close(): Promise<void>;
}

export function createProfileRepository(databaseUrl: string): ProfileRepository {
  const client = new SQL(databaseUrl, { max: 10, idleTimeout: 30 });
  const db = drizzle({ client });

  return {
    async ping() {
      await client`select 1`;
    },

    async createSession(record) {
      await db.insert(sessions).values(record);
    },

    async findSession(idHash, now = new Date()) {
      const [record] = await db
        .select()
        .from(sessions)
        .where(and(eq(sessions.idHash, idHash), gt(sessions.expiresAt, now)))
        .limit(1);
      return record ?? null;
    },

    async deleteSession(idHash) {
      await db.delete(sessions).where(eq(sessions.idHash, idHash));
    },

    async createOidcTransaction(record) {
      await db.insert(oidcTransactions).values(record);
    },

    async consumeOidcTransaction(idHash, now = new Date()) {
      const [record] = await db
        .delete(oidcTransactions)
        .where(and(eq(oidcTransactions.idHash, idHash), gt(oidcTransactions.expiresAt, now)))
        .returning();
      return record ?? null;
    },

    async findAvatarBySubject(subject) {
      const [record] = await db.select().from(avatars).where(eq(avatars.subject, subject)).limit(1);
      return record ?? null;
    },

    async findAvatarByPublicId(publicId) {
      const [record] = await db
        .select()
        .from(avatars)
        .where(eq(avatars.publicId, publicId))
        .limit(1);
      return record ?? null;
    },

    async upsertAvatar(record) {
      const [stored] = await db
        .insert(avatars)
        .values(record)
        .onConflictDoUpdate({
          target: avatars.subject,
          set: {
            filename: record.filename,
            version: record.version,
            updatedAt: record.updatedAt,
          },
        })
        .returning();
      if (!stored) throw new Error("Avatar metadata was not persisted");
      return stored;
    },

    async deleteExpired(now = new Date()) {
      await db.delete(sessions).where(lt(sessions.expiresAt, now));
      await db.delete(oidcTransactions).where(lt(oidcTransactions.expiresAt, now));
    },

    async close() {
      await client.close();
    },
  };
}
