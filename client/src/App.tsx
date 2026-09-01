import { ArrowRight, ArrowRightFromSquare, CircleInfo, Pencil, Person } from "@gravity-ui/icons";
import { Alert, Avatar, Button, Card, Spinner } from "@heroui/react";
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

function ProfileScreen({ initialProfile }: { initialProfile: ProfileResponse }) {
  const [profile, setProfile] = useState(initialProfile);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
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
        <Button className="sign-out" variant="ghost" size="sm" onPress={signOut}>
          <ArrowRightFromSquare /> Sign out
        </Button>
      </header>

      <div className="profile-content">
        <section aria-labelledby="profile-title">
          {notice && <StatusAlert kind={notice.kind} message={notice.message} />}
          <Card className="profile-card" variant="secondary">
            <Card.Content className="profile-card-content">
              <div className="profile-summary">
                <button
                  type="button"
                  className="avatar-button"
                  aria-label="Choose a new profile picture"
                  onClick={() => inputRef.current?.click()}
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
                </button>
                <div className="summary-copy">
                  <h1 id="profile-title">{profile.user.displayName}</h1>
                  <p>{profile.user.email}</p>
                </div>
              </div>

              <div className="photo-setting">
                <input
                  ref={inputRef}
                  className="sr-only"
                  type="file"
                  accept={profile.acceptedImageTypes.join(",")}
                  onChange={onFileChange}
                />
                <div className="photo-copy">
                  <div>
                    <b>Profile picture</b>
                    <span>{file?.name || `JPEG, PNG, WebP or AVIF · up to ${maxSize} MB`}</span>
                  </div>
                  <Button
                    className="choose-button"
                    variant="secondary"
                    onPress={() => inputRef.current?.click()}
                  >
                    Choose image
                  </Button>
                </div>
                {file && (
                  <Button className="save-button" isPending={isSaving} onPress={saveAvatar}>
                    {isSaving ? "Saving" : "Save changes"}
                  </Button>
                )}
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
