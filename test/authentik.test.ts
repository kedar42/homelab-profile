import { describe, expect, test } from "bun:test";
import {
  AUTHENTIK_OIDC_SCOPES,
  type AuthentikAvatarService,
  AuthentikAvatarServiceError,
  authentikUserPkClaim,
  createAuthentikAvatarService,
} from "../src/authentik";

describe("Authentik avatar service", () => {
  test("fetches and merges existing attributes before linking an opaque avatar URL", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const service: AuthentikAvatarService = createAuthentikAvatarService({
      issuer: new URL("https://auth.example.com/sso/application/o/profile/"),
      async getToken() {
        return "service-account-token";
      },
      async fetch(input, init = {}) {
        const url = input.toString();
        requests.push({ url, init });
        if (init.method !== "PATCH") {
          return Response.json({
            pk: 42,
            attributes: {
              locale: "cs-CZ",
              preferences: { theme: "dark" },
            },
          });
        }
        return new Response(null, { status: 204 });
      },
    });

    await service.linkAvatar(
      42,
      "https://profile.example.com/avatars/26c61c4e-ca21-4d74-969d-4dac5a4067c6",
    );

    expect(requests.map(({ url }) => url)).toEqual([
      "https://auth.example.com/sso/api/v3/core/users/42/?include_groups=false&include_roles=false",
      "https://auth.example.com/sso/api/v3/core/users/42/",
    ]);
    expect(requests[0]?.init.headers).toMatchObject({
      authorization: "Bearer service-account-token",
    });
    expect(JSON.parse(String(requests[1]?.init.body))).toEqual({
      attributes: {
        locale: "cs-CZ",
        preferences: { theme: "dark" },
        avatar: "https://profile.example.com/avatars/26c61c4e-ca21-4d74-969d-4dac5a4067c6",
      },
    });
  });

  test("uses ordinary OIDC identity scopes only", () => {
    expect(AUTHENTIK_OIDC_SCOPES).toBe("openid profile email");
  });

  test("accepts only a positive integer from the verified ID-token claim", () => {
    expect(authentikUserPkClaim(42)).toBe(42);
    for (const value of [undefined, null, "42", 0, -1, 1.5]) {
      expect(() => authentikUserPkClaim(value)).toThrow("authentik_user_pk");
    }
  });

  test("fails closed when the fetched user does not match the signed claim", async () => {
    const service = createAuthentikAvatarService({
      issuer: new URL("https://auth.example.com/application/o/profile/"),
      async getToken() {
        return "service-account-token";
      },
      async fetch() {
        return Response.json({ pk: 99, attributes: {} });
      },
    });

    await expect(
      service.linkAvatar(
        42,
        "https://profile.example.com/avatars/26c61c4e-ca21-4d74-969d-4dac5a4067c6",
      ),
    ).rejects.toBeInstanceOf(AuthentikAvatarServiceError);
  });

  test("does not PATCH when existing attributes are invalid", async () => {
    let requests = 0;
    const service = createAuthentikAvatarService({
      issuer: new URL("https://auth.example.com/application/o/profile/"),
      async getToken() {
        return "service-account-token";
      },
      async fetch() {
        requests += 1;
        return Response.json({ pk: 42, attributes: null });
      },
    });

    await expect(
      service.linkAvatar(
        42,
        "https://profile.example.com/avatars/26c61c4e-ca21-4d74-969d-4dac5a4067c6",
      ),
    ).rejects.toBeInstanceOf(AuthentikAvatarServiceError);
    expect(requests).toBe(1);
  });
});
