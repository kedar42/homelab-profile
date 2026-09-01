# Homelab Profile

Homelab Profile is a self-service account page for a homelab. Users sign in with Authentik and grant the application delegated access to update their own Authentik profile. An uploaded picture is normalized and served at a stable opaque URL, which the application writes to the signed-in user's avatar attribute through Authentik's native OAuth flow. Authentik remains the profile authority and publishes the result through its standard OIDC `picture` claim. A lightweight development identity exercises the local session, upload, and storage flow without contacting Authentik.

The repository is a verified `0.1.0` bootstrap: dependencies are exactly pinned in `bun.lock`, SQLite and PostgreSQL have reviewed initial migrations, formatting and linting are enforced with Biome, and CI runs type checks, tests, a production build, and both Drizzle migration checks. Live Authentik and PostgreSQL integration still requires those external services.

> The framework is **Elysia**, not “Elysium.” The component library is **HeroUI v3**.

## Architecture

```mermaid
flowchart LR
    Browser[React + HeroUI client]
    Vite[Vite development server\n:5173]
    API[Elysia API on Bun\n:3000]
    Auth[Authentik OIDC provider]
    DevIdentity[Local development identity]
    DB[(SQLite local / PostgreSQL production)]
    Files[(Persistent avatar storage)]

    Browser -->|Eden Treaty| API
    Browser -. development assets .-> Vite
    Vite -->|/api /auth /avatars proxy| API
    API <-->|OIDC code flow + PKCE
    delegated user API| Auth
    Auth -->|native picture claim| API
    DevIdentity -. development entry only .-> API
    API <-->|One repository + Bun SQL| DB
    API -->|Sharp-normalized WebP| Files
    API -->|production assets| Browser
```

In development, Vite serves the browser client on port `5173` and proxies application routes to Elysia on port `3000`. In production, Vite builds into `client/dist`, and Elysia serves the built client and API from one origin. Production startup fails fast if the client build is missing.

### Components and responsibilities

| Layer | Choice | Responsibility |
| --- | --- | --- |
| Runtime and package manager | Bun 1.3 | Runs TypeScript, installs from `bun.lock`, supplies Bun SQL, file APIs, and the test runner. |
| HTTP server | Elysia 1.4 | Typed routes, validation, cookie schemas, lifecycle hooks, OpenAPI, and static serving. |
| API client | Eden Treaty | Infers browser API types from the exported Elysia application type without a generated client. |
| UI | React 19 + HeroUI v3 | Login and profile screens built from HeroUI components including `Avatar`, `Button`, `Card`, `Spinner`, and toasts. |
| Styling | Tailwind CSS 4 + HeroUI styles | Vite-native Tailwind integration, HeroUI tokens, and an application-specific stylesheet. |
| Authentication | Authentik + `openid-client` 6 | OIDC discovery and authorization-code flow with PKCE, state, and nonce. |
| Persistence | Bun SQL + SQLite/PostgreSQL + Drizzle Kit | One repository stores sessions, OIDC transactions, and avatar metadata. SQLite is the embedded local default; PostgreSQL is required in production. Drizzle owns dialect-specific schemas and migrations. |
| Image pipeline | Sharp | Bounded decode, orientation, square crop, resize, and WebP re-encoding. |
| Quality | Biome + TypeScript + Bun test | Formatting, linting, static types, route tests, configuration tests, and image tests. |

The dependency set was reviewed against current upstream documentation on 2026-09-01. It intentionally uses the stable Elysia 1.4 line; `elysia-rate-limit` is pinned to the latest compatible 4.x release rather than the plugin's Elysia 2-targeting major version.

## Request flows

### Sign-in

1. The client calls `GET /api/me`.
2. An unauthenticated response displays the sign-in screen.
3. `GET /login` discovers Authentik, creates PKCE/state/nonce values, and stores a hashed, ten-minute OIDC transaction in the configured database.
4. Authentik returns the authorization response to `GET /auth/callback`.
5. The callback atomically consumes the transaction, verifies the response, creates a hashed local session, and sets an HttpOnly cookie.
6. The browser is redirected only to `/`; arbitrary return URLs are not accepted.

In lightweight development mode, `GET /login` skips only the OIDC exchange. It creates the same hashed database session from the explicitly configured local identity, after which profile reads, CSRF protection, uploads, storage, and logout use the production code paths.

### Avatar upload

