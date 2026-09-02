import { createHmac, timingSafeEqual } from "node:crypto";

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
