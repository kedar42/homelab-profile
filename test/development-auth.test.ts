import { describe, expect, test } from "bun:test";
import {
  assertDevelopmentAuthDisabled,
  loadDevelopmentIdentity,
  withDevelopmentAuthDefaults,
} from "../src/development-auth";

describe("development authentication configuration", () => {
  test("is disabled by default and supplies explicit local defaults when enabled", () => {
    expect(loadDevelopmentIdentity({})).toBeNull();
    expect(loadDevelopmentIdentity({ DEV_AUTH_ENABLED: "true" })).toEqual({
      subject: "local-developer",
      username: "developer",
      displayName: "Local Developer",
      email: "developer@localhost",
      pictureUrl: null,
    });
  });

  test("loads configured claims and validates mode and picture URL", () => {
    expect(
      loadDevelopmentIdentity({
        DEV_AUTH_ENABLED: "true",
        DEV_AUTH_SUBJECT: "test-subject",
        DEV_AUTH_USERNAME: "test-user",
        DEV_AUTH_DISPLAY_NAME: "Test User",
        DEV_AUTH_EMAIL: "test@example.com",
        DEV_AUTH_PICTURE_URL: "https://images.example.com/test.png",
      }),
    ).toMatchObject({
      subject: "test-subject",
      username: "test-user",
      displayName: "Test User",
      email: "test@example.com",
      pictureUrl: "https://images.example.com/test.png",
    });
    expect(() => loadDevelopmentIdentity({ DEV_AUTH_ENABLED: "yes" })).toThrow(
      "DEV_AUTH_ENABLED must be true or false",
    );
    expect(() =>
      loadDevelopmentIdentity({
        DEV_AUTH_ENABLED: "true",
        DEV_AUTH_PICTURE_URL: "file:///tmp/avatar.png",
      }),
    ).toThrow("DEV_AUTH_PICTURE_URL must use HTTP or HTTPS");
  });

  test("production guard fails closed", () => {
    expect(() => assertDevelopmentAuthDisabled({ DEV_AUTH_ENABLED: "false" })).not.toThrow();
    expect(() => assertDevelopmentAuthDisabled({ DEV_AUTH_ENABLED: "true" })).toThrow(
      "DEV_AUTH_ENABLED is development-only",
    );
  });

  test("substitutes the cookie placeholder only for local authentication", () => {
    const identity = loadDevelopmentIdentity({ DEV_AUTH_ENABLED: "true" });
    const localEnvironment = withDevelopmentAuthDefaults({ COOKIE_SECRET: "replace-me" }, identity);

    expect(localEnvironment.COOKIE_SECRET).not.toBe("replace-me");
    expect(localEnvironment.COOKIE_SECRET?.length).toBeGreaterThanOrEqual(32);
    expect(withDevelopmentAuthDefaults({ COOKIE_SECRET: "replace-me" }, null).COOKIE_SECRET).toBe(
      "replace-me",
    );
    expect(
      withDevelopmentAuthDefaults(
        { COOKIE_SECRET: "an-explicit-cookie-secret-with-more-than-32-characters" },
        identity,
      ).COOKIE_SECRET,
    ).toBe("an-explicit-cookie-secret-with-more-than-32-characters");
  });
});
