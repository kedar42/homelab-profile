import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { createApp } from "../src/app";
import { type AuthentikAvatarService, AuthentikAvatarServiceError } from "../src/authentik";
import type { AppConfig } from "../src/config";
import type { ProfileRepository, SessionRecord } from "../src/db/repository";
import { csrfToken, hashToken } from "../src/security";

const config: AppConfig = {
  appUrl: new URL("https://profile.example.com"),
  port: 3000,
  avatarDir: "/tmp/profile-app-test-avatars",
  maxUploadBytes: 5 * 1024 * 1024,
  oidcIssuer: new URL("https://auth.example.com/application/o/profile/"),
  oidcClientId: "profile",
  oidcClientSecret: "client-secret",
  authentikServiceTokenFile: "/run/secrets/authentik_profile_token",
  cookieSecret: "a-secure-cookie-secret-with-more-than-32-characters",
  sessionTtlDays: 7,
  secureCookies: true,
};

function repository(overrides: Partial<ProfileRepository> = {}): ProfileRepository {
  return {
    async ping() {},
    async createSession() {},
    async findSession() {
      return null;
    },
    async deleteSession() {},
    async createOidcTransaction() {},
    async consumeOidcTransaction() {
      return null;
    },
    async findAvatarBySubject() {
      return null;
    },
    async findAvatarByPublicId() {
      return null;
    },
    async upsertAvatar(record) {
      return record;
    },
    async markAvatarLinked() {},
    async deleteAvatar() {},
    async deleteExpired() {},
    async close() {},
    ...overrides,
  };
}

function avatarService(overrides: Partial<AuthentikAvatarService> = {}): AuthentikAvatarService {
  return {
    async linkAvatar() {},
    ...overrides,
  };
}

