"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ReportContentButton from "@/components/ReportContentButton";
import ImageLightbox from "@/components/ImageLightbox";

type Alert = { error: string; success: string };
type Profile = {
  fullName: string;
  slug: string;
  headline: string;
  location: string;
  bio: string;
  skills: string[];
  visibility: "private" | "public";
  photoUrl: string | null;
};
type Portfolio = {
  id: number;
  title: string;
  description: string;
  projectUrl: string | null;
  uploads: { id: number; originalName: string; byteSize: number }[];
};
type Member = {
  userId: number;
  fullName: string;
  profileSlug: string;
  headline: string;
  location: string;
  photoUrl?: string | null;
};
type Connection = Member & { requesterId: number; status: string };
type ConnectionCategory = "incoming" | "outgoing" | "accepted" | "blocked";
type Reaction = "like" | "celebrate" | "insightful";
type ReactionMember = {
  userId: number;
  fullName: string;
  slug: string | null;
  photoUrl: string | null;
  reaction: Reaction;
};
type Post = {
  id: number;
  userId: number;
  author: string;
  slug: string | null;
  headline: string | null;
  photoUrl: string | null;
  body: string;
  createdAt: string;
  linkUrl: string | null;
  commentCount: number;
  reactionCount: number;
  viewerReaction: Reaction | null;
  moderationHidden: boolean;
  uploads: { id: number; originalName: string; byteSize: number }[];
};
type Conversation = {
  id: number;
  otherUserId: number;
  fullName: string;
  profileSlug: string | null;
  headline: string | null;
  lastMessage: string | null;
};
type Message = {
  id: number;
  senderId: number;
  senderName: string;
  body: string;
  createdAt: string;
  uploads: { id: number; originalName: string; byteSize: number }[];
};

const postStarters = [
  { label: "Share a win", prompt: "A recent professional win I'm proud of is..." },
  { label: "Ask for advice", prompt: "I'd appreciate advice from this community about..." },
  { label: "Share a lesson", prompt: "Something I learned recently that may help others..." },
];

const PROFILE_SLUG_PATTERN = "[a-zA-Z0-9][a-zA-Z0-9\\x2D]{1,78}[a-zA-Z0-9]";

function profileSlugFromName(fullName: string): string {
  const base = fullName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  const slug = base.length < 3 ? `${base || "member"}-profile` : base;
  return slug.slice(0, 80).replace(/-+$/g, "");
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : "The request could not be completed.";
    throw new Error(message);
  }
  return payload as T;
}

function FeedAttachment({ upload }: { upload: Post["uploads"][number] }) {
  const [previewUnavailable, setPreviewUnavailable] = useState(false);
  const downloadUrl = `/api/networking/uploads/${upload.id}`;
  const isImage = /\.(?:jpe?g|png|webp)$/i.test(upload.originalName);

  if (!isImage || previewUnavailable) {
    return (
      <p className="network-attachment-download">
        <a href={downloadUrl}>{upload.originalName} · download</a>
        {isImage && <span> · Image preview unavailable</span>}
      </p>
    );
  }

  return (
    <figure className="network-post-attachment">
      <ImageLightbox
        src={`${downloadUrl}?inline=1`}
        alt={upload.originalName}
        width={1200}
        height={800}
        onError={() => setPreviewUnavailable(true)}
      />
      <figcaption><a href={downloadUrl}>{upload.originalName} · download</a></figcaption>
    </figure>
  );
}

function useAction() {
  const [alert, setAlert] = useState<Alert>({ error: "", success: "" });
  const run = useCallback(async (action: () => Promise<void>) => {
    setAlert({ error: "", success: "" });
    try {
      await action();
    } catch (error) {
      setAlert({ error: error instanceof Error ? error.message : "The request could not be completed.", success: "" });
    }
  }, []);
  return { alert, setAlert, run };
}

function Feedback({ alert }: { alert: Alert }) {
  return (
    <>
      {alert.error && <p className="network-alert network-alert-error" role="alert">{alert.error}</p>}
      {alert.success && <p className="network-alert network-alert-success" role="status">{alert.success}</p>}
    </>
  );
}

