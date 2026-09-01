export interface DevelopmentIdentity {
  subject: string;
  username: string;
  displayName: string;
  email: string;
  pictureUrl: string | null;
}

function valueOrDefault(
  env: Record<string, string | undefined>,
  key: string,
  fallback: string,
): string {
  const value = env[key]?.trim() || fallback;
  if (value.length > 500) throw new Error(`${key} must contain at most 500 characters`);
  return value;
}

export function loadDevelopmentIdentity(
  env: Record<string, string | undefined> = process.env,
): DevelopmentIdentity | null {
  const enabled = env.DEV_AUTH_ENABLED?.trim().toLowerCase() || "false";
  if (enabled !== "true" && enabled !== "false") {
    throw new Error("DEV_AUTH_ENABLED must be true or false");
  }
  if (enabled === "false") return null;

  const rawPictureUrl = env.DEV_AUTH_PICTURE_URL?.trim();
  let pictureUrl: string | null = null;
  if (rawPictureUrl) {
    const parsed = new URL(rawPictureUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("DEV_AUTH_PICTURE_URL must use HTTP or HTTPS");
    }
    pictureUrl = parsed.href;
  }

  return {
    subject: valueOrDefault(env, "DEV_AUTH_SUBJECT", "local-developer"),
    username: valueOrDefault(env, "DEV_AUTH_USERNAME", "developer"),
    displayName: valueOrDefault(env, "DEV_AUTH_DISPLAY_NAME", "Local Developer"),
    email: valueOrDefault(env, "DEV_AUTH_EMAIL", "developer@localhost"),
    pictureUrl,
  };
}

export function assertDevelopmentAuthDisabled(
  env: Record<string, string | undefined> = process.env,
): void {
  if (loadDevelopmentIdentity(env)) {
    throw new Error(
      "DEV_AUTH_ENABLED is development-only. Disable it before starting the production server.",
    );
  }
}
