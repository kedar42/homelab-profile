import { readFile } from "node:fs/promises";

export const AUTHENTIK_OIDC_SCOPES = "openid profile email";

export class AuthentikAvatarServiceError extends Error {}

export function authentikUserPkClaim(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error("OIDC response did not contain a valid authentik_user_pk claim");
  }
  return value as number;
}

export interface AuthentikAvatarService {
  linkAvatar(authentikUserPk: number, avatarUrl: string): Promise<void>;
}

interface AuthentikAvatarServiceOptions {
  issuer: URL;
  tokenFile?: string;
  getToken?: () => Promise<string>;
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

function apiUrl(issuer: URL, path: string): URL {
  const marker = "/application/o/";
  const markerIndex = issuer.pathname.indexOf(marker);
  const prefix = markerIndex < 0 ? "" : issuer.pathname.slice(0, markerIndex);
  return new URL(`${prefix}/api/v3/${path.replace(/^\//, "")}`, issuer.origin);
}

function isAttributes(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function createAuthentikAvatarService({
  issuer,
  tokenFile,
  getToken,
  fetch: fetchRequest = fetch,
}: AuthentikAvatarServiceOptions): AuthentikAvatarService {
  const loadToken =
    getToken ??
    (async () => {
      if (!tokenFile) throw new AuthentikAvatarServiceError("Service credential is unavailable.");
      const token = (await readFile(tokenFile, "utf8")).trim();
      if (!token) throw new AuthentikAvatarServiceError("Service credential is empty.");
      return token;
    });

  async function apiRequest(url: URL, token: string, init?: RequestInit): Promise<Response> {
    const response = await fetchRequest(url, {
      ...init,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        ...init?.headers,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new AuthentikAvatarServiceError(
        `Authentik rejected the avatar link operation (${response.status}).`,
      );
    }
    return response;
  }

  return {
    async linkAvatar(authentikUserPk, avatarUrl) {
      if (!Number.isSafeInteger(authentikUserPk) || authentikUserPk <= 0) {
        throw new AuthentikAvatarServiceError("The verified Authentik user ID is invalid.");
      }
      const token = await loadToken();
      const userUrl = apiUrl(issuer, `core/users/${authentikUserPk}/`);
      userUrl.searchParams.set("include_groups", "false");
      userUrl.searchParams.set("include_roles", "false");
      const userResponse = await apiRequest(userUrl, token);
      const user: unknown = await userResponse.json();
      if (
        !user ||
        typeof user !== "object" ||
        !("pk" in user) ||
        user.pk !== authentikUserPk ||
        !("attributes" in user) ||
        !isAttributes(user.attributes)
      ) {
        throw new AuthentikAvatarServiceError("Authentik returned an invalid user record.");
      }

      await apiRequest(apiUrl(issuer, `core/users/${authentikUserPk}/`), token, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          attributes: {
            ...user.attributes,
            avatar: avatarUrl,
          },
        }),
      });
    },
  };
}