function NetworkAvatar({ photoUrl, name, className }: { photoUrl: string | null; name: string; className: string }) {
  return (
    <span className={className} aria-hidden="true">
      {photoUrl
        ? <Image src={photoUrl} alt="" width={64} height={64} loading="eager" unoptimized />
        : name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

function Panel({ children, className = "", id, role }: { children: React.ReactNode; className?: string; id?: string; role?: React.AriaRole }) {
  return <section id={id} role={role} className={`card card-pad network-panel${className ? ` ${className}` : ""}`}>{children}</section>;
}

export function ProfileEditor() {
  const { alert, setAlert, run } = useAction();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [portfolio, setPortfolio] = useState<Portfolio[]>([]);
  const [skillsText, setSkillsText] = useState("");
  const [busy, setBusy] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPhoto, setSavingPhoto] = useState(false);
  const [savingProject, setSavingProject] = useState(false);
  const [deletingProjectId, setDeletingProjectId] = useState<number | null>(null);
  const [savedSlug, setSavedSlug] = useState("");
  const refresh = useCallback(async () => {
    const [profileResult, portfolioResult] = await Promise.all([
      api<{ profile: Profile }>("/api/networking/profile"),
      api<{ portfolio: Portfolio[] }>("/api/networking/portfolio"),
    ]);
    setProfile({
      ...profileResult.profile,
      slug: profileResult.profile.slug || profileSlugFromName(profileResult.profile.fullName),
    });
    setSavedSlug(profileResult.profile.slug);
    setSkillsText(profileResult.profile.skills.join(", "));
    setPortfolio(portfolioResult.portfolio);
  }, []);
  useEffect(() => {
    void Promise.resolve().then(refresh).catch((error: unknown) =>
      setAlert({ error: error instanceof Error ? error.message : "We couldn't load your profile.", success: "" }),
    ).finally(() => setBusy(false));
  }, [refresh, setAlert]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile) return;
    setSavingProfile(true);
    try {
      await run(async () => {
        const result = await api<{ visibility: string }>("/api/networking/profile", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...profile, skills: skillsText.split(",").map((item) => item.trim()).filter(Boolean) }),
        });
        setAlert({ error: "", success: result.visibility === "public" ? "Profile published." : "Private profile saved." });
        await refresh();
      });
    } finally {
      setSavingProfile(false);
    }
  }

  async function uploadPhoto(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = new FormData(form).get("photo");
    if (!(file instanceof File) || !file.size) {
      setAlert({ error: "Choose a photo to upload.", success: "" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setAlert({ error: "Your photo must be 5 MB or smaller.", success: "" });
      return;
    }
    setSavingPhoto(true);
    try {
      await run(async () => {
        const result = await api<{ photoUrl: string }>("/api/networking/profile/photo", {
          method: "POST",
          body: new FormData(form),
        });
        setProfile((current) => current ? { ...current, photoUrl: result.photoUrl } : current);
        form.reset();
        setAlert({ error: "", success: "Profile photo updated." });
      });
    } finally {
      setSavingPhoto(false);
    }
  }

  async function removePhoto() {
    setSavingPhoto(true);
    try {
      await run(async () => {
        await api("/api/networking/profile/photo", { method: "DELETE" });
        setProfile((current) => current ? { ...current, photoUrl: null } : current);
        setAlert({ error: "", success: "Profile photo removed." });
      });
    } finally {
      setSavingPhoto(false);
    }
  }

  async function addPortfolio(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const files = form.querySelector<HTMLInputElement>('input[name="files"]')?.files;
    if (files && files.length > 5) {
      setAlert({ error: "Attach no more than 5 files.", success: "" });
      return;
    }
    if (files && Array.from(files).some((file) => file.size > 5 * 1024 * 1024)) {
      setAlert({ error: "Each attachment must be 5 MB or smaller.", success: "" });
      return;
    }
    if (files && Array.from(files).reduce((total, file) => total + file.size, 0) > 25 * 1024 * 1024) {
      setAlert({ error: "Combined attachment size must be 25 MB or less.", success: "" });
      return;
    }
    setSavingProject(true);
    try {
      await run(async () => {
        await api("/api/networking/portfolio", { method: "POST", body: new FormData(form) });
        form.reset();
        setAlert({ error: "", success: "Portfolio project added." });
        await refresh();
      });
    } finally {
      setSavingProject(false);
    }
  }

  if (busy) return <Panel><p>Loading your profile…</p></Panel>;
  if (!profile) return <Panel>
    <span className="section-kicker">PROFESSIONAL PROFILE</span>
    <h1>Build your profile</h1>
    <Feedback alert={alert} />
    <button className="btn btn-line" type="button" onClick={() => {
      setBusy(true);
      setAlert({ error: "", success: "" });
      void refresh().catch((error: unknown) =>
        setAlert({ error: error instanceof Error ? error.message : "We couldn't load your profile.", success: "" }),
      ).finally(() => setBusy(false));
    }}>Try again</button>
  </Panel>;

  return (
    <div className="network-grid network-profile-layout">
      <Panel className="network-profile-editor">
        <span className="section-kicker">PROFESSIONAL PROFILE</span>
        <h1>Build your profile</h1>
        <p className="network-profile-intro">Profiles stay private until you publish them. Public profiles can be viewed by anyone with the link.</p>
        <Feedback alert={alert} />
        <form className="network-photo-form" onSubmit={uploadPhoto} aria-busy={savingPhoto}>
          <NetworkAvatar photoUrl={profile.photoUrl} name={profile.fullName} className="network-photo-preview" />
          <div className="network-photo-controls">
            <strong>Profile photo</strong>
            <small>Use a JPEG, PNG, or WebP image up to 5 MB.</small>
            <label>Choose photo<input name="photo" type="file" accept="image/jpeg,image/png,image/webp" required disabled={savingPhoto} /></label>
            <div className="network-actions">
              <button className="btn btn-violet" type="submit" disabled={savingPhoto}>{savingPhoto ? "Saving photo…" : "Upload photo"}</button>
              {profile.photoUrl && <button className="btn btn-line" type="button" onClick={() => void removePhoto()} disabled={savingPhoto}>Remove photo</button>}
            </div>
          </div>
        </form>
        <form className="network-form network-profile-fields" onSubmit={saveProfile} aria-busy={savingProfile}>
          <label className="network-profile-field-wide">Public profile URL
            <input required minLength={3} maxLength={80} pattern={PROFILE_SLUG_PATTERN} title="Use 3–80 letters, numbers, or hyphens; start and end with a letter or number." value={profile.slug} onChange={(event) => setProfile({ ...profile, slug: event.target.value })} />
            <small>Your profile URL: <code>/profiles/{profile.slug || "your-name"}</code></small>
          </label>
          <label>Professional headline<input maxLength={160} value={profile.headline} onChange={(event) => setProfile({ ...profile, headline: event.target.value })} placeholder="Product designer · Building useful digital experiences" /></label>
          <label>Location<input maxLength={180} value={profile.location} onChange={(event) => setProfile({ ...profile, location: event.target.value })} placeholder="City, country" /></label>
          <label className="network-profile-field-wide">About you<textarea maxLength={5000} rows={5} value={profile.bio} onChange={(event) => setProfile({ ...profile, bio: event.target.value })} /></label>
          <label>Skills, separated by commas<input value={skillsText} onChange={(event) => setSkillsText(event.target.value)} placeholder="Research, Figma, accessibility" /></label>
          <label>Visibility
            <select value={profile.visibility} onChange={(event) => setProfile({ ...profile, visibility: event.target.value as Profile["visibility"] })}>
              <option value="private">Private (only you)</option><option value="public">Published (public profile)</option>
            </select>
          </label>
          <div className="network-profile-form-actions">
            <button className="btn btn-violet" type="submit" disabled={savingProfile}>{savingProfile ? "Saving profile…" : profile.visibility === "public" ? "Publish profile" : "Save profile"}</button>
          {savedSlug && profile.slug === savedSlug
            ? <Link href={`/profiles/${encodeURIComponent(savedSlug)}`} target="_blank" rel="noreferrer">Preview your profile ↗</Link>
            : savedSlug && <small>Save your changes to update the profile preview.</small>}
          </div>
        </form>
      </Panel>
      <div className="network-stack">
        <Panel className="network-portfolio-editor">
          <span className="section-kicker">YOUR WORK</span><h2>Portfolio</h2>
          <p className="network-portfolio-intro">Add project details and optional attachments. Any file type is accepted up to 5 MB per file; downloads are served as attachments.</p>
          <form className="network-form" onSubmit={addPortfolio} aria-busy={savingProject}>
            <label>Project title<input name="title" required maxLength={160} /></label>
            <label>Description<textarea name="description" rows={3} maxLength={3000} /></label>
            <label>Project link (HTTPS)<input name="projectUrl" type="url" placeholder="https://" /></label>
            <label>Attachments<input name="files" type="file" multiple /><small>Up to 5 files, 5 MB each.</small></label>
            <button className="btn btn-violet" type="submit" disabled={savingProject}>{savingProject ? "Adding project…" : "Add project"}</button>
          </form>
        </Panel>
        {portfolio.map((project) => (
          <Panel key={project.id}>
            <div className="network-card-heading"><h3>{project.title}</h3><button className="btn btn-line" type="button" disabled={deletingProjectId !== null} onClick={() => {
              setDeletingProjectId(project.id);
              void run(async () => {
                await api("/api/networking/portfolio", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: project.id }) });
                setAlert({ error: "", success: "Portfolio project removed." });
                await refresh();
              }).finally(() => setDeletingProjectId(null));
            }}>{deletingProjectId === project.id ? "Removing…" : "Remove"}</button></div>
            <p>{project.description}</p>
            {project.projectUrl && <a href={project.projectUrl} target="_blank" rel="noreferrer">View project ↗</a>}
            {project.uploads.map((upload) => {
              const downloadUrl = `/api/networking/uploads/${upload.id}`;
              const isImage = /\.(?:jpe?g|png|webp)$/i.test(upload.originalName);
              return <p className="network-portfolio-upload" key={upload.id}>
                {isImage && <ImageLightbox src={`${downloadUrl}?inline=1`} alt={upload.originalName} width={640} height={480} />}
                <a href={downloadUrl}>{upload.originalName} · {(upload.byteSize / 1024 / 1024).toFixed(2)} MB · download</a>
              </p>;
            })}
          </Panel>
        ))}
      </div>
    </div>
  );
}

