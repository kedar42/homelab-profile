import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { openapi } from "@elysia/openapi";
import { staticPlugin } from "@elysia/static";
import { Elysia, file, t } from "elysia";
import { rateLimit } from "elysia-rate-limit";
import * as oidc from "openid-client";
import { ACCEPTED_IMAGE_TYPES, AvatarUploadError, processAvatarUpload } from "./avatar";
import type { AppConfig } from "./config";
import type { ProfileRepository } from "./db/repository";
import { csrfToken, hashToken, randomToken, validCsrfToken } from "./security";

export interface AppDependencies {
  config: AppConfig;
  repository: ProfileRepository;
}

function cookieSettings(config: AppConfig) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: config.secureCookies,
    path: "/",
  };
}

async function currentSession(sessionId: string | undefined, repository: ProfileRepository) {
  if (!sessionId) return null;
  const session = await repository.findSession(await hashToken(sessionId));
  return session ? { id: sessionId, record: session } : null;
}

function publicAvatarUrl(config: AppConfig, publicId: string, version: string): string {
  const url = new URL(`/avatars/${publicId}`, config.appUrl);
  url.searchParams.set("v", version);
  return url.href;
}

const errorModel = t.Object({ error: t.String() });
const cookieModel = t.Cookie({
  profile_session: t.Optional(t.String()),
  profile_oidc: t.Optional(t.String()),
});
const profileModel = t.Object({
  user: t.Object({
    subject: t.String(),
    username: t.String(),
    displayName: t.String(),
    email: t.String(),
  }),
  avatarUrl: t.Nullable(t.String()),
  csrfToken: t.String(),
  maxUploadBytes: t.Number(),
  acceptedImageTypes: t.Array(t.String()),
});

