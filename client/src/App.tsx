import {
  ArrowRight,
  ArrowRightFromSquare,
  ArrowUpFromLine,
  Check,
  CircleInfo,
  Lock,
  Person,
  ShieldCheck,
} from "@gravity-ui/icons";
import { Alert, Avatar, Button, Card, Chip, Spinner } from "@heroui/react";
import { type ChangeEvent, type DragEvent, useCallback, useEffect, useRef, useState } from "react";
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
        <span className="service-status">
          <i aria-hidden="true" /> profile service
        </span>
      </header>
      <section className="login-content" aria-labelledby="login-title">
        <div className="login-copy">
          <p className="path-label">AUTH / PROFILE</p>
          <h1 id="login-title">
            Sign in to your
            <span> homelab profile.</span>
          </h1>
          <p className="intro">
            View the identity your services know and manage the avatar shared across your homelab.
          </p>
          <Button
            className="login-button"
            size="lg"
            onPress={() => window.location.assign("/login")}
          >
            {isDevelopment ? "Continue as local developer" : "Continue with Authentik"}
            <ArrowRight />
          </Button>
          <div className="login-assurance">
            {isDevelopment ? <CircleInfo /> : <ShieldCheck />}
            <span>
              {isDevelopment
                ? "Local identity · no external provider contacted"
                : "OIDC authorization code flow · PKCE protected"}
            </span>
          </div>
        </div>
        <section className="login-meta" aria-label="Authentication details">
          <div>
            <span className="meta-label">provider</span>
            <code className="meta-value">{isDevelopment ? "local-dev" : "authentik"}</code>
          </div>
          <div>
            <span className="meta-label">session</span>
            <code className="meta-value">server-side</code>
          </div>
          <div>
            <span className="meta-label">scope</span>
            <code className="meta-value">openid profile email</code>
          </div>
        </section>
      </section>
      <footer className="site-footer">
        <span>self-hosted identity</span>
        <span>status: ready</span>
      </footer>
    </main>
  );
}

function StatusAlert({ kind, message }: { kind: "success" | "danger"; message: string }) {
  return (
    <Alert status={kind} className="status-alert">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>
          {kind === "success" ? "Profile picture updated" : "Upload failed"}
        </Alert.Title>
        <Alert.Description>{message}</Alert.Description>
      </Alert.Content>
    </Alert>
  );
}

