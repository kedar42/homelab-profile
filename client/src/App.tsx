import {
  ArrowRight,
  ArrowRightFromSquare,
  ArrowUpFromLine,
  Check,
  CircleInfo,
  Lock,
  Person,
  Picture,
  ShieldCheck,
} from "@gravity-ui/icons";
import { Alert, Avatar, Button, Card, Chip, Separator, Spinner } from "@heroui/react";
import { type ChangeEvent, type DragEvent, useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

type ProfileResponse = NonNullable<Awaited<ReturnType<typeof api.api.me.get>>["data"]>;

type LoadState =
  | { kind: "loading" }
  | { kind: "anonymous" }
  | { kind: "ready"; profile: ProfileResponse }
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
      <span>Profile</span>
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

function LoginScreen() {
  return (
    <main className="login-page">
      <header className="login-header">
        <Brand />
        <Chip color="success" variant="soft" size="sm">
          Homelab service
        </Chip>
      </header>
      <section className="login-grid">
        <div className="login-copy">
          <p className="eyebrow">Your identity, in one place</p>
          <h1>
            Put a face to <span>your account.</span>
          </h1>
          <p className="intro">
            View the details connected to your homelab account and choose the picture that
            represents you across our services.
          </p>
          <Button
            className="login-button"
            size="lg"
            onPress={() => window.location.assign("/login")}
          >
            Continue with SSO <ArrowRight />
          </Button>
          <div className="login-assurance">
            <ShieldCheck /> <span>You’ll continue securely through Authentik.</span>
          </div>
        </div>
        <div className="identity-art" aria-hidden="true">
          <div className="orb orb-one" />
          <div className="orb orb-two" />
          <Card className="art-card art-card-back" variant="secondary">
            <span>HOMELAB</span>
            <b>01</b>
          </Card>
          <Card className="art-card art-card-front" variant="default">
            <div className="art-avatar">P</div>
            <div>
              <small>PROFILE</small>
              <strong>
                Your space.
                <br />
                Your picture.
              </strong>
            </div>
          </Card>
        </div>
      </section>
      <footer className="login-footer">
        <span>Private by design</span>
        <span>One image. Everywhere.</span>
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

function ProfileScreen({ initialProfile }: { initialProfile: ProfileResponse }) {
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
      <header className="app-header">
        <Brand />
        <div className="header-user">
          <Chip variant="soft" size="sm">
            {profile.user.displayName}
          </Chip>
          <Button variant="ghost" size="sm" onPress={signOut}>
            <ArrowRightFromSquare /> Sign out
          </Button>
        </div>
      </header>

      <div className="dashboard-grid">
        <aside className="profile-aside">
          <p className="eyebrow">Account</p>
          <h1>Your profile</h1>
          <p>
            This is how you appear around the homelab. For now, only your picture can be changed
            here.
          </p>
          <Separator />
          <span className="section-label">Available setting</span>
          <div className="nav-item">
            <span>
              <Picture />
            </span>
            <div>
              <b>Profile picture</b>
              <small>Image and crop</small>
            </div>
          </div>
        </aside>

        <section className="profile-content" aria-labelledby="picture-title">
          {notice && <StatusAlert kind={notice.kind} message={notice.message} />}
          <div className="section-heading">
            <div>
              <p className="eyebrow">Profile picture</p>
              <h2 id="picture-title">Make it recognisably you.</h2>
            </div>
            <Chip color="success" variant="soft" size="sm">
              <Check /> Public profile URL
            </Chip>
          </div>

          <Card className="avatar-card" variant="secondary">
            <Card.Content className="avatar-card-content">
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
                <span className="avatar-orbit" aria-hidden="true" />
              </div>

              <div className="upload-column">
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
                    <small>{file ? "Ready to save" : "or drop an image here"}</small>
                  </div>
                  <span className="browse-action">Browse</span>
                </button>
                <div className="upload-meta">
                  <span>JPEG, PNG, WebP or AVIF</span>
                  <span>Up to {maxSize} MB</span>
                </div>
                <Button
                  fullWidth
                  size="lg"
                  isDisabled={!file}
                  isPending={isSaving}
                  onPress={saveAvatar}
                >
                  {isSaving ? "Saving picture" : "Save new picture"} {!isSaving && <ArrowRight />}
                </Button>
              </div>
            </Card.Content>
          </Card>

          <Separator className="content-divider" />

          <div className="section-heading details-heading">
            <div>
              <p className="eyebrow">Identity</p>
              <h2>Account details</h2>
            </div>
            <Chip variant="soft" size="sm">
              <Lock /> Read only
            </Chip>
          </div>
          <Card className="details-card" variant="default">
            <Card.Content className="details-grid">
              <Detail label="Display name" value={profile.user.displayName} />
              <Detail label="Username" value={profile.user.username} />
              <Detail label="Email" value={profile.user.email} />
              <Detail label="Account ID" value={profile.user.subject} mono />
            </Card.Content>
          </Card>
          <div className="read-only-note">
            <CircleInfo />
            <span>Account details come from Authentik and can’t be edited here.</span>
          </div>
        </section>
      </div>

      <footer className="app-footer">
        <span>Profile service</span>
        <span>Identity managed by Authentik</span>
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
    api.api.me
      .get()
      .then(({ data, error }) => {
        if (error?.status === 401) return { kind: "anonymous" } as const;
        if (error) throw new Error(edenErrorMessage(error));
        return { kind: "ready", profile: data } as const;
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
  if (state.kind === "anonymous") return <LoginScreen />;
  if (state.kind === "ready") return <ProfileScreen initialProfile={state.profile} />;
  return (
    <main className="center-screen error-state">
      <CircleInfo />
      <h1>Profile is unavailable</h1>
      <p>{state.message}</p>
      <Button onPress={() => window.location.reload()}>Try again</Button>
    </main>
  );
}