export function PublicProfile({ slug, isSignedIn }: { slug: string; isSignedIn: boolean }) {
  const { alert, setAlert, run } = useAction();
  const [data, setData] = useState<{ profile: Profile & { isOwner: boolean; userId: number; relationship: string; moderationHidden?: boolean }; portfolio: Portfolio[] } | null>(null);
  useEffect(() => {
    api<{ profile: Profile & { isOwner: boolean; userId: number; relationship: string; moderationHidden?: boolean }; portfolio: Portfolio[] }>(`/api/networking/profiles/${encodeURIComponent(slug)}`)
      .then(setData).catch((error: unknown) => setAlert({ error: error instanceof Error ? error.message : "Profile unavailable.", success: "" }));
  }, [slug, setAlert]);
  if (!data) return <Panel><Feedback alert={alert} />{!alert.error && <p>Loading profile…</p>}</Panel>;
  const { profile, portfolio } = data;
  return (
    <div className="network-stack">
      <Panel className="network-public-profile">
        <div className="network-public-header">
          <div className="network-public-identity">
            <NetworkAvatar photoUrl={profile.photoUrl} name={profile.fullName} className="network-public-avatar" />
            <div><span className="section-kicker">CAREERVERSE MEMBER</span><h1>{profile.fullName}</h1></div>
          </div>
          {profile.isOwner && <Link className="btn btn-line network-profile-edit" href="/networking/profile">Edit your profile</Link>}
        </div>
        <div className="network-public-details">
          {profile.headline && <h2>{profile.headline}</h2>}
          {profile.location && <p className="network-public-location">{profile.location}</p>}
          <p className="network-public-bio network-preserve">{profile.bio}</p>
        </div>
        {profile.isOwner && profile.moderationHidden && <p className="network-moderation-notice" role="status">This profile is hidden from other members while it is reviewed.</p>}
        {profile.skills.length > 0 && <div className="network-tags">{profile.skills.map((skill) => <span key={skill}>{skill}</span>)}</div>}
        {!profile.isOwner && isSignedIn && <div className="network-public-social-actions">
          <div className="network-actions">
            {(profile.relationship === "none" || profile.relationship === "rejected") && <button className="btn btn-violet" type="button" onClick={() => void run(async () => {
              await api("/api/networking/connections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: profile.userId }) });
              setAlert({ error: "", success: "Connection request sent." });
            })}>Connect</button>}
            {profile.relationship === "outgoing" && <span>Request sent</span>}
            {profile.relationship === "incoming" && <Link href="/networking/connections">Respond to connection request</Link>}
            {profile.relationship === "accepted" && <Link className="btn btn-violet" href={`/networking/messages?user=${profile.userId}`}>Message</Link>}
            <button className="btn btn-line" type="button" onClick={() => void run(async () => {
              await api("/api/networking/connections", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "block", userId: profile.userId }) });
              setAlert({ error: "", success: "Member blocked." });
            })}>Block</button>
          </div>
          <ReportContentButton targetType="profile" targetId={profile.userId} />
        </div>}
        <Feedback alert={alert} />
      </Panel>
      <Panel className="network-public-portfolio">
        <div className="network-portfolio-heading">
          <div className="network-portfolio-title"><span className="section-kicker">SELECTED WORK</span><h2>Portfolio</h2></div>
          <span className="network-portfolio-count">{portfolio.length} {portfolio.length === 1 ? "project" : "projects"}</span>
        </div>
        {portfolio.length === 0 && <div className="network-portfolio-empty"><span aria-hidden="true">✦</span><div><h3>No projects yet</h3><p>No projects have been added to this portfolio yet.</p></div></div>}
        {portfolio.map((project) => <article className="network-project" key={project.id}>
          <div className="network-project-copy"><span className="network-project-label">FEATURED PROJECT</span><h3>{project.title}</h3><p className="network-preserve">{project.description}</p></div>
          {(project.projectUrl || project.uploads.length > 0) && <div className="network-project-resources" aria-label={`${project.title} resources`}>
            {project.projectUrl && <a href={project.projectUrl} target="_blank" rel="noreferrer"><span aria-hidden="true">↗</span><span>View project</span></a>}
            {project.uploads.map((upload) => {
              const downloadUrl = `/api/networking/uploads/${upload.id}`;
              const isImage = /\.(?:jpe?g|png|webp)$/i.test(upload.originalName);
              return isImage
                ? <div className="network-project-image-resource" key={upload.id}>
                    <ImageLightbox src={`${downloadUrl}?inline=1`} alt={upload.originalName} width={640} height={480} />
                    <a href={downloadUrl}><span aria-hidden="true">↓</span><span>{upload.originalName}</span></a>
                  </div>
                : <a href={downloadUrl} key={upload.id}><span aria-hidden="true">↓</span><span>{upload.originalName}</span></a>;
            })}
          </div>}
        </article>)}
      </Panel>
    </div>
  );
}