function ProfileScreen({
  initialProfile,
  authenticationMode,
}: {
  initialProfile: ProfileResponse;
  authenticationMode: AuthenticationMode;
}) {
  const [profile, setProfile] = useState(initialProfile);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: "success" | "danger"; message: string } | null>(
    null,
  );
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
        setNotice({ kind: "danger", message });
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
      setNotice(null);
    },
    [previewUrl, profile.acceptedImageTypes, profile.maxUploadBytes],
  );

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    chooseFile(event.target.files?.[0]);
  }

  function onDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setIsDragging(false);
    chooseFile(event.dataTransfer.files?.[0]);
  }

  async function saveAvatar() {
    if (!file) return;
    setIsSaving(true);
    setNotice(null);
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
      setNotice({
        kind: "success",
        message: "Your new image is now available at your public profile URL.",
      });
    } catch (error) {
      setNotice({
        kind: "danger",
        message: error instanceof Error ? error.message : "Please try again.",
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
  const maxSize = Math.floor(profile.maxUploadBytes / 1024 / 1024);

  return (
    <main className="app-page">
      <header className="site-header">
        <Brand />
        <div className="header-user">
          <span className="service-status">
            <i aria-hidden="true" />
            {authenticationMode === "development" ? "local" : "authentik"}
          </span>
          <Button className="sign-out" variant="ghost" size="sm" onPress={signOut}>
            <ArrowRightFromSquare /> Sign out
          </Button>
        </div>
      </header>

      <div className="profile-content">
        <section className="profile-intro" aria-labelledby="profile-title">
          <div>
            <p className="path-label">HOME / PROFILE</p>
            <h1 id="profile-title">{profile.user.displayName}</h1>
            <p className="profile-handle">@{profile.user.username}</p>
          </div>
          <Chip className="identity-chip" variant="soft" size="sm">
            <span className="chip-dot" aria-hidden="true" /> identity active
          </Chip>
        </section>

        <section aria-labelledby="picture-title">
          {notice && <StatusAlert kind={notice.kind} message={notice.message} />}
          <Card className="profile-card" variant="secondary">
            <Card.Content className="profile-card-content">
              <div className="profile-summary">
                <div className="avatar-wrap">
                  <Avatar className="profile-avatar" color="accent" variant="soft">
                    {currentImage && (
                      <Avatar.Image
                        src={currentImage}
                        alt={`${profile.user.displayName}'s profile picture`}
                      />
                    )}
                    <Avatar.Fallback>{initials || <Person />}</Avatar.Fallback>
                  </Avatar>
                  <span className="avatar-status">
                    <span className="sr-only">Identity active</span>
                  </span>
                </div>
                <div className="summary-copy">
                  <span className="summary-label">primary identity</span>
                  <h2>{profile.user.displayName}</h2>
                  <p>{profile.user.email}</p>
                  <span className="public-state">
                    <Check /> public avatar endpoint
                  </span>
                </div>
              </div>

              <div className="avatar-settings">
                <div className="setting-heading">
                  <div>
                    <span className="setting-title">Avatar</span>
                    <p id="picture-title">Replace the image used by homelab services.</p>
                  </div>
                  <code>512×512 webp</code>
                </div>
                <input
                  ref={inputRef}
                  className="sr-only"
                  type="file"
                  accept={profile.acceptedImageTypes.join(",")}
                  onChange={onFileChange}
                />
                <button
                  type="button"
                  className={`drop-area ${isDragging ? "is-dragging" : ""} ${file ? "has-file" : ""}`}
                  aria-label="Choose a new profile picture"
                  onClick={() => inputRef.current?.click()}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={onDrop}
                >
                  <span className="drop-icon">
                    <ArrowUpFromLine />
                  </span>
                  <div>
                    <b>{file?.name || "Choose a new picture"}</b>
                    <small>{file ? "ready to write" : "click or drop an image"}</small>
                  </div>
                  <span className="browse-action">select</span>
                </button>
                <div className="upload-meta">
                  <span>jpeg · png · webp · avif</span>
                  <span>max {maxSize} mb</span>
                </div>
                <Button
                  className="save-button"
                  fullWidth
                  isDisabled={!file}
                  isPending={isSaving}
                  onPress={saveAvatar}
                >
                  {isSaving ? "Writing avatar" : "Update avatar"} {!isSaving && <ArrowRight />}
                </Button>
              </div>
            </Card.Content>
          </Card>
        </section>

        <section className="identity-section" aria-labelledby="identity-title">
          <div className="section-heading">
            <div>
              <p className="path-label">IDENTITY / CLAIMS</p>
              <h2 id="identity-title">Account details</h2>
            </div>
            <Chip className="readonly-chip" variant="soft" size="sm">
              <Lock /> Read only
            </Chip>
          </div>
          <Card className="details-card" variant="secondary">
            <Card.Content className="details-grid">
              <Detail label="Display name" value={profile.user.displayName} />
              <Detail label="Username" value={profile.user.username} />
              <Detail label="Email" value={profile.user.email} />
              <Detail label="Account ID" value={profile.user.subject} mono />
            </Card.Content>
          </Card>
          <div className="read-only-note">
            <CircleInfo />
            <span>
              {authenticationMode === "development"
                ? "Account details come from the local development environment."
                : "Account details come from Authentik and can’t be edited here."}
            </span>
          </div>
        </section>
      </div>

      <footer className="site-footer">
        <span>id.homelab</span>
        <span>
          {authenticationMode === "development" ? "source: local environment" : "source: authentik"}
        </span>
      </footer>
    </main>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="detail">
      <dt>{label}</dt>
      <dd className={mono ? "mono" : undefined} title={value}>
        {value}
      </dd>
    </div>
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
    return (
      <ProfileScreen initialProfile={state.profile} authenticationMode={state.authenticationMode} />
    );
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
