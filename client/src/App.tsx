import { ArrowRight, ArrowRightFromSquare, CircleInfo, Pencil, Person } from "@gravity-ui/icons";
import { Avatar, Button, Card, Spinner, toast } from "@heroui/react";
import { type ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

type ProfileResponse = NonNullable<Awaited<ReturnType<typeof api.api.me.get>>["data"]>;
type AuthenticationMode = NonNullable<
  Awaited<ReturnType<typeof api.api.auth.mode.get>>["data"]
>["mode"];

type LoadState =
  | { kind: "loading" }
  | { kind: "anonymous"; authenticationMode: AuthenticationMode }
  | { kind: "ready"; profile: ProfileResponse; authenticationMode: AuthenticationMode }
  | { kind: "error"; message: string };

function edenErrorMessage(error: { value: unknown } | null): string {
  if (error && typeof error.value === "object" && error.value && "error" in error.value) {
    const message = (error.value as { error?: unknown }).error;
    if (typeof message === "string") return message;
  }
  return "Something went wrong. Please try again.";
}

function Brand() {
  return (
    <a className="brand" href="/" aria-label="Profile home">
      <span className="brand-mark" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>
        id<span className="brand-separator">.</span>homelab
      </span>
    </a>
  );
}

function LoadingScreen() {
  return (
    <main className="center-screen" aria-live="polite">
      <Spinner size="lg" />
      <p>Loading your profile…</p>
    </main>
  );
}

function LoginScreen({ authenticationMode }: { authenticationMode: AuthenticationMode }) {
  const isDevelopment = authenticationMode === "development";
  return (
    <main className="login-page">
      <header className="site-header">
        <Brand />
      </header>
      <section className="login-content">
        <Card className="login-card" variant="secondary">
          <Card.Content className="login-card-content">
            <div className="login-avatar" aria-hidden="true">
              <Person />
            </div>
            <h1>Profile</h1>
            <p>Sign in to view your account and change your profile picture.</p>
            <Button
              className="login-button"
              size="lg"
              onPress={() => window.location.assign("/login")}
            >
              {isDevelopment ? "Continue as local developer" : "Continue with Authentik"}
              <ArrowRight />
            </Button>
          </Card.Content>
        </Card>
      </section>
    </main>
  );
}

function ProfileScreen({ initialProfile }: { initialProfile: ProfileResponse }) {
  const [profile, setProfile] = useState(initialProfile);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const chooseFile = useCallback(
    (nextFile?: File) => {
      if (!nextFile) return;
      const rejectFile = (message: string) => {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setFile(null);
        setPreviewUrl(null);
        if (inputRef.current) inputRef.current.value = "";
        toast.danger("Image not selected", { description: message });
      };
      if (nextFile.size === 0) {
        rejectFile("Choose a non-empty image to upload.");
        return;
      }
      if (!profile.acceptedImageTypes.includes(nextFile.type)) {
        rejectFile("Use a JPEG, PNG, WebP, or AVIF image.");
        return;
      }
      if (nextFile.size > profile.maxUploadBytes) {
        const maxSize = Math.floor(profile.maxUploadBytes / 1024 / 1024);
        rejectFile(`The image must be smaller than ${maxSize} MB.`);
        return;
      }
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setFile(nextFile);
      setPreviewUrl(URL.createObjectURL(nextFile));
    },
    [previewUrl, profile.acceptedImageTypes, profile.maxUploadBytes],
  );

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    chooseFile(event.target.files?.[0]);
  }

  async function saveAvatar() {
    if (!file) return;
    setIsSaving(true);
    try {
      const { data, error } = await api.api.profile.avatar.post({
        avatar: file,
        csrfToken: profile.csrfToken,
      });
      if (error) throw new Error(edenErrorMessage(error));
      setProfile((current) => ({ ...current, avatarUrl: data.avatarUrl }));
      setFile(null);
      setPreviewUrl(null);
      if (inputRef.current) inputRef.current.value = "";
      toast("Profile picture updated", {
        variant: "accent",
        description: "Your new image is now available at your public profile URL.",
      });
    } catch (error) {
      toast.danger("Upload failed", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function signOut() {
    await api.api.logout.post();
    window.location.assign("/");
  }

  const initials = profile.user.displayName
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const currentImage = previewUrl || profile.avatarUrl || undefined;
  const methods = profile.security.authenticationMethods.map((method) => method.toLowerCase());
  const usedMfa = methods.some((method) => ["mfa", "otp", "sms", "hwk", "swk"].includes(method));
  const mfaStatus = methods.length === 0 ? "Not reported" : usedMfa ? "Used" : "Not used";
  const emailStatus =
    profile.security.emailVerified === null
      ? "Not reported"
      : profile.security.emailVerified
        ? "Verified"
        : "Not verified";
  const sessionExpiry = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(profile.security.sessionExpiresAt));

  return (
    <main className="app-page">
      <header className="site-header">
        <Brand />
        <Button className="sign-out" variant="ghost" size="sm" onPress={signOut}>
          <ArrowRightFromSquare /> Sign out
        </Button>
      </header>

      <div className="profile-content">
        <section aria-labelledby="profile-title">
          <Card className="profile-card" variant="secondary">
            <Card.Content className="profile-card-content">
              <input
                ref={inputRef}
                className="sr-only"
                type="file"
                accept={profile.acceptedImageTypes.join(",")}
                onChange={onFileChange}
              />
              <div className="profile-summary">
                <Button
                  className="avatar-button"
                  variant="ghost"
                  isIconOnly
                  aria-label="Choose a new profile picture"
                  onPress={() => inputRef.current?.click()}
                >
                  <Avatar className="profile-avatar" color="accent" variant="soft">
                    {currentImage && (
                      <Avatar.Image
                        src={currentImage}
                        alt={`${profile.user.displayName}'s profile picture`}
                      />
                    )}
                    <Avatar.Fallback>{initials || <Person />}</Avatar.Fallback>
                  </Avatar>
                  <span className="edit-badge" aria-hidden="true">
                    <Pencil />
                  </span>
                </Button>
                <div className="summary-copy">
                  <h1 id="profile-title">{profile.user.displayName}</h1>
                  <p>{profile.user.email}</p>
                </div>
              </div>
              <section className="security-summary" aria-label="Account security">
                <div>
                  <span>Email</span>
                  <b>{emailStatus}</b>
                </div>
                <div title="Methods used for this sign-in; this does not indicate factor enrollment.">
                  <span>MFA this sign-in</span>
                  <b>{mfaStatus}</b>
                </div>
                <div>
                  <span>Session expires</span>
                  <b>{sessionExpiry}</b>
                </div>
              </section>
              <div className="save-row">
                <span title={file?.name}>{file?.name || "No pending changes"}</span>
                <Button
                  className="save-button"
                  isDisabled={!file}
                  isPending={isSaving}
                  onPress={saveAvatar}
                >
                  {isSaving ? "Saving" : "Save changes"}
                </Button>
              </div>
            </Card.Content>
          </Card>
        </section>
      </div>
    </main>
  );
}

export function App() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    Promise.all([api.api.auth.mode.get(), api.api.me.get()])
      .then(([modeResult, profileResult]) => {
        if (modeResult.error) throw new Error(edenErrorMessage(modeResult.error));
        const authenticationMode = modeResult.data.mode;
        if (profileResult.error?.status === 401) {
          return { kind: "anonymous", authenticationMode } as const;
        }
        if (profileResult.error) throw new Error(edenErrorMessage(profileResult.error));
        return { kind: "ready", profile: profileResult.data, authenticationMode } as const;
      })
      .then((next) => {
        if (active) setState(next);
      })
      .catch((error) => {
        if (active)
          setState({
            kind: "error",
            message: error instanceof Error ? error.message : "Could not load your profile.",
          });
      });
    return () => {
      active = false;
    };
  }, []);

  if (state.kind === "loading") return <LoadingScreen />;
  if (state.kind === "anonymous") {
    return <LoginScreen authenticationMode={state.authenticationMode} />;
  }
  if (state.kind === "ready") {
    return <ProfileScreen initialProfile={state.profile} />;
  }
  return (
    <main className="center-screen error-state">
      <CircleInfo />
      <h1>Profile is unavailable</h1>
      <p>{state.message}</p>
      <Button onPress={() => window.location.reload()}>Try again</Button>
    </main>
  );
}