describe("profile API", () => {
  test("reports liveness and applies security headers", async () => {
    const response = await createApp({ config, repository: repository() }).handle(
      new Request("https://profile.example.com/health/live"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
  });

  test("reports failed database readiness", async () => {
    const response = await createApp({
      config,
      repository: repository({
        async ping() {
          throw new Error("database unavailable");
        },
      }),
    }).handle(new Request("https://profile.example.com/health/ready"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
  });

  test("publishes the OpenAPI document without a CDN-backed UI", async () => {
    const app = createApp({ config, repository: repository() });
    const document = await app.handle(new Request("https://profile.example.com/openapi/json"));
    const ui = await app.handle(new Request("https://profile.example.com/openapi"));

    expect(document.status).toBe(200);
    expect(document.headers.get("content-type")).toContain("application/json");
    expect(ui.status).toBe(404);
  });

  test("reports OIDC mode by default", async () => {
    const response = await createApp({ config, repository: repository() }).handle(
      new Request("https://profile.example.com/api/auth/mode"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ mode: "oidc" });
  });

  test("creates a normal local session without contacting OIDC in development mode", async () => {
    let createdSession: SessionRecord | undefined;
    const response = await createApp({
      config,
      developmentIdentity: {
        subject: "local-subject",
        username: "developer",
        displayName: "Local Developer",
        email: "developer@localhost",
        emailVerified: true,
        authenticationMethods: [],
        pictureUrl: null,
        authentikUserPk: null,
      },
      repository: repository({
        async createSession(record) {
          createdSession = record;
        },
      }),
    }).handle(new Request("https://profile.example.com/login"));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://profile.example.com/");
    expect(response.headers.get("set-cookie")).toContain("profile_session=");
    expect(response.headers.get("set-cookie")).not.toContain("profile_oidc=");
    expect(createdSession).toMatchObject({
      subject: "local-subject",
      username: "developer",
      displayName: "Local Developer",
      email: "developer@localhost",
      pictureUrl: null,
      authentikUserPk: null,
    });
    expect(createdSession?.idHash).toMatch(/^[a-f0-9]{64}$/);
  });

  test("reports development mode when a local identity is injected", async () => {
    const response = await createApp({
      config,
      repository: repository(),
      developmentIdentity: {
        subject: "local-subject",
        username: "developer",
        displayName: "Local Developer",
        email: "developer@localhost",
        emailVerified: true,
        authenticationMethods: [],
        pictureUrl: null,
        authentikUserPk: null,
      },
    }).handle(new Request("https://profile.example.com/api/auth/mode"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ mode: "development" });
  });

  test("requires a session for the profile endpoint", async () => {
    const response = await createApp({ config, repository: repository() }).handle(
      new Request("https://profile.example.com/api/me"),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Authentication required." });
  });

  test("returns the signed-in profile through Elysia's cookie schema", async () => {
    const sessionId = "local-session-token";
    const expectedHash = await hashToken(sessionId);
    const response = await createApp({
      config,
      repository: repository({
        async findSession(idHash) {
          expect(idHash).toBe(expectedHash);
          return {
            idHash,
            subject: "user-123",
            username: "kedar",
            displayName: "Kedar",
            email: "kedar@example.com",
            emailVerified: true,
            authenticationMethods: ["pwd", "mfa"],
            pictureUrl: "https://auth.example.com/media/avatar.png",
            authentikUserPk: 42,
            expiresAt: new Date(Date.now() + 60_000),
          };
        },
      }),
    }).handle(
      new Request("https://profile.example.com/api/me", {
        headers: { cookie: `profile_session=${sessionId}` },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      user: {
        subject: "user-123",
        username: "kedar",
        displayName: "Kedar",
        email: "kedar@example.com",
      },
      avatarUrl: "https://auth.example.com/media/avatar.png",
      security: {
        emailVerified: true,
        authenticationMethods: ["pwd", "mfa"],
      },
      maxUploadBytes: 5 * 1024 * 1024,
      acceptedImageTypes: ["image/jpeg", "image/png", "image/webp", "image/avif"],
    });
  });

  test("builds the public avatar URL from its opaque stable ID", async () => {
    const sessionId = "local-session-token";
    const expectedHash = await hashToken(sessionId);
    const version = "5ed18376-cd88-4d58-ad3c-f3dbe7c49521";
    const response = await createApp({
      config,
      repository: repository({
        async findSession() {
          return {
            idHash: expectedHash,
            subject: "user-123",
            username: "renamed-user",
            displayName: "Kedar",
            email: "kedar@example.com",
            emailVerified: null,
            authenticationMethods: [],
            pictureUrl: null,
            authentikUserPk: 42,
            expiresAt: new Date(Date.now() + 60_000),
          };
        },
        async findAvatarBySubject() {
          return {
            subject: "user-123",
            publicId: "26c61c4e-ca21-4d74-969d-4dac5a4067c6",
            filename: `subject-hash-${version}.webp`,
            version,
            updatedAt: new Date(),
            authentikLinkedAt: new Date(),
          };
        },
      }),
    }).handle(
      new Request("https://profile.example.com/api/me", {
        headers: { cookie: `profile_session=${sessionId}` },
      }),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).avatarUrl).toBe(
      "https://profile.example.com/avatars/26c61c4e-ca21-4d74-969d-4dac5a4067c6",
    );
  });

  test("links a new opaque avatar URL using the signed user claim and backend service", async () => {
    const avatarDir = await mkdtemp(join(tmpdir(), "profile-route-test-"));
    const sessionId = "local-session-token";
    const image = await sharp({
      create: {
        width: 20,
        height: 20,
        channels: 3,
        background: { r: 30, g: 40, b: 50 },
      },
    })
      .png()
      .toBuffer();
    const body = new FormData();
    body.set("avatar", new File([image], "avatar.png", { type: "image/png" }));
    body.set("csrfToken", csrfToken(config.cookieSecret, sessionId));
    let publishedUrl: string | undefined;
    let storedAvatarPublicId: string | undefined;
    let linkedSubject: string | undefined;

    try {
      const response = await createApp({
        config: { ...config, avatarDir },
        authentikAvatarService: avatarService({
          async linkAvatar(userPk, avatarUrl) {
            expect(userPk).toBe(42);
            publishedUrl = avatarUrl;
          },
        }),
        repository: repository({
          async findSession(idHash) {
            return {
              idHash,
              subject: "user-123",
              username: "kedar",
              displayName: "Kedar",
              email: "kedar@example.com",
              emailVerified: null,
              authenticationMethods: [],
              pictureUrl: null,
              authentikUserPk: 42,
              expiresAt: new Date(Date.now() + 60_000),
            };
          },
          async upsertAvatar(record) {
            storedAvatarPublicId = record.publicId;
            return record;
          },
          async markAvatarLinked(subject) {
            linkedSubject = subject;
          },
        }),
      }).handle(
        new Request("https://profile.example.com/api/profile/avatar", {
          method: "POST",
          headers: { cookie: `profile_session=${sessionId}` },
          body,
        }),
      );

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.avatarUrl).toBe(`https://profile.example.com/avatars/${storedAvatarPublicId}`);
      expect(publishedUrl).toBe(result.avatarUrl);
      expect(storedAvatarPublicId).toMatch(/^[a-f0-9-]{36}$/);
      expect(linkedSubject).toBe("user-123");
    } finally {
      await rm(avatarDir, { recursive: true, force: true });
    }
  });

  test("reuses an already-linked URL without another Authentik mutation", async () => {
    const avatarDir = await mkdtemp(join(tmpdir(), "profile-route-replace-test-"));
    const sessionId = "local-session-token";
    const publicId = "26c61c4e-ca21-4d74-969d-4dac5a4067c6";
    const image = await sharp({
      create: {
        width: 20,
        height: 20,
        channels: 3,
        background: { r: 30, g: 40, b: 50 },
      },
    })
      .png()
      .toBuffer();
    const body = new FormData();
    body.set("avatar", new File([image], "avatar.png", { type: "image/png" }));
    body.set("csrfToken", csrfToken(config.cookieSecret, sessionId));

    try {
      const response = await createApp({
        config: { ...config, avatarDir },
        authentikAvatarService: avatarService({
          async linkAvatar() {
            throw new Error("already-linked replacements must not call Authentik");
          },
        }),
        repository: repository({
          async findSession(idHash) {
            return {
              idHash,
              subject: "user-123",
              username: "kedar",
              displayName: "Kedar",
              email: "kedar@example.com",
              emailVerified: null,
              authenticationMethods: [],
              pictureUrl: null,
              authentikUserPk: 42,
              expiresAt: new Date(Date.now() + 60_000),
            };
          },
          async findAvatarBySubject() {
            return {
              subject: "user-123",
              publicId,
              filename: `${"a".repeat(40)}-${crypto.randomUUID()}.webp`,
              version: crypto.randomUUID(),
              updatedAt: new Date(),
              authentikLinkedAt: new Date(),
            };
          },
        }),
      }).handle(
        new Request("https://profile.example.com/api/profile/avatar", {
          method: "POST",
          headers: { cookie: `profile_session=${sessionId}` },
          body,
        }),
      );

      expect(response.status).toBe(200);
      expect((await response.json()).avatarUrl).toBe(
        `https://profile.example.com/avatars/${publicId}`,
      );
    } finally {
      await rm(avatarDir, { recursive: true, force: true });
    }
  });

  test("rolls back a first upload when Authentik cannot link it", async () => {
    const avatarDir = await mkdtemp(join(tmpdir(), "profile-route-rollback-test-"));
    const sessionId = "local-session-token";
    const image = await sharp({
      create: {
        width: 20,
        height: 20,
        channels: 3,
        background: { r: 30, g: 40, b: 50 },
      },
    })
      .png()
      .toBuffer();
    const body = new FormData();
    body.set("avatar", new File([image], "avatar.png", { type: "image/png" }));
    body.set("csrfToken", csrfToken(config.cookieSecret, sessionId));
    let deletedSubject: string | undefined;

    try {
      const response = await createApp({
        config: { ...config, avatarDir },
        authentikAvatarService: avatarService({
          async linkAvatar() {
            throw new AuthentikAvatarServiceError("forbidden");
          },
        }),
        repository: repository({
          async findSession(idHash) {
            return {
              idHash,
              subject: "user-123",
              username: "kedar",
              displayName: "Kedar",
              email: "kedar@example.com",
              emailVerified: null,
              authenticationMethods: [],
              pictureUrl: null,
              authentikUserPk: 42,
              expiresAt: new Date(Date.now() + 60_000),
            };
          },
          async deleteAvatar(subject) {
            deletedSubject = subject;
          },
        }),
      }).handle(
        new Request("https://profile.example.com/api/profile/avatar", {
          method: "POST",
          headers: { cookie: `profile_session=${sessionId}` },
          body,
        }),
      );

      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({
        error: "Authentik could not link your profile picture. No change was saved.",
      });
      expect(deletedSubject).toBe("user-123");
      expect(await readdir(avatarDir)).toEqual([]);
    } finally {
      await rm(avatarDir, { recursive: true, force: true });
    }
  });

  test("deletes only the local session when the user signs out", async () => {
    const sessionId = "local-session-token";
    const idHash = await hashToken(sessionId);
    let deletedSession: string | undefined;
    const response = await createApp({
      config,
      repository: repository({
        async deleteSession(candidate) {
          deletedSession = candidate;
        },
      }),
    }).handle(
      new Request("https://profile.example.com/api/logout", {
        method: "POST",
        headers: { cookie: `profile_session=${sessionId}` },
      }),
    );

    expect(response.status).toBe(200);
    expect(deletedSession).toBe(idHash);
    expect(response.headers.get("set-cookie")).toContain("profile_session=");
  });

  test("leaves fallback rendering to Authentik when no opaque avatar exists", async () => {
    const app = createApp({ config, repository: repository() });
    const response = await app.handle(
      new Request("https://profile.example.com/avatars/26c61c4e-ca21-4d74-969d-4dac5a4067c6"),
    );

    expect(response.status).toBe(404);
  });

  test("serves and privately revalidates the uploaded WebP at its opaque URL", async () => {
    const avatarDir = await mkdtemp(join(tmpdir(), "profile-public-avatar-test-"));
    const version = "5ed18376-cd88-4d58-ad3c-f3dbe7c49521";
    const filename = `${"a".repeat(40)}-${version}.webp`;
    const image = await sharp({
      create: {
        width: 20,
        height: 20,
        channels: 3,
        background: { r: 74, g: 37, b: 92 },
      },
    })
      .webp()
      .toBuffer();

    try {
      await Bun.write(join(avatarDir, filename), image);
      const app = createApp({
        config: { ...config, avatarDir },
        repository: repository({
          async findAvatarByPublicId(publicId) {
            expect(publicId).toBe("26c61c4e-ca21-4d74-969d-4dac5a4067c6");
            return {
              subject: "user-123",
              publicId,
              filename,
              version,
              updatedAt: new Date(),
              authentikLinkedAt: new Date(),
            };
          },
        }),
      });

      const response = await app.handle(
        new Request("https://profile.example.com/avatars/26c61c4e-ca21-4d74-969d-4dac5a4067c6"),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("image/webp");
      expect(response.headers.get("cache-control")).toBe("private, no-cache");
      expect(response.headers.get("x-robots-tag")).toBe("noindex, noimageindex");
      expect(response.headers.get("etag")).toBe(`"${version}"`);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(image));

      const revalidated = await app.handle(
        new Request("https://profile.example.com/avatars/26c61c4e-ca21-4d74-969d-4dac5a4067c6", {
          headers: { "if-none-match": `"${version}"` },
        }),
      );
      expect(revalidated.status).toBe(304);
    } finally {
      await rm(avatarDir, { recursive: true, force: true });
    }
  });
});
