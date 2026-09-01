import { resolve } from "node:path";

export interface AppConfig {
  appUrl: URL;
  port: number;
  avatarDir: string;
  maxUploadBytes: number;
  oidcIssuer: URL;
  oidcClientId: string;
  oidcClientSecret: string;
  cookieSecret: string;
  sessionTtlDays: number;
  secureCookies: boolean;
}

function required(env: Record<string, string | undefined>, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

function positiveInteger(value: string | undefined, fallback: number, key: string): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return parsed;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const appUrl = new URL(required(env, "APP_URL"));
  const oidcIssuer = new URL(required(env, "OIDC_ISSUER"));
  const cookieSecret = required(env, "COOKIE_SECRET");

  if (cookieSecret.length < 32) {
    throw new Error("COOKIE_SECRET must contain at least 32 characters");
  }
  if (appUrl.protocol !== "http:" && appUrl.protocol !== "https:") {
    throw new Error("APP_URL must use HTTP or HTTPS");
  }
  if (appUrl.pathname !== "/" || appUrl.search || appUrl.hash) {
    throw new Error("APP_URL must be an origin without a path");
  }

  return {
    appUrl,
    port: positiveInteger(env.PORT, 3000, "PORT"),
    avatarDir: resolve(env.AVATAR_DIR?.trim() || "./data/avatars"),
    maxUploadBytes: positiveInteger(env.MAX_UPLOAD_BYTES, 5 * 1024 * 1024, "MAX_UPLOAD_BYTES"),
    oidcIssuer,
    oidcClientId: required(env, "OIDC_CLIENT_ID"),
    oidcClientSecret: required(env, "OIDC_CLIENT_SECRET"),
    cookieSecret,
    sessionTtlDays: positiveInteger(env.SESSION_TTL_DAYS, 7, "SESSION_TTL_DAYS"),
    secureCookies: appUrl.protocol === "https:",
  };
}