1. `GET /api/me` returns the authenticated profile, an HMAC-derived CSRF token, and the server's accepted MIME types and byte limit.
2. The client validates those advertised limits for immediate feedback; the server independently enforces them.
3. `POST /api/profile/avatar` checks the session, CSRF token, rate limit, declared MIME type, decoded media type, size, and decoded pixel count.
4. Sharp applies orientation, crops and resizes to `512 × 512`, and re-encodes to WebP.
5. The file is atomically renamed into `AVATAR_DIR`, then its metadata is upserted through the shared repository with one stable random public UUID.
6. The authenticated session's verified OIDC `sub` determines the only avatar the request can replace; the browser does not supply an owner identifier.
7. On every upload, the server uses the session's encrypted delegated token to resolve `GET /api/v3/core/users/me/`, then idempotently patches only that returned user's `attributes.avatar` URL.
8. `GET /avatars/:publicId` serves the current WebP. The opaque URL never changes; a private revalidation policy and version ETag refresh replacements without exposing the OIDC subject.
9. Authentik supplies the initials fallback before an avatar is configured. This service does not expose a fallback endpoint that can be used to probe OIDC subjects.

### Native Authentik integration

The application uses one authorization-code flow with PKCE, state, and nonce. It requests:

```text
openid profile email goauthentik.io/api offline_access
```

`goauthentik.io/api` delegates Authentik API access on behalf of the signed-in user; `offline_access` supplies a refresh token so that delegation remains usable for the local session lifetime. Both tokens stay on the server and are stored as an authenticated-encryption JWE. Logout attempts to revoke the delegated refresh token before deleting the local session.

Keep Authentik's built-in `openid`, `profile`, `email`, `goauthentik.io/api`, and `offline_access` scope mappings selected. Do not create a custom `picture` mapping: Authentik's maintained `profile` mapping already publishes `request.user.avatar`.

Authentik deployment configuration is intentionally outside this application's runtime authority. Before production, its administrator must configure the avatar source/fallback (for example `attributes.avatar,initials`), enable the two delegated scopes on this provider, use an authorization flow that presents the requested consent, and grant the normal user only the Authentik permission required to update their own record. The application never changes those settings, assigns Authentik permissions, accepts a target user ID from the browser, or uses an administrative/service-account token.

## Repository layout

```text
.
├── .github/workflows/ci.yml  # Locked install and verification gate
├── client/
│   ├── index.html            # Vite HTML entry
│   └── src/
│       ├── App.tsx           # HeroUI login/profile interface
│       ├── api.ts            # Eden Treaty client
│       ├── main.tsx          # React entry
│       └── styles.css        # Tailwind, HeroUI, and local styles
├── drizzle/                  # PostgreSQL migration and metadata
├── drizzle-sqlite/           # SQLite migration and metadata
├── src/
│   ├── app.ts                # Elysia routes and composition
│   ├── avatar.ts             # Image validation and normalization
│   ├── config.ts             # Environment parsing and validation
│   ├── dev.ts                # API-only development process entry
│   ├── index.ts              # Production process entry
│   ├── security.ts           # Tokens, hashing, and CSRF
│   └── db/
│       ├── config.ts         # SQLite/PostgreSQL selection
│       ├── migrate.ts        # Backend-selecting migration runner
│       ├── repository.ts     # Single portable Bun SQL repository
│       ├── schema.ts         # PostgreSQL migration schema
│       └── sqlite-schema.ts  # SQLite migration schema
├── test/                     # Bun unit and route tests
├── biome.json                # Formatter/linter policy
├── bun.lock                  # Reproducible dependency graph
├── drizzle.config.ts         # PostgreSQL Drizzle Kit config
├── drizzle-sqlite.config.ts  # SQLite Drizzle Kit config
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## Data model

- `sessions` stores hashed local session IDs, essential Authentik identity claims, encrypted delegated OAuth credentials, and expiry times.
- `oidc_transactions` stores hashed, single-use callback state with PKCE verifier, state, nonce, and expiry.
- `avatars` stores one current file per stable OIDC subject and a separate opaque public UUID. Filenames contain only a SHA-256-derived prefix.

Expired records are rejected during reads and pruned when a new login begins. PostgreSQL and SQLite migration histories live in `drizzle/` and `drizzle-sqlite/` respectively. Their table and column contracts match, while backend-specific DDL stays confined to these migration schemas.

## Local development

### Prerequisites

- Bun `1.3.14` or later in the Bun 1.x line
- An Authentik OAuth2/OIDC application only when testing real OIDC mode

Install exactly what is recorded in the lockfile:

```sh
bun ci
cp .env.example .env
bun run db:migrate
bun run dev
```

The services are then available at:

- Client: `http://localhost:5173`
- API: `http://localhost:3000`
- OpenAPI JSON: `http://localhost:3000/openapi/json`
- Liveness: `http://localhost:3000/health/live`
- Readiness: `http://localhost:3000/health/ready`

