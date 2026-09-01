import * as oidc from "openid-client";
import type { DelegatedCredentials } from "./security";

const REQUIRED_SCOPES = "openid profile email goauthentik.io/api offline_access";

export class AuthentikUserApiError extends Error {}

export interface AuthentikUserApi {
  setOwnAvatar(credentials: DelegatedCredentials, avatarUrl: string): Promise<DelegatedCredentials>;
  revoke(credentials: DelegatedCredentials): Promise<void>;
}

interface AuthentikUserApiOptions {
  issuer: URL;
  getConfiguration(): Promise<oidc.Configuration>;
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  now?: () => number;
}

function apiUrl(issuer: URL, path: string): URL {
  const marker = "/application/o/";
  const markerIndex = issuer.pathname.indexOf(marker);
  const prefix = markerIndex < 0 ? "" : issuer.pathname.slice(0, markerIndex);
  return new URL(`${prefix}/api/v3/${path.replace(/^\//, "")}`, issuer.origin);
}

function tokenExpiry(
  tokens: oidc.TokenEndpointResponse & oidc.TokenEndpointResponseHelpers,
): number {
  const expiresIn = tokens.expiresIn();
  if (expiresIn === undefined) {
    throw new AuthentikUserApiError("Authentik did not report an access-token lifetime.");
  }
  return Date.now() + expiresIn * 1_000;
}

export function delegatedCredentialsFromTokens(
  tokens: oidc.TokenEndpointResponse & oidc.TokenEndpointResponseHelpers,
): DelegatedCredentials {
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new AuthentikUserApiError(
      "Authentik did not grant delegated API and offline access. Check the provider scopes.",
    );
  }
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    accessTokenExpiresAt: tokenExpiry(tokens),
  };
}

export function createAuthentikUserApi({
  issuer,
  getConfiguration,
  fetch: fetchRequest = fetch,
  now = Date.now,
}: AuthentikUserApiOptions): AuthentikUserApi {
  async function freshCredentials(
    credentials: DelegatedCredentials,
  ): Promise<DelegatedCredentials> {
    if (credentials.accessTokenExpiresAt > now() + 30_000) return credentials;
    const tokens = await oidc.refreshTokenGrant(await getConfiguration(), credentials.refreshToken);
    if (!tokens.access_token) {
      throw new AuthentikUserApiError("Authentik did not return a refreshed access token.");
    }
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? credentials.refreshToken,
      accessTokenExpiresAt: tokenExpiry(tokens),
    };
  }

  async function apiRequest(url: URL, accessToken: string, init?: RequestInit): Promise<Response> {
    const response = await fetchRequest(url, {
      ...init,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${accessToken}`,
        ...init?.headers,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new AuthentikUserApiError(
        `Authentik rejected the delegated profile update (${response.status}).`,
      );
    }
    return response;
  }

  return {
    async setOwnAvatar(credentials, avatarUrl) {
      const current = await freshCredentials(credentials);
      const me = await apiRequest(apiUrl(issuer, "core/users/me/"), current.accessToken);
      const payload: unknown = await me.json();
      const pk =
        payload &&
        typeof payload === "object" &&
        "user" in payload &&
        payload.user &&
        typeof payload.user === "object" &&
        "pk" in payload.user
          ? payload.user.pk
          : undefined;
      if (typeof pk !== "number" || !Number.isSafeInteger(pk) || pk <= 0) {
        throw new AuthentikUserApiError("Authentik did not identify the signed-in user.");
      }

      await apiRequest(apiUrl(issuer, `core/users/${pk}/`), current.accessToken, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ attributes: { avatar: avatarUrl } }),
      });
      return current;
    },
    async revoke(credentials) {
      await oidc.tokenRevocation(await getConfiguration(), credentials.refreshToken, {
        token_type_hint: "refresh_token",
      });
    },
  };
}

export const AUTHENTIK_DELEGATED_SCOPES = REQUIRED_SCOPES;