export function ConnectionsWorkspace() {
  const { alert, setAlert, run } = useAction();
  const [incoming, setIncoming] = useState<Connection[]>([]);
  const [outgoing, setOutgoing] = useState<Connection[]>([]);
  const [accepted, setAccepted] = useState<Connection[]>([]);
  const [blocked, setBlocked] = useState<Connection[]>([]);
  const [nextCursors, setNextCursors] = useState<Record<ConnectionCategory, string | null>>({
    incoming: null, outgoing: null, accepted: null, blocked: null,
  });
  const [members, setMembers] = useState<Member[]>([]);
  const [query, setQuery] = useState("");
  const refresh = useCallback(async () => {
    const data = await api<{
      incoming: Connection[];
      outgoing: Connection[];
      accepted: Connection[];
      blocked: Connection[];
      nextCursors: Record<ConnectionCategory, string | null>;
    }>("/api/networking/connections");
    setIncoming(data.incoming); setOutgoing(data.outgoing); setAccepted(data.accepted); setBlocked(data.blocked);
    setNextCursors(data.nextCursors);
  }, []);
  async function loadMore(category: ConnectionCategory) {
    const cursor = nextCursors[category];
    if (!cursor) return;
    await run(async () => {
      const data = await api<{ members: Connection[]; nextCursor: string | null }>(
        `/api/networking/connections?category=${category}&cursor=${encodeURIComponent(cursor)}`,
      );
      const setters: Record<ConnectionCategory, (update: (current: Connection[]) => Connection[]) => void> = {
        incoming: setIncoming,
        outgoing: setOutgoing,
        accepted: setAccepted,
        blocked: setBlocked,
      };
      setters[category]((current) => [...current, ...data.members]);
      setNextCursors((current) => ({ ...current, [category]: data.nextCursor }));
    });
  }
  const searchMembers = useCallback(async (term: string) => {
    const data = await api<{ members: Member[] }>(`/api/networking/members?query=${encodeURIComponent(term)}`);
    setMembers(data.members);
  }, []);
  useEffect(() => { void Promise.resolve().then(refresh).catch((error: unknown) => setAlert({ error: error instanceof Error ? error.message : "Could not load connections.", success: "" })); }, [refresh, setAlert]);
  useEffect(() => { void Promise.resolve().then(() => searchMembers("")).catch((error: unknown) => setAlert({ error: error instanceof Error ? error.message : "Could not discover members.", success: "" })); }, [searchMembers, setAlert]);
  async function change(action: string, userId: number) {
    await run(async () => {
      await api("/api/networking/connections", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, userId }) });
      await refresh();
      if (action === "block") await searchMembers(query);
    });
  }
  async function connect(userId: number) {
    await run(async () => {
      await api("/api/networking/connections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }) });
      await refresh();
      setAlert({ error: "", success: "Connection request sent." });
    });
  }
  function memberCard(member: Member, actions: React.ReactNode) {
    return <article className="network-person" key={member.userId}>
      <NetworkAvatar photoUrl={member.photoUrl ?? null} name={member.fullName} className="network-person-avatar" />
      <div className="network-person-info"><Link href={`/profiles/${encodeURIComponent(member.profileSlug)}`}><strong>{member.fullName}</strong></Link>
        {member.headline && <p>{member.headline}</p>}{member.location && <small>{member.location}</small>}</div>
      <div className="network-actions">{actions}</div>
    </article>;
  }
  return <div className="network-stack network-connections-layout network-connections-sidebar-stack">
    <Feedback alert={alert} />
    <Panel className="network-discover-panel" id="network-discover"><span className="section-kicker">GROW YOUR COMMUNITY</span><h1>People you may know</h1>
      <p>Discover professionals and build meaningful connections.</p>
      <form className="network-inline-form" onSubmit={(event) => { event.preventDefault(); void searchMembers(query).catch((error: unknown) => setAlert({ error: error instanceof Error ? error.message : "Search failed.", success: "" })); }}>
        <input aria-label="Search members" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, role, or location" />
        <button className="btn btn-violet" type="submit">Search</button>
      </form>
      <div className="network-suggested-list">
      {members.map((member) => {
        const existing = accepted.some((item) => item.userId === member.userId);
        const sent = outgoing.some((item) => item.userId === member.userId);
        const received = incoming.some((item) => item.userId === member.userId);
        const action = existing
          ? <Link className="btn btn-line" href={`/networking/messages?user=${member.userId}`}>Message</Link>
          : sent
            ? <span className="network-pending-label">Request sent</span>
            : received
              ? <Link className="btn btn-line" href="#network-requests">Respond to request</Link>
              : <button className="btn btn-violet" type="button" onClick={() => void connect(member.userId)}>Connect</button>;
        return memberCard(member, action);
      })}
      {members.length === 0 && <div className="network-section-empty"><strong>No members found yet</strong><p>Try another search, or check back as more professionals publish their profiles.</p></div>}
      </div>
    </Panel>
    <Panel className="network-request-panel" id="network-requests"><div className="network-section-heading"><div><span className="section-kicker">CONNECTION REQUESTS</span><h2>Invitations</h2></div><span className="network-count">{incoming.length} new</span></div>
      <h3>Received</h3>
      {incoming.map((member) => memberCard(member, <><button className="btn btn-violet" type="button" onClick={() => void change("accept", member.userId)}>Accept</button><button className="btn btn-line" type="button" onClick={() => void change("reject", member.userId)}>Decline</button><button className="btn btn-line" type="button" onClick={() => void change("block", member.userId)}>Block</button></>))}
      {incoming.length === 0 && <div className="network-section-empty"><strong>You&apos;re all caught up</strong><p>New invitations will appear here.</p></div>}
      {nextCursors.incoming && <button className="btn btn-line" type="button" onClick={() => void loadMore("incoming")}>Load older requests</button>}
      <h3 className="network-subsection-title">Sent</h3>{outgoing.map((member) => memberCard(member, <button className="btn btn-line" type="button" onClick={() => void change("cancel", member.userId)}>Cancel request</button>))}
      {nextCursors.outgoing && <button className="btn btn-line" type="button" onClick={() => void loadMore("outgoing")}>Load older sent requests</button>}
    </Panel>
    <Panel className="network-accepted-panel"><div className="network-section-heading"><div><span className="section-kicker">YOUR COMMUNITY</span><h2>Connections</h2></div><span className="network-count">{accepted.length} shown</span></div>
      {accepted.map((member) => memberCard(member, <><Link className="btn btn-violet" href={`/networking/messages?user=${member.userId}`}>Message</Link><button className="btn btn-line" type="button" onClick={() => void change("remove", member.userId)}>Disconnect</button><button className="btn btn-line" type="button" onClick={() => void change("block", member.userId)}>Block</button></>))}
      {accepted.length === 0 && <div className="network-section-empty"><strong>Your network is taking shape</strong><p>Connect with professionals to keep the conversation going.</p><Link href="#network-discover">Discover members</Link></div>}
      {nextCursors.accepted && <button className="btn btn-line" type="button" onClick={() => void loadMore("accepted")}>Load more connections</button>}
    </Panel>
    <Panel className="network-blocked-panel"><span className="section-kicker">PRIVACY</span><h2>Blocked members</h2>
      {blocked.map((member) => memberCard(member, <button className="btn btn-line" type="button" onClick={() => void change("unblock", member.userId)}>Unblock</button>))}
      {blocked.length === 0 && <p>You haven&apos;t blocked anyone.</p>}
      {nextCursors.blocked && <button className="btn btn-line" type="button" onClick={() => void loadMore("blocked")}>Load more blocked members</button>}
    </Panel>
  </div>;
}