Register this exact development redirect URI in Authentik:

```text
http://localhost:5173/auth/callback
```

Vite proxies that callback to Elysia. In production, `APP_URL` must be the public HTTPS origin and the Authentik redirect URI must be `<APP_URL>/auth/callback`.

### Lightweight development authentication

The example environment enables local authentication by default:

```dotenv
DEV_AUTH_ENABLED=true
DEV_AUTH_SUBJECT=local-developer
DEV_AUTH_USERNAME=developer
DEV_AUTH_DISPLAY_NAME=Local Developer
DEV_AUTH_EMAIL=developer@localhost
```

Start the normal development servers and select **Use local developer**. No Authentik discovery, redirect, delegated API request, token exchange, mock identity-provider deployment, or database server occurs. Bun opens `./data/profile.sqlite`; sessions, CSRF, avatar metadata, migrations, and storage still exercise the real repository contract.

When local authentication is enabled, `src/dev.ts` replaces an absent or unchanged `COOKIE_SECRET=replace-me` value with a built-in development-only secret. An explicitly configured secret is always preserved. Real OIDC mode and production still reject the placeholder.

The bypass is wired only by `src/dev.ts`. `bun run start` calls a fail-closed guard and exits if `DEV_AUTH_ENABLED=true`. Set it to `false` to exercise the real Authentik flow during development.

### Configuration

| Variable | Meaning | Example/default |
| --- | --- | --- |
| `APP_URL` | Browser-visible HTTP(S) origin, with no path/query/fragment | `http://localhost:5173` |
| `PORT` | Elysia listen port | `3000` |
| `DATABASE_DRIVER` | `sqlite` locally or `postgres` explicitly | `sqlite` |
| `SQLITE_DATABASE_PATH` | Embedded SQLite file | `./data/profile.sqlite` |
| `DATABASE_URL` | Required only with the PostgreSQL driver | unset locally |
| `AVATAR_DIR` | Persistent avatar directory | `./data/avatars` |
| `MAX_UPLOAD_BYTES` | Maximum source upload size | `5242880` |
| `DEV_AUTH_ENABLED` | Use a local identity through the development entry only | `true` in `.env.example` |
| `DEV_AUTH_SUBJECT` | Stable local OIDC-like subject | `local-developer` |
| `DEV_AUTH_USERNAME` | Local username | `developer` |
| `DEV_AUTH_DISPLAY_NAME` | Local display name | `Local Developer` |
| `DEV_AUTH_EMAIL` | Local email claim | `developer@localhost` |
| `DEV_AUTH_PICTURE_URL` | Optional HTTP(S) fallback picture | unset |
| `OIDC_ISSUER` | Authentik per-provider issuer, including trailing slash | required |
| `OIDC_CLIENT_ID` | Authentik client ID | required |
| `OIDC_CLIENT_SECRET` | Authentik client secret | required |
| `COOKIE_SECRET` | High-entropy secret; the placeholder is substituted only in local-auth development | required for OIDC/production |
| `SESSION_TTL_DAYS` | Local session lifetime | `7` |

The OIDC configuration assumes Authentik's recommended per-provider issuer mode (`https://auth.example.com/application/o/<slug>/`). Authentik's global issuer mode needs separate issuer and discovery URLs and is not supported by this single `OIDC_ISSUER` setting.

`Secure` cookies are enabled automatically when `APP_URL` uses HTTPS. Generate the cookie secret with `openssl rand -base64 48` or an equivalent cryptographically secure secret generator.

## Commands

| Command | Purpose |
| --- | --- |
| `bun run dev` | Run API watch mode and Vite together. |
| `bun run dev:api` | Run only the Elysia API in watch mode. |
| `bun run dev:web` | Run only Vite. |
| `bun run format` | Format supported files with Biome. |
| `bun run lint` | Run Biome lint rules. |
| `bun run quality` | Check formatting, linting, and import organization. |
| `bun run typecheck` | Type-check without emitting. |
| `bun test` | Run the Bun test suite. |
| `bun run build` | Build `client/dist`. |
| `bun run check` | Run quality, types, tests, and the production build. |
| `bun run db:generate` | Generate both PostgreSQL and SQLite SQL after an intentional schema change. |
| `bun run db:generate:postgres` | Generate only the PostgreSQL migration history. |
| `bun run db:generate:sqlite` | Generate only the SQLite migration history. |
| `bun run db:migrate` | Apply migrations selected by `DATABASE_DRIVER`. |
| `bun run db:check` | Check both generated migration histories for collisions. |

