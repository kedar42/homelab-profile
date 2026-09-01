import { describe, expect, test } from "bun:test";
import {
  AUTHENTIK_DELEGATED_SCOPES,
  AuthentikUserApiError,
  createAuthentikUserApi,
} from "../src/authentik";

describe("delegated Authentik user API", () => {
  test("uses the signed-in user's token and patches only that user's avatar attribute", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const api = createAuthentikUserApi({
      issuer: new URL("https://auth.example.com/sso/application/o/profile/"),
      async getConfiguration() {
        throw new Error("refresh should not be needed");
      },
      async fetch(input, init = {}) {
        const url = input.toString();
        requests.push({ url, init });
        if (url.endsWith("/core/users/me/")) {
          return Response.json({ user: { pk: 42 } });
        }
        return new Response(null, { status: 204 });
      },
    });
    const credentials = {
      accessToken: "delegated-access-token",
      refreshToken: "delegated-refresh-token",
      accessTokenExpiresAt: Date.now() + 60_000,
    };

    expect(
      await api.setOwnAvatar(
        credentials,
        "https://profile.example.com/avatars/26c61c4e-ca21-4d74-969d-4dac5a4067c6",
      ),
    ).toEqual(credentials);
    expect(requests.map(({ url }) => url)).toEqual([
      "https://auth.example.com/sso/api/v3/core/users/me/",
      "https://auth.example.com/sso/api/v3/core/users/42/",
    ]);
    expect(requests[0]?.init.headers).toMatchObject({
      authorization: "Bearer delegated-access-token",
    });
    expect(requests[1]?.init.method).toBe("PATCH");
    expect(JSON.parse(String(requests[1]?.init.body))).toEqual({
      attributes: {
        avatar: "https://profile.example.com/avatars/26c61c4e-ca21-4d74-969d-4dac5a4067c6",
      },
    });
  });

  test("requests only standard identity and native delegated Authentik scopes", () => {
    expect(AUTHENTIK_DELEGATED_SCOPES).toBe(
      "openid profile email goauthentik.io/api offline_access",
    );
  });

  test("fails closed when delegated access cannot resolve the signed-in user", async () => {
    const api = createAuthentikUserApi({
      issuer: new URL("https://auth.example.com/application/o/profile/"),
      async getConfiguration() {
        throw new Error("refresh should not be needed");
      },
      async fetch() {
        return new Response(null, { status: 403 });
      },
    });

    await expect(
      api.setOwnAvatar(
        {
          accessToken: "delegated-access-token",
          refreshToken: "delegated-refresh-token",
          accessTokenExpiresAt: Date.now() + 60_000,
        },
        "https://profile.example.com/avatars/26c61c4e-ca21-4d74-969d-4dac5a4067c6",
      ),
    ).rejects.toBeInstanceOf(AuthentikUserApiError);
  });
});
