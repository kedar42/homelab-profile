import { createHmac, timingSafeEqual } from "node:crypto";
import { CompactEncrypt, compactDecrypt } from "jose";

export interface DelegatedCredentials {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number;
}

const encoder = new TextEncoder();

async function credentialEncryptionKey(secret: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      encoder.encode(`homelab-profile:delegated-oauth:v1:${secret}`),
    ),
  );
}

export function randomToken(bytes = 32): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return Buffer.from(value).toString("base64url");
}

export async function hashToken(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Buffer.from(digest).toString("hex");
}

export function csrfToken(secret: string, sessionId: string): string {
  return createHmac("sha256", secret).update(`avatar-upload:${sessionId}`).digest("base64url");
}

export function validCsrfToken(secret: string, sessionId: string, candidate: string): boolean {
  const expected = Buffer.from(csrfToken(secret, sessionId));
  const actual = Buffer.from(candidate);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function sealDelegatedCredentials(
  secret: string,
  credentials: DelegatedCredentials,
): Promise<string> {
  return new CompactEncrypt(encoder.encode(JSON.stringify(credentials)))
    .setProtectedHeader({ alg: "dir", enc: "A256GCM", typ: "profile-oauth-credentials+jwe" })
    .encrypt(await credentialEncryptionKey(secret));
}

export async function openDelegatedCredentials(
  secret: string,
  sealed: string,
): Promise<DelegatedCredentials> {
  const { plaintext, protectedHeader } = await compactDecrypt(
    sealed,
    await credentialEncryptionKey(secret),
  );
  if (protectedHeader.typ !== "profile-oauth-credentials+jwe") {
    throw new Error("Invalid delegated credential envelope");
  }
  const value: unknown = JSON.parse(new TextDecoder().decode(plaintext));
  if (
    !value ||
    typeof value !== "object" ||
    !("accessToken" in value) ||
    typeof value.accessToken !== "string" ||
    !("refreshToken" in value) ||
    typeof value.refreshToken !== "string" ||
    !("accessTokenExpiresAt" in value) ||
    typeof value.accessTokenExpiresAt !== "number" ||
    !Number.isFinite(value.accessTokenExpiresAt)
  ) {
    throw new Error("Invalid delegated credentials");
  }
  return {
    accessToken: value.accessToken,
    refreshToken: value.refreshToken,
    accessTokenExpiresAt: value.accessTokenExpiresAt,
  };
}