export function MessagesWorkspace() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const selectedUser = Number(searchParams.get("user") || "0");
  const { alert, setAlert, run } = useAction();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeRecipient, setActiveRecipient] = useState<{ id: number; name: string } | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [messageFiles, setMessageFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const data = await api<{ conversations: Conversation[] }>("/api/networking/messages");
    setConversations(data.conversations);
    const selected = data.conversations.find((conversation) => conversation.otherUserId === selectedUser) ?? data.conversations[0];
    if (selected) {
      setConversationId(selected.id);
      setActiveRecipient({ id: selected.otherUserId, name: selected.fullName });
      const thread = await api<{ messages: Message[] }>(`/api/networking/messages?conversationId=${selected.id}`);
      setMessages(thread.messages);
    } else if (selectedUser) {
      const result = await api<{ members: Connection[] }>(
        `/api/networking/connections?category=accepted&userId=${selectedUser}`,
      );
      const recipient = result.members[0];
      setActiveRecipient(recipient ? { id: recipient.userId, name: recipient.fullName } : null);
      setConversationId(null); setMessages([]);
    } else {
      setActiveRecipient(null);
      setConversationId(null); setMessages([]);
    }
  }, [selectedUser]);
  useEffect(() => { void Promise.resolve().then(refresh).catch((error: unknown) => setAlert({ error: error instanceof Error ? error.message : "Could not load messages.", success: "" })); }, [refresh, setAlert]);
  async function choose(conversation: Conversation) {
    router.replace(`/networking/messages?user=${conversation.otherUserId}`);
    setConversationId(conversation.id);
    await run(async () => {
      const result = await api<{ messages: Message[] }>(`/api/networking/messages?conversationId=${conversation.id}`);
      setMessages(result.messages);
    });
  }
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const files = form.querySelector<HTMLInputElement>('input[name="files"]')?.files;
    if (!activeRecipient || (!draft.trim() && (!files || files.length === 0))) return;
    if (files && files.length > 5) {
      setAlert({ error: "Attach no more than 5 files.", success: "" });
      return;
    }
    if (files && Array.from(files).some((file) => file.size > 5 * 1024 * 1024)) {
      setAlert({ error: "Each attachment must be 5 MB or smaller.", success: "" });
      return;
    }
    if (files && Array.from(files).reduce((total, file) => total + file.size, 0) > 25 * 1024 * 1024) {
      setAlert({ error: "Combined attachment size must be 25 MB or less.", success: "" });
      return;
    }
    await run(async () => {
      setBusy(true);
      try {
        const formData = new FormData(form);
        formData.set("recipientId", String(activeRecipient.id));
        await api("/api/networking/messages", { method: "POST", body: formData });
        form.reset();
        setDraft("");
        setMessageFiles([]);
        await refresh();
      } finally { setBusy(false); }
    });
  }
  return <div className="network-messages network-messages-workspace">
    <Panel className="network-conversation-list"><div className="network-section-heading"><div><span className="section-kicker">YOUR INBOX</span><h1>Messages</h1></div><span className="network-count">{conversations.length}</span></div>
      {conversations.length === 0 && <div className="network-section-empty"><span aria-hidden="true">✉</span><strong>Your conversations start with a connection</strong><p>Connect with a professional to start a private conversation.</p><Link href="/networking/connections">Find people</Link></div>}
      {conversations.map((conversation) => <button className={`network-conversation${conversation.id === conversationId ? " selected" : ""}`} type="button" key={conversation.id} aria-pressed={conversation.id === conversationId} onClick={() => void choose(conversation)}>
        <span className="network-person-avatar" aria-hidden="true">{conversation.fullName.trim().charAt(0).toUpperCase()}</span><span className="network-conversation-copy"><strong>{conversation.fullName}</strong><small>{conversation.lastMessage || "Start a conversation"}</small></span>
      </button>)}
    </Panel>
    <Panel className="network-chat-panel"><div className="network-chat-heading">
      {activeRecipient && <><span className="network-person-avatar" aria-hidden="true">{activeRecipient.name.trim().charAt(0).toUpperCase()}</span><div><h2>{activeRecipient.name}</h2><small>CareerVerse connection</small></div></>}
    </div><div className="network-thread">
      {messages.map((message) => <div className={`network-message${message.senderId === activeRecipient?.id ? " received" : ""}`} key={message.id}><strong>{message.senderName}</strong>{message.body && <p>{message.body}</p>}
        {message.uploads.map((upload) => {
          const downloadUrl = `/api/networking/uploads/${upload.id}`;
          const isImage = /\.(?:jpe?g|png|webp)$/i.test(upload.originalName);
          return <div className="network-message-attachment" key={upload.id}>
            {isImage && <ImageLightbox src={`${downloadUrl}?inline=1`} alt={upload.originalName} width={640} height={480} />}
            <a href={downloadUrl}>{upload.originalName} · {(upload.byteSize / 1024 / 1024).toFixed(2)} MB · download</a>
          </div>;
        })}
      </div>)}
      {!messages.length && activeRecipient && <p>No messages yet. Start the conversation.</p>}
      {!activeRecipient && conversations.length > 0 && <div className="network-section-empty"><strong>Select a conversation</strong><p>Your messages will appear here.</p></div>}
    </div>
      <Feedback alert={alert} />
      <form className="network-inline-form network-message-compose" onSubmit={send} aria-busy={busy}>
        <label className="sr-only" htmlFor="network-message-draft">Message</label>
        <input id="network-message-draft" name="body" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={4000} disabled={!activeRecipient || busy} placeholder={activeRecipient ? "Write a message" : "Select an accepted connection"} />
        <label className="network-message-attach" htmlFor="network-message-files">Attach files or images</label>
        <input id="network-message-files" className="sr-only" name="files" type="file" multiple disabled={!activeRecipient || busy} onChange={(event) => setMessageFiles(Array.from(event.target.files ?? []))} />
        {messageFiles.length > 0 && <small className="network-message-file-summary">{messageFiles.map((file) => file.name).join(", ")}</small>}
        <button className="btn btn-violet" type="submit" disabled={!activeRecipient || busy || (!draft.trim() && messageFiles.length === 0)}>{busy ? "Sending…" : "Send"}</button>
      </form>
    </Panel>
  </div>;
}

