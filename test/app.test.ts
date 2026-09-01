import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { createApp } from "../src/app";
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
    async deleteExpired() {},
    async close() {},
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

  test("builds public avatar URLs from an immutable public ID", async () => {
    const sessionId = "local-session-token";
    const expectedHash = await hashToken(sessionId);
    const publicId = "26c61c4e-ca21-4d74-969d-4dac5a4067c6";
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
            expiresAt: new Date(Date.now() + 60_000),
          };
        },
        async findAvatarBySubject() {
          return {
            subject: "user-123",
            publicId,
            filename: `subject-hash-${version}.webp`,
            version,
            updatedAt: new Date(),
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
      `https://profile.example.com/avatars/${publicId}?v=${version}`,
    );
  });

  test("returns the public ID actually persisted during a racing first upload", async () => {
    const avatarDir = await mkdtemp(join(tmpdir(), "profile-route-test-"));
    const sessionId = "local-session-token";
    const persistedPublicId = "78d9a3cb-ec8e-484d-9a87-a7eb65571e5c";
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
              expiresAt: new Date(Date.now() + 60_000),
            };
          },
          async upsertAvatar(record) {
            return { ...record, publicId: persistedPublicId };
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
      expect((await response.json()).avatarUrl).toContain(`/avatars/${persistedPublicId}?v=`);
    } finally {
      await rm(avatarDir, { recursive: true, force: true });
    }
  });
});