Schema changes follow Drizzle's code-first `generate` → review SQL → `migrate` workflow. Do not use `db:push` for shared or production environments.

## Production

```sh
bun ci
bun run check
export DATABASE_DRIVER=postgres
export DATABASE_URL=postgresql://profile:profile@database:5432/profile
export DEV_AUTH_ENABLED=false
bun run db:migrate
bun run start
```

Run the migration as an explicit release step before starting the new application version. Put `AVATAR_DIR` on persistent storage and back it up consistently with PostgreSQL. Run behind an HTTPS reverse proxy, forward the real client address only through trusted proxy configuration, and keep application and Authentik clocks synchronized.

## Security baseline

- OIDC authorization-code flow with PKCE, state, nonce, and one-time transactions.
- Authentik API mutation uses access granted by the signed-in user through the same OAuth flow; no administrative credential is configured.
- Delegated access and refresh tokens are JWE-encrypted at rest and the refresh token is revoked on logout when Authentik is available.
- Development authentication is injected only by the development process entry; production fails closed when its flag is enabled.
- Random session and transaction tokens; only SHA-256 hashes are stored.
- HttpOnly, SameSite=Lax cookies; `Secure` over HTTPS.
- Session-bound HMAC CSRF tokens for avatar mutation.
- Elysia schema validation and a maintained rate-limit plugin instead of local parsing/limiter implementations; authenticated upload buckets use a hashed session key.
- Sharp decode limits and forced WebP re-encoding; original uploads are never served.
- Server-generated hashed filenames, stable random public IDs, private-cache ETags, indexing opt-out headers, and restrictive browser security headers.
- Upload ownership comes from the verified OIDC subject; the Authentik target comes only from its delegated `/users/me/` response.
- Exact dependency pins, a committed lockfile, automated checks, and read-only CI permissions.

## Remaining operational boundaries

- The upload/login limiter is in-memory and per process. Authenticated uploads key by hashed session; unauthenticated requests use the direct connection address. Multi-replica deployment needs a shared limiter, and trusted-proxy client-IP handling must match the deployment topology.
- Avatar files live on the local filesystem. Multiple replicas need shared storage or an object-store adapter.
- Simultaneous uploads for the same subject can leave a superseded file behind. Metadata remains correct, but production at scale should serialize replacements per subject or run an idempotent orphan cleanup job.
- The automated suite migrates and exercises a real SQLite file. A live PostgreSQL migration test and a complete Authentik consent/RBAC/API flow belong in environment-level integration tests.
- No container image is prescribed because storage, proxy, and migration orchestration are deployment-specific. The documented Bun release sequence is the supported runtime contract.

## Upstream references

- [Bun install and lockfiles](https://bun.sh/docs/pm/cli/install)
- [Elysia cookies](https://elysiajs.com/patterns/cookie)
- [Elysia Static plugin](https://elysiajs.com/plugins/static)
- [Elysia OpenAPI plugin](https://elysiajs.com/plugins/openapi)
- [Eden Treaty](https://elysiajs.com/eden/overview)
- [HeroUI React quick start](https://heroui.com/docs/react/getting-started/quick-start)
- [Tailwind CSS with Vite](https://tailwindcss.com/docs/installation/using-vite)
- [Drizzle Kit migrations](https://orm.drizzle.team/docs/kit-overview)
- [Drizzle with Bun SQLite](https://orm.drizzle.team/docs/get-started/bun-sqlite-new)
- [Bun SQLite](https://bun.sh/docs/runtime/sqlite)
- [`openid-client` API](https://github.com/panva/openid-client/blob/main/docs/README.md)
- [Authentik OAuth2/OIDC provider](https://docs.goauthentik.io/add-secure-apps/providers/oauth2)
- [Authentik property mappings](https://docs.goauthentik.io/add-secure-apps/providers/property-mappings/)
- [Authentik avatar settings](https://docs.goauthentik.io/sys-mgmt/settings/)
- [Authentik user properties](https://docs.goauthentik.io/users-sources/user/user_ref)
- [Sharp documentation](https://sharp.pixelplumbing.com/)
- [Biome configuration](https://biomejs.dev/reference/configuration/)
