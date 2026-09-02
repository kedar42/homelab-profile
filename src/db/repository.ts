import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SQL } from "bun";
import type { DatabaseConfig } from "./config";

export interface AvatarRecord {
  subject: string;
  publicId: string;
  filename: string;
  version: string;
  updatedAt: Date;
  authentikLinkedAt: Date | null;
}

export interface SessionRecord {
  idHash: string;
  subject: string;
  username: string;
  displayName: string;
  email: string;
  emailVerified: boolean | null;
  authenticationMethods: string[];
  pictureUrl: string | null;
  authentikUserPk: number | null;
  expiresAt: Date;
}

export interface OidcTransactionRecord {
  idHash: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  expiresAt: Date;
}

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
  markAvatarLinked(subject: string, linkedAt: Date): Promise<void>;
  deleteAvatar(subject: string): Promise<void>;
  deleteExpired(now?: Date): Promise<void>;
  close(): Promise<void>;
}

interface AvatarRow {
  subject: string;
  public_id: string;
  filename: string;
  version: string;
  updated_at: Date | string;
  authentik_linked_at: Date | string | null;
}

interface SessionRow {
  id_hash: string;
  subject: string;
  username: string;
  display_name: string;
  email: string;
  email_verified: boolean | number | null;
  authentication_methods: string;
  picture_url: string | null;
  authentik_user_pk: number | null;
  expires_at: Date | string;
}

interface OidcTransactionRow {
  id_hash: string;
  state: string;
  nonce: string;
  code_verifier: string;
  expires_at: Date | string;
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function avatarRecord(row: AvatarRow): AvatarRecord {
  return {
    subject: row.subject,
    publicId: row.public_id,
    filename: row.filename,
    version: row.version,
    updatedAt: asDate(row.updated_at),
    authentikLinkedAt: row.authentik_linked_at ? asDate(row.authentik_linked_at) : null,
  };
}

function sessionRecord(row: SessionRow): SessionRecord {
  let authenticationMethods: string[] = [];
  try {
    const stored = JSON.parse(row.authentication_methods);
    if (Array.isArray(stored)) {
      authenticationMethods = stored.filter((value): value is string => typeof value === "string");
    }
  } catch {
    // Treat invalid legacy metadata as unavailable rather than failing the session.
  }
  return {
    idHash: row.id_hash,
    subject: row.subject,
    username: row.username,
    displayName: row.display_name,
    email: row.email,
    emailVerified:
      row.email_verified === null ? null : row.email_verified === true || row.email_verified === 1,
    authenticationMethods,
    pictureUrl: row.picture_url,
    authentikUserPk: row.authentik_user_pk,
    expiresAt: asDate(row.expires_at),
  };
}

function oidcTransactionRecord(row: OidcTransactionRow): OidcTransactionRecord {
  return {
    idHash: row.id_hash,
    state: row.state,
    nonce: row.nonce,
    codeVerifier: row.code_verifier,
    expiresAt: asDate(row.expires_at),
  };
}

function createClient(config: DatabaseConfig): { client: SQL; ready: Promise<void> } {
  if (config.driver === "postgres") {
    return {
      client: new SQL(config.url, { max: 10, idleTimeout: 30 }),
      ready: Promise.resolve(),
    };
  }

  mkdirSync(dirname(config.path), { recursive: true });
  const client = new SQL({ adapter: "sqlite", filename: config.path, strict: true });
  const ready = (async () => {
    await client.unsafe("PRAGMA journal_mode = WAL");
    await client.unsafe("PRAGMA busy_timeout = 5000");
  })();
  return { client, ready };
}

export function createProfileRepository(config: DatabaseConfig): ProfileRepository {
  const { client, ready } = createClient(config);

  async function query<T>(statement: string, values: unknown[] = []): Promise<T[]> {
    await ready;
    return await client.unsafe<T[]>(statement, values);
  }

  return {
    async ping() {
      await query("select 1");
    },
    async createSession(record) {
      await query(
        `insert into sessions
          (id_hash, subject, username, display_name, email, email_verified,
           authentication_methods, picture_url, authentik_user_pk, expires_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          record.idHash,
          record.subject,
          record.username,
          record.displayName,
          record.email,
          record.emailVerified,
          JSON.stringify(record.authenticationMethods),
          record.pictureUrl,
          record.authentikUserPk,
          record.expiresAt.toISOString(),
        ],
      );
    },
    async findSession(idHash, now = new Date()) {
      const [row] = await query<SessionRow>(
        `select id_hash, subject, username, display_name, email, email_verified,
                authentication_methods, picture_url, authentik_user_pk, expires_at
         from sessions where id_hash = $1 and expires_at > $2 limit 1`,
        [idHash, now.toISOString()],
      );
      return row ? sessionRecord(row) : null;
    },
    async deleteSession(idHash) {
      await query("delete from sessions where id_hash = $1", [idHash]);
    },
    async createOidcTransaction(record) {
      await query(
        `insert into oidc_transactions
          (id_hash, state, nonce, code_verifier, expires_at)
         values ($1, $2, $3, $4, $5)`,
        [
          record.idHash,
          record.state,
          record.nonce,
          record.codeVerifier,
          record.expiresAt.toISOString(),
        ],
      );
    },
    async consumeOidcTransaction(idHash, now = new Date()) {
      const [row] = await query<OidcTransactionRow>(
        `delete from oidc_transactions where id_hash = $1 and expires_at > $2
         returning id_hash, state, nonce, code_verifier, expires_at`,
        [idHash, now.toISOString()],
      );
      return row ? oidcTransactionRecord(row) : null;
    },
    async findAvatarBySubject(subject) {
      const [row] = await query<AvatarRow>(
        `select subject, public_id, filename, version, updated_at, authentik_linked_at
         from avatars where subject = $1 limit 1`,
        [subject],
      );
      return row ? avatarRecord(row) : null;
    },
    async findAvatarByPublicId(publicId) {
      const [row] = await query<AvatarRow>(
        `select subject, public_id, filename, version, updated_at, authentik_linked_at
         from avatars where public_id = $1 limit 1`,
        [publicId],
      );
      return row ? avatarRecord(row) : null;
    },
    async upsertAvatar(record) {
      const [row] = await query<AvatarRow>(
        `insert into avatars
          (subject, public_id, filename, version, updated_at, authentik_linked_at)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (subject) do update set
           filename = excluded.filename,
           version = excluded.version,
           updated_at = excluded.updated_at,
           authentik_linked_at = excluded.authentik_linked_at
         returning subject, public_id, filename, version, updated_at, authentik_linked_at`,
        [
          record.subject,
          record.publicId,
          record.filename,
          record.version,
          record.updatedAt.toISOString(),
          record.authentikLinkedAt?.toISOString() ?? null,
        ],
      );
      if (!row) throw new Error("Avatar metadata was not persisted");
      return avatarRecord(row);
    },
    async markAvatarLinked(subject, linkedAt) {
      await query("update avatars set authentik_linked_at = $1 where subject = $2", [
        linkedAt.toISOString(),
        subject,
      ]);
    },
    async deleteAvatar(subject) {
      await query("delete from avatars where subject = $1", [subject]);
    },
    async deleteExpired(now = new Date()) {
      const threshold = now.toISOString();
      await query("delete from sessions where expires_at < $1", [threshold]);
      await query("delete from oidc_transactions where expires_at < $1", [threshold]);
    },
    async close() {
      await ready.catch(() => undefined);
      await client.close();
    },
  };
}
