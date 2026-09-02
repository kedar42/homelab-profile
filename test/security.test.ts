import { describe, expect, test } from "bun:test";
import { csrfToken, hashToken, randomToken, validCsrfToken } from "../src/security";

describe("security helpers", () => {
  test("generates URL-safe random tokens", () => {
    const first = randomToken();
    const second = randomToken();

    expect(first).toHaveLength(43);
    expect(first).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(first).not.toBe(second);
  });

  test("hashes tokens with SHA-256", async () => {
    expect(await hashToken("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  test("binds CSRF tokens to both the secret and session", () => {
    const token = csrfToken("a-secure-cookie-secret-with-more-than-32-characters", "session-a");

    expect(
      validCsrfToken("a-secure-cookie-secret-with-more-than-32-characters", "session-a", token),
    ).toBe(true);
    expect(
      validCsrfToken("a-secure-cookie-secret-with-more-than-32-characters", "session-b", token),
    ).toBe(false);
    expect(
      validCsrfToken("a-different-cookie-secret-with-more-than-32-characters", "session-a", token),
    ).toBe(false);
  });
});
