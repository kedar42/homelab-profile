import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config";

const validEnv = {
  APP_URL: "http://localhost:5173",
  DATABASE_URL: "postgresql://profile:profile@localhost:5432/profile",
  OIDC_ISSUER: "https://auth.example.com/application/o/profile/",
  OIDC_CLIENT_ID: "profile",
  OIDC_CLIENT_SECRET: "client-secret",
  COOKIE_SECRET: "a-secure-cookie-secret-with-more-than-32-characters",
};

describe("loadConfig", () => {
  test("loads defaults and derives cookie security from the public origin", () => {
    const config = loadConfig(validEnv);

    expect(config.appUrl.href).toBe("http://localhost:5173/");
    expect(config.port).toBe(3000);
    expect(config.maxUploadBytes).toBe(5 * 1024 * 1024);
    expect(config.sessionTtlDays).toBe(7);
    expect(config.secureCookies).toBe(false);
    expect(config.avatarDir.endsWith("/data/avatars")).toBe(true);
  });

  test("uses secure cookies for HTTPS origins", () => {
    const config = loadConfig({ ...validEnv, APP_URL: "https://profile.example.com" });
    expect(config.secureCookies).toBe(true);
  });

  test("rejects origins with a path", () => {
    expect(() =>
      loadConfig({ ...validEnv, APP_URL: "https://profile.example.com/profile" }),
    ).toThrow("APP_URL must be an origin without a path");
    expect(() =>
      loadConfig({ ...validEnv, APP_URL: "https://profile.example.com?preview=true" }),
    ).toThrow("APP_URL must be an origin without a path");
  });

  test("rejects non-HTTP public origins", () => {
    expect(() => loadConfig({ ...validEnv, APP_URL: "file:///tmp/profile" })).toThrow(
      "APP_URL must use HTTP or HTTPS",
    );
  });

  test("rejects weak cookie secrets and invalid positive integers", () => {
    expect(() => loadConfig({ ...validEnv, COOKIE_SECRET: "too-short" })).toThrow(
      "COOKIE_SECRET must contain at least 32 characters",
    );
    expect(() => loadConfig({ ...validEnv, PORT: "0" })).toThrow("PORT must be a positive integer");
  });
});