export function FeedWorkspace({
  accountId,
  accountName,
  scope = "all",
}: {
  accountId: number;
  accountName: string;
  scope?: "all" | "connections";
}) {
  const { alert, setAlert, run } = useAction();
  const [posts, setPosts] = useState<Post[]>([]);
  const [accountPhotoUrl, setAccountPhotoUrl] = useState<string | null>(null);
  const [postDraft, setPostDraft] = useState("");
  const [publishingPost, setPublishingPost] = useState(false);
  const [loadingFeed, setLoadingFeed] = useState(true);
  const [feedLoadError, setFeedLoadError] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [commentsByPost, setCommentsByPost] = useState<Record<number, { id: number; author: string; body: string; slug: string | null }[]>>({});
  const [reactionMembers, setReactionMembers] = useState<ReactionMember[]>([]);
  const [reactionPost, setReactionPost] = useState<Post | null>(null);
  const [loadingReactions, setLoadingReactions] = useState(false);
  const [reactionError, setReactionError] = useState("");
  const [commentDrafts, setCommentDrafts] = useState<Record<number, string>>({});
  const [expanded, setExpanded] = useState<number[]>([]);
  const refresh = useCallback(async () => {
    const feedUrl = scope === "connections"
      ? "/api/networking/feed?scope=connections"
      : "/api/networking/feed";
    const data = await api<{ posts: Post[]; nextCursor: string | null; accountPhotoUrl: string | null }>(feedUrl);
    setPosts(data.posts);
    setNextCursor(data.nextCursor);
    setAccountPhotoUrl(data.accountPhotoUrl);
  }, [scope]);
  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await api<{ posts: Post[]; nextCursor: string | null }>(
        `/api/networking/feed?${scope === "connections" ? "scope=connections&" : ""}cursor=${encodeURIComponent(nextCursor)}`,
      );
      setPosts((current) => [...current, ...data.posts]);
      setNextCursor(data.nextCursor);
    } catch (error) {
      setAlert({ error: error instanceof Error ? error.message : "Could not load older posts.", success: "" });
    } finally {
      setLoadingMore(false);
    }
  }
  useEffect(() => {
    void Promise.resolve()
      .then(refresh)
      .catch((error: unknown) => {
        setFeedLoadError(true);
        setAlert({ error: error instanceof Error ? error.message : "Could not load the feed.", success: "" });
      })
      .finally(() => setLoadingFeed(false));
  }, [refresh, setAlert]);
  async function createPost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const files = form.querySelector<HTMLInputElement>('input[name="files"]')?.files;
    if (files && files.length > 5) {
      setAlert({ error: "Attach no more than 5 files.", success: "" });
      return;
    }
    if (files && Array.from(files).some((file) => file.size > 5 * 1024 * 1024)) {
      setAlert({ error: "Each attachment must be 5 MB or smaller.", success: "" });
      return;
    }
    if (files && Array.from(files).reduce((total, file) => total + file.size, 0) > 25 * 1024 * 1024) {
      setAlert({ error: "Combined attachment size must be 25 MB or less.", success: "" });
      return;
    }
    setPublishingPost(true);
    try {
      await run(async () => {
        await api("/api/networking/feed", { method: "POST", body: new FormData(form) });
        form.reset();
        setPostDraft("");
        await refresh();
        setAlert({ error: "", success: "Your post is live in the career feed." });
      });
    } finally {
      setPublishingPost(false);
    }
  }
  async function loadComments(postId: number) {
    await run(async () => {
      const data = await api<{ comments: { id: number; author: string; body: string; slug: string | null }[] }>(`/api/networking/posts/${postId}`);
      setCommentsByPost((current) => ({ ...current, [postId]: data.comments }));
      setExpanded((current) => current.includes(postId) ? current.filter((id) => id !== postId) : [...current, postId]);
    });
  }
  async function react(postId: number, reaction: Reaction) {
    await run(async () => {
      await api(`/api/networking/posts/${postId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "react", reaction }) });
      await refresh();
    });
  }
  async function viewReactions(post: Post) {
    setReactionPost(post);
    setReactionMembers([]);
    setReactionError("");
    setLoadingReactions(true);
    try {
      const result = await api<{ reactions: ReactionMember[] }>(`/api/networking/posts/${post.id}?view=reactions`);
      setReactionMembers(result.reactions);
    } catch (error) {
      setReactionError(error instanceof Error ? error.message : "Could not load reactions.");
    } finally {
      setLoadingReactions(false);
    }
  }
  async function comment(event: FormEvent<HTMLFormElement>, postId: number) {
    event.preventDefault();
    const text = commentDrafts[postId] ?? "";
    await run(async () => {
      await api(`/api/networking/posts/${postId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "comment", body: text }) });
      setCommentDrafts((current) => ({ ...current, [postId]: "" }));
      const data = await api<{ comments: { id: number; author: string; body: string; slug: string | null }[] }>(`/api/networking/posts/${postId}`);
      setCommentsByPost((current) => ({ ...current, [postId]: data.comments }));
      await refresh();
    });
  }
  return <div className={`network-feed-layout${scope === "connections" ? " network-connections-feed" : ""}`}>
    {scope === "all" && <aside className="network-feed-sidebar">
      <Panel className="network-identity-card">
        <div className="network-cover-art" aria-hidden="true" />
        <NetworkAvatar photoUrl={accountPhotoUrl} name={accountName} className="network-identity-avatar" />
        <div className="network-identity-body">
          <strong>{accountName}</strong>
          <p>{accountPhotoUrl ? "Your professional community starts with a profile that tells your story." : "Add a profile photo and tell your professional community your story."}</p>
          <Link href="/networking/profile">{accountPhotoUrl ? "Complete your profile" : "Add a photo or complete your profile"} <span aria-hidden="true">→</span></Link>
        </div>
      </Panel>
      <Panel className="network-shortcuts">
        <span className="network-rail-title">Your network</span>
        <Link href="/networking/connections">Find people to connect <span aria-hidden="true">→</span></Link>
        <Link href="/networking/messages">Open your messages <span aria-hidden="true">→</span></Link>
      </Panel>
    </aside>}
    <div className="network-feed-main">
    {scope === "connections" && <Panel className="network-connections-feed-heading">
      <span className="section-kicker">YOUR COMMUNITY</span>
      <h2>Posts from your connections</h2>
      <p>Updates shared by people you’ve connected with.</p>
    </Panel>}
    {posts.map((post) => <Panel className="network-feed-post" id={`post-${post.id}`} key={post.id}>
      <div className="network-post-author">
        <NetworkAvatar photoUrl={post.photoUrl} name={post.author} className="network-post-avatar" />
        <div><strong>{post.slug ? <Link href={`/profiles/${encodeURIComponent(post.slug)}`}>{post.author}</Link> : post.author}</strong>
          {post.headline && <small>{post.headline}</small>}<time dateTime={post.createdAt}>{Number.isNaN(Date.parse(post.createdAt)) ? "CareerVerse member" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(post.createdAt))}</time></div>
      </div>
      {post.moderationHidden && <p className="network-moderation-notice" role="status">This post is hidden from other members while it is reviewed.</p>}
      <p className="network-preserve">{post.body}</p>
      {post.linkUrl && <a href={post.linkUrl} target="_blank" rel="noreferrer noopener">{post.linkUrl}</a>}
      {post.uploads.length > 0 && <div className="network-post-attachments">{post.uploads.map((upload) => <FeedAttachment key={upload.id} upload={upload} />)}</div>}
      {!post.moderationHidden && post.reactionCount > 0 && <div className="network-post-engagement">
        <button className="network-reaction-count" type="button" onClick={() => void viewReactions(post)} aria-label={`See who reacted to ${post.reactionCount} ${post.reactionCount === 1 ? "reaction" : "reactions"}`}>
          <span aria-hidden="true">♥</span> {post.reactionCount} {post.reactionCount === 1 ? "reaction" : "reactions"}
        </button>
        {post.commentCount > 0 && <span>· {post.commentCount} {post.commentCount === 1 ? "comment" : "comments"}</span>}
      </div>}
      <div className="network-actions">
        {!post.moderationHidden && <>
          <button className="btn btn-line" type="button" aria-pressed={post.viewerReaction === "like"} onClick={() => void react(post.id, "like")}>{post.viewerReaction === "like" ? "♥ Liked" : "♡ Like"}</button>
          <button className="btn btn-line" type="button" aria-pressed={post.viewerReaction === "celebrate"} onClick={() => void react(post.id, "celebrate")}>{post.viewerReaction === "celebrate" ? "★ Celebrating" : "★ Celebrate"}</button>
          <button className="btn btn-line" type="button" aria-pressed={post.viewerReaction === "insightful"} onClick={() => void react(post.id, "insightful")}>◎ Insightful</button>
          <button className="btn btn-line" type="button" aria-expanded={expanded.includes(post.id)} onClick={() => void loadComments(post.id)}>Comments · {post.commentCount}</button>
        </>}
        {post.userId !== accountId && !post.moderationHidden && <ReportContentButton targetType="post" targetId={post.id} />}
        {post.userId === accountId && <><button className="btn btn-line" type="button" onClick={() => {
          const text = window.prompt("Edit your post", post.body);
          if (text !== null) void run(async () => {
            await api(`/api/networking/posts/${post.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: text }) });
            await refresh();
          });
        }}>Edit</button><button className="btn btn-line" type="button" onClick={() => {
          if (window.confirm("Delete this post and its attachments?")) void run(async () => {
            await api(`/api/networking/posts/${post.id}`, { method: "DELETE" });
            await refresh();
          });
        }}>Delete</button></>}
      </div>
      {expanded.includes(post.id) && <>
        {(commentsByPost[post.id] ?? []).map((item) => <p className="network-comment" key={item.id}><strong>{item.author}</strong> {item.body}</p>)}
        <form className="network-inline-form" onSubmit={(event) => void comment(event, post.id)}>
          <input value={commentDrafts[post.id] ?? ""} maxLength={2000} onChange={(event) => setCommentDrafts((current) => ({ ...current, [post.id]: event.target.value }))} placeholder="Write a comment" />
          <button className="btn btn-violet" type="submit">Comment</button>
        </form>
      </>}
    </Panel>)}
    {reactionPost && <div className="network-reactions-backdrop" onClick={(event) => {
      if (event.target === event.currentTarget) setReactionPost(null);
    }} onKeyDown={(event) => {
      if (event.key === "Escape") setReactionPost(null);
    }}>
      <section className="network-reactions-dialog" role="dialog" aria-modal="true" aria-labelledby="network-reactions-title" tabIndex={-1}>
        <div className="network-reactions-heading">
          <div><span className="section-kicker">POST ACTIVITY</span><h2 id="network-reactions-title">Reactions</h2></div>
          <button className="network-reactions-close" type="button" autoFocus onClick={() => setReactionPost(null)} aria-label="Close reactions">×</button>
        </div>
        {loadingReactions && <p className="network-reactions-state" role="status">Loading reactions…</p>}
        {reactionError && <p className="network-reactions-state network-reactions-error" role="alert">{reactionError}</p>}
        {!loadingReactions && !reactionError && reactionMembers.length === 0 && <p className="network-reactions-state">No reactions are available to display.</p>}
        <div className="network-reactions-list">
          {reactionMembers.map((member) => <div className="network-reaction-member" key={member.userId}>
            <NetworkAvatar photoUrl={member.photoUrl} name={member.fullName} className="network-person-avatar" />
            <div className="network-reaction-member-copy">
              {member.slug
                ? <Link href={`/profiles/${encodeURIComponent(member.slug)}`} onClick={() => setReactionPost(null)}>{member.fullName}</Link>
                : <strong>{member.fullName}</strong>}
              <small>{member.reaction === "like" ? "Liked" : member.reaction === "celebrate" ? "Celebrated" : "Found this insightful"}</small>
            </div>
            <span className={`network-reaction-type network-reaction-type-${member.reaction}`} aria-label={member.reaction}>
              {member.reaction === "like" ? "♥" : member.reaction === "celebrate" ? "★" : "◎"}
            </span>
          </div>)}
        </div>
      </section>
    </div>}
    {loadingFeed && posts.length === 0 && <Panel className="network-feed-loading" role="status"><span className="network-loading-indicator" aria-hidden="true" /><strong>Loading your career feed</strong><p>Fetching the latest updates from your professional community.</p></Panel>}
    {feedLoadError && posts.length === 0 && <Panel className="network-empty-state"><span aria-hidden="true">!</span><h2>We couldn’t load your feed</h2><p>Your posts and account have not been changed. Check your connection and try again.</p><button className="btn btn-line" type="button" onClick={() => { setLoadingFeed(true); setFeedLoadError(false); void refresh().catch((error: unknown) => { setFeedLoadError(true); setAlert({ error: error instanceof Error ? error.message : "Could not load the feed.", success: "" }); }).finally(() => setLoadingFeed(false)); }}>Try again</button></Panel>}
    {!loadingFeed && !feedLoadError && posts.length === 0 && <Panel className="network-empty-state"><span aria-hidden="true">✦</span><h2>{scope === "connections" ? "No connection posts yet" : "Your feed starts here"}</h2><p>{scope === "connections" ? "Posts from people you’re connected with will appear here." : "Share a professional win, ask your network for advice, or find people whose experience can help you move forward."}</p>{scope === "all" && <div className="network-empty-actions"><Link className="btn btn-violet" href="/networking/connections">Find professionals</Link></div>}</Panel>}
    {nextCursor && <button className="btn btn-line" type="button" onClick={() => void loadMore()} disabled={loadingMore}>
      {loadingMore ? "Loading…" : "Load older posts"}
    </button>}
    </div>
    {scope === "all" && <aside className="network-feed-aside">
      <Panel className="network-composer">
        <div className="network-feed-heading">
          <div><span className="section-kicker">YOUR PROFESSIONAL COMMUNITY</span><h1>Create a post</h1></div>
          <Link href="/networking/connections">Grow your network <span aria-hidden="true">→</span></Link>
        </div>
        <p>Share useful ideas, ask thoughtful questions, and celebrate progress with other professionals.</p>
        <Feedback alert={alert} />
        <form className="network-form network-compose-form" onSubmit={createPost} aria-busy={publishingPost}>
          <label htmlFor="career-post-body">Start a conversation
            <textarea id="career-post-body" name="body" rows={4} required maxLength={5000} value={postDraft} onChange={(event) => setPostDraft(event.target.value)} placeholder="What did you learn, build, or figure out? Share the context so others can join in." />
          </label>
          <div className="network-compose-meta"><small>Professional, respectful posts help everyone get more from the community.</small><small>{postDraft.length.toLocaleString()} / 5,000</small></div>
          <div className="network-compose-options">
            <label className="network-compose-link">Add a link<input name="linkUrl" type="url" placeholder="https://" /></label>
            <label className="network-compose-file">Add photos or files<input name="files" type="file" multiple /><small>Images appear in your post · 5 files, 5 MB each</small></label>
            <button className="btn btn-violet" type="submit" disabled={publishingPost || !postDraft.trim()}>{publishingPost ? "Publishing…" : "Publish post"} <span aria-hidden="true">→</span></button>
          </div>
        </form>
      </Panel>
      <Panel className="network-feed-prompts">
        <div><span className="network-rail-title">A few ideas to get started</span><p>A clear question or practical lesson makes it easier for the right people to respond.</p></div>
        <div className="network-feed-prompt-options">{postStarters.map((starter) => <button type="button" key={starter.label} onClick={() => { setPostDraft(starter.prompt); document.getElementById("career-post-body")?.focus(); }}>{starter.label}<span aria-hidden="true">↗</span></button>)}</div>
        <small>Keep personal contact details private. Report content that feels unsafe or misleading.</small>
      </Panel>
      <Panel className="network-shortcuts">
        <span className="network-rail-title">Build your career</span>
        <Link href="/jobs">Explore opportunities <span aria-hidden="true">↗</span></Link>
        <Link href="/companies">Discover companies <span aria-hidden="true">↗</span></Link>
        <Link href="/ai-career-tools">Try AI career tools <span aria-hidden="true">↗</span></Link>
      </Panel>
      <p className="network-rail-footnote">CareerVerse brings your professional community, opportunities, and career tools together.</p>
    </aside>}
  </div>;
}