export function createApp({ config, repository }: AppDependencies) {
  let oidcConfiguration: Promise<oidc.Configuration> | undefined;
  const getOidcConfiguration = () => {
    oidcConfiguration ??= oidc.discovery(
      config.oidcIssuer,
      config.oidcClientId,
      config.oidcClientSecret,
    );
    return oidcConfiguration;
  };

  return new Elysia({ name: "profile" })
    .use(
      openapi({
        provider: null,
        documentation: {
          info: {
            title: "Homelab Profile API",
            version: "0.1.0",
            description: "Authenticated account details and profile picture management.",
          },
        },
      }),
    )
    .use(
      rateLimit({
        duration: 60_000,
        max: (key) => (key.startsWith("/login:") ? 30 : 5),
        scoping: "scoped",
        generator: async (request, server) => {
          const pathname = new URL(request.url).pathname;
          const sessionId =
            pathname === "/api/profile/avatar" ? request.cookie?.profile_session?.value : undefined;
          const identity = sessionId
            ? `session-${await hashToken(sessionId)}`
            : `ip-${server?.requestIP(request)?.address ?? "unknown"}`;
          return `${pathname}:${identity}`;
        },
        skip: (request) => {
          const url = new URL(request.url);
          const isUpload = request.method === "POST" && url.pathname === "/api/profile/avatar";
          const isLogin = request.method === "GET" && url.pathname === "/login";
          return !isUpload && !isLogin;
        },
        errorResponse: new Response(
          JSON.stringify({
            error: "Too many requests. Wait a minute and try again.",
          }),
          {
            status: 429,
            headers: { "content-type": "application/json" },
          },
        ),
      }),
    )
    .onRequest(({ set }) => {
      set.headers["x-content-type-options"] = "nosniff";
      set.headers["referrer-policy"] = "strict-origin-when-cross-origin";
      set.headers["x-frame-options"] = "DENY";
      set.headers["permissions-policy"] = "camera=(), microphone=(), geolocation=()";
      set.headers["content-security-policy"] = [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' https: data: blob:",
        "connect-src 'self'",
        "font-src 'self' data:",
        "frame-ancestors 'none'",
        "form-action 'self'",
        "base-uri 'none'",
      ].join("; ");
    })
    .get("/health/live", () => ({ status: "ok" as const }), {
      detail: { tags: ["Health"], summary: "Process liveness" },
    })
    .get(
      "/health/ready",
      async ({ status }) => {
        try {
          await repository.ping();
          return { status: "ok" as const };
        } catch {
          return status(503, { status: "unavailable" as const });
        }
      },
      {
        detail: { tags: ["Health"], summary: "Database readiness" },
      },
    )
    .get(
      "/login",
      async ({ cookie: { profile_oidc }, status }) => {
        try {
          const configuration = await getOidcConfiguration();
          const transactionId = randomToken();
          const codeVerifier = oidc.randomPKCECodeVerifier();
          const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
          const state = oidc.randomState();
          const nonce = oidc.randomNonce();

          await repository.deleteExpired();
          await repository.createOidcTransaction({
            idHash: await hashToken(transactionId),
            state,
            nonce,
            codeVerifier,
            expiresAt: new Date(Date.now() + 10 * 60_000),
          });

          profile_oidc.value = transactionId;
          profile_oidc.set({
            ...cookieSettings(config),
            maxAge: 10 * 60,
          });

          const authorizationUrl = oidc.buildAuthorizationUrl(configuration, {
            redirect_uri: new URL("/auth/callback", config.appUrl).href,
            scope: "openid profile email",
            code_challenge: codeChallenge,
            code_challenge_method: "S256",
            state,
            nonce,
          });
          return Response.redirect(authorizationUrl.href, 302);
        } catch (error) {
          console.error("Unable to start OIDC login", error);
          return status(502, { error: "Single sign-on is temporarily unavailable." });
        }
      },
      {
        cookie: cookieModel,
        detail: { tags: ["Authentication"], summary: "Start Authentik sign-in" },
      },
    )
    .get(
      "/auth/callback",
      async ({ request, cookie: { profile_oidc, profile_session }, status }) => {
        const transactionId = profile_oidc.value;
        profile_oidc.remove();
        if (!transactionId) return status(400, { error: "The sign-in attempt has expired." });

        const transaction = await repository.consumeOidcTransaction(await hashToken(transactionId));
        if (!transaction)
          return status(400, { error: "The sign-in attempt is invalid or expired." });

        try {
          const configuration = await getOidcConfiguration();
          const callbackUrl = new URL("/auth/callback", config.appUrl);
          const incoming = new URL(request.url);
          incoming.searchParams.forEach((value, key) => {
            callbackUrl.searchParams.append(key, value);
          });

          const tokens = await oidc.authorizationCodeGrant(configuration, callbackUrl, {
            pkceCodeVerifier: transaction.codeVerifier,
            expectedState: transaction.state,
            expectedNonce: transaction.nonce,
            idTokenExpected: true,
          });
          const claims = tokens.claims();
          if (!claims?.sub) throw new Error("OIDC response did not contain a subject");

          const emailUsername =
            typeof claims.email === "string" ? claims.email.split("@", 1)[0] : undefined;
          const username =
            typeof claims.preferred_username === "string"
              ? claims.preferred_username
              : emailUsername || claims.sub;
          const displayName =
            typeof claims.name === "string" && claims.name.trim() ? claims.name : username;
          const email = typeof claims.email === "string" ? claims.email : "Not provided";
          const pictureUrl = typeof claims.picture === "string" ? claims.picture : null;
          const sessionId = randomToken();
          const expiresAt = new Date(Date.now() + config.sessionTtlDays * 24 * 60 * 60_000);

          await repository.createSession({
            idHash: await hashToken(sessionId),
            subject: claims.sub,
            username,
            displayName,
            email,
            pictureUrl,
            expiresAt,
          });
          profile_session.value = sessionId;
          profile_session.set({
            ...cookieSettings(config),
            maxAge: config.sessionTtlDays * 24 * 60 * 60,
          });

          return Response.redirect(new URL("/", config.appUrl).href, 303);
        } catch (error) {
          console.error("OIDC callback failed", error);
          return status(400, { error: "We could not complete your sign-in. Please try again." });
        }
      },
      {
        cookie: cookieModel,
        detail: { tags: ["Authentication"], summary: "Complete Authentik sign-in" },
      },
    )
    .group("/api", (api) =>
      api
        .get(
          "/me",
          async ({ cookie: { profile_session }, status }) => {
            const session = await currentSession(profile_session.value, repository);
            if (!session) return status(401, { error: "Authentication required." });
            const avatar = await repository.findAvatarBySubject(session.record.subject);
            return {
              user: {
                subject: session.record.subject,
                username: session.record.username,
                displayName: session.record.displayName,
                email: session.record.email,
              },
              avatarUrl: avatar
                ? publicAvatarUrl(config, avatar.publicId, avatar.version)
                : session.record.pictureUrl,
              csrfToken: csrfToken(config.cookieSecret, session.id),
              maxUploadBytes: config.maxUploadBytes,
              acceptedImageTypes: [...ACCEPTED_IMAGE_TYPES],
            };
          },
          {
            cookie: cookieModel,
            response: { 200: profileModel, 401: errorModel },
            detail: { tags: ["Profile"], summary: "Get the signed-in profile" },
          },
        )
        .post(
          "/profile/avatar",
          async ({ cookie: { profile_session }, body, status }) => {
            const session = await currentSession(profile_session.value, repository);
            if (!session) return status(401, { error: "Authentication required." });
            if (!validCsrfToken(config.cookieSecret, session.id, body.csrfToken)) {
              return status(403, { error: "The form expired. Refresh the page and try again." });
            }
            const version = crypto.randomUUID();
            const previous = await repository.findAvatarBySubject(session.record.subject);
            let publicId = previous?.publicId ?? crypto.randomUUID();
            try {
              const filename = await processAvatarUpload(body.avatar, {
                avatarDir: config.avatarDir,
                maxUploadBytes: config.maxUploadBytes,
                subject: session.record.subject,
                version,
              });
              try {
                const stored = await repository.upsertAvatar({
                  subject: session.record.subject,
                  publicId,
                  filename,
                  version,
                  updatedAt: new Date(),
                });
                publicId = stored.publicId;
              } catch (error) {
                await unlink(join(config.avatarDir, filename)).catch(() => undefined);
                throw error;
              }
              if (previous?.filename && previous.filename !== filename) {
                await unlink(join(config.avatarDir, previous.filename)).catch(() => undefined);
              }
              return { avatarUrl: publicAvatarUrl(config, publicId, version) };
            } catch (error) {
              if (error instanceof AvatarUploadError) return status(422, { error: error.message });
              console.error("Avatar upload failed", error);
              return status(500, { error: "The image could not be saved. Please try again." });
            }
          },
          {
            cookie: cookieModel,
            body: t.Object({
              avatar: t.File({
                type: [...ACCEPTED_IMAGE_TYPES],
                maxSize: config.maxUploadBytes,
              }),
              csrfToken: t.String({ minLength: 20 }),
            }),
            response: {
              200: t.Object({ avatarUrl: t.String() }),
              401: errorModel,
              403: errorModel,
              422: errorModel,
              429: errorModel,
              500: errorModel,
            },
            detail: { tags: ["Profile"], summary: "Replace the signed-in user's profile picture" },
          },
        )
        .post(
          "/logout",
          async ({ cookie: { profile_session } }) => {
            const sessionId = profile_session.value;
            if (sessionId) await repository.deleteSession(await hashToken(sessionId));
            profile_session.remove();
            return { ok: true as const };
          },
          {
            cookie: cookieModel,
            response: { 200: t.Object({ ok: t.Literal(true) }) },
            detail: { tags: ["Authentication"], summary: "End the local session" },
          },
        ),
    )
    .get(
      "/avatars/:publicId",
      async ({ params, request, set, status }) => {
        const avatar = await repository.findAvatarByPublicId(params.publicId);
        if (!avatar || !/^[a-f0-9]{40}-[a-f0-9-]{36}\.webp$/.test(avatar.filename)) {
          return status(404, { error: "Profile picture not found." });
        }
        const file = Bun.file(join(config.avatarDir, avatar.filename));
        if (!(await file.exists())) return status(404, { error: "Profile picture not found." });
        const etag = `"${avatar.version}"`;
        set.headers["cache-control"] = "public, max-age=3600, stale-while-revalidate=86400";
        set.headers.etag = etag;
        if (request.headers.get("if-none-match") === etag) return status(304);
        set.headers["content-type"] = "image/webp";
        return file;
      },
      {
        params: t.Object({ publicId: t.String({ format: "uuid" }) }),
        detail: { tags: ["Avatars"], summary: "Public stable avatar URL for Authentik" },
      },
    );
}

export type App = ReturnType<typeof createApp>;

export async function addWebClient(app: App) {
  const clientRoot = join(import.meta.dir, "..", "client", "dist");
  if (!existsSync(join(clientRoot, "index.html"))) {
    throw new Error(
      "Missing client build. Run `bun run build` before starting the production server.",
    );
  }
  return app
    .use(staticPlugin({ assets: join(clientRoot, "assets"), prefix: "/assets" }))
    .get("/", file(join(clientRoot, "index.html")), {
      detail: { hide: true },
    });
}
