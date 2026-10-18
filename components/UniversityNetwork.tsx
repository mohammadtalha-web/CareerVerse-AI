"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

type University = {
  id: string;
  name: string;
  memberCount: number;
};

type UniversityMember = {
  userId: string;
  fullName: string;
  profileSlug: string;
  headline: string;
  location: string;
};

type UniversityMembersResponse = {
  members: UniversityMember[];
  total: number;
  page: number;
  pageSize: number;
};

type DirectoryResponse = {
  universities: University[];
  total: number;
  page: number;
  pageSize: number;
  universityCount: number;
  memberCount: number;
  isSignedIn: boolean;
  myUniversity: string | null;
};

type ApiError = { error: string };

function isApiError(value: unknown): value is ApiError {
  return typeof value === "object" && value !== null &&
    "error" in value && typeof value.error === "string";
}

function isDirectoryResponse(value: unknown): value is DirectoryResponse {
  if (typeof value !== "object" || value === null) return false;
  if (!("universities" in value) || !Array.isArray(value.universities)) return false;
  if (!("total" in value) || typeof value.total !== "number") return false;
  if (!("page" in value) || typeof value.page !== "number") return false;
  if (!("pageSize" in value) || typeof value.pageSize !== "number") return false;
  if (!("universityCount" in value) || typeof value.universityCount !== "number") return false;
  if (!("memberCount" in value) || typeof value.memberCount !== "number") return false;
  if (!("isSignedIn" in value) || typeof value.isSignedIn !== "boolean") return false;
  if (!("myUniversity" in value) ||
      (value.myUniversity !== null && typeof value.myUniversity !== "string")) return false;
  return value.universities.every((university) =>
    typeof university === "object" && university !== null &&
    "id" in university && typeof university.id === "string" &&
    "name" in university && typeof university.name === "string" &&
    "memberCount" in university && typeof university.memberCount === "number",
  );
}

export default function UniversityNetwork() {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"members" | "name">("members");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<DirectoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [affiliation, setAffiliation] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [selectedUniversity, setSelectedUniversity] = useState<University | null>(null);
  const [universityMembers, setUniversityMembers] = useState<UniversityMembersResponse | null>(null);
  const [membersPage, setMembersPage] = useState(1);
  const [membersRefresh, setMembersRefresh] = useState(0);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState("");
  const affiliationLoaded = useRef(false);

  const loadDirectory = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError("");
    const query = new URLSearchParams({
      q: search.trim(),
      sort,
      page: String(page),
    });
    try {
      const response = await fetch(`/api/universities?${query}`, {
        cache: "no-store",
        signal,
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(isApiError(payload) ? payload.error : "We couldn't load Academic Communities.");
      }
      if (signal?.aborted) return;
      if (!isDirectoryResponse(payload)) throw new Error("Academic Communities returned an invalid response.");
      const result = payload;
      setData(result);
      if (!affiliationLoaded.current) {
        setAffiliation(result.myUniversity ?? "");
        affiliationLoaded.current = true;
      }
    } catch (error) {
      if (signal?.aborted) return;
      setLoadError(error instanceof Error ? error.message : "We couldn't load Academic Communities.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [page, search, sort]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void loadDirectory(controller.signal), search ? 250 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadDirectory, refreshVersion, search]);

  useEffect(() => {
    if (!selectedUniversity) return;
    const university = selectedUniversity;
    const controller = new AbortController();
    async function loadUniversityMembers() {
      setMembersLoading(true);
      setMembersError("");
      try {
        const response = await fetch(
          `/api/universities/${encodeURIComponent(university.id)}/members?page=${membersPage}`,
          { cache: "no-store", signal: controller.signal },
        );
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(isApiError(payload) ? payload.error : "We couldn't load this university's members.");
        }
        if (
          typeof payload !== "object" || payload === null ||
          !("members" in payload) || !Array.isArray(payload.members) ||
          !("total" in payload) || typeof payload.total !== "number" ||
          !("page" in payload) || typeof payload.page !== "number" ||
          !("pageSize" in payload) || typeof payload.pageSize !== "number" ||
          !payload.members.every((member) =>
            typeof member === "object" && member !== null &&
            "userId" in member && typeof member.userId === "string" &&
            "fullName" in member && typeof member.fullName === "string" &&
            "profileSlug" in member && typeof member.profileSlug === "string" &&
            "headline" in member && typeof member.headline === "string" &&
            "location" in member && typeof member.location === "string",
          )
        ) {
          throw new Error("The university members response was invalid.");
        }
        if (!controller.signal.aborted) setUniversityMembers(payload as UniversityMembersResponse);
      } catch (error) {
        if (!controller.signal.aborted) {
          setMembersError(error instanceof Error ? error.message : "We couldn't load this university's members.");
        }
      } finally {
        if (!controller.signal.aborted) setMembersLoading(false);
      }
    }
    void loadUniversityMembers();
    return () => controller.abort();
  }, [membersPage, membersRefresh, selectedUniversity]);

  async function updateAffiliation(university: string) {
    setSaving(true);
    setSaveMessage("");
    setSaveError("");
    try {
      const response = await fetch("/api/universities", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ university }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(isApiError(payload) ? payload.error : "We couldn't update your university.");
      }
      if (typeof payload !== "object" || payload === null || !("university" in payload) ||
          (payload.university !== null && typeof payload.university !== "string")) {
        throw new Error("The university update returned an invalid response.");
      }
      const savedUniversity = payload.university ?? "";
      setAffiliation(savedUniversity);
      setData((current) => current ? { ...current, myUniversity: savedUniversity || null } : current);
      setSaveMessage(savedUniversity
        ? "Your university affiliation has been updated."
        : "Your university affiliation has been removed.");
      setPage(1);
      setRefreshVersion((version) => version + 1);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "We couldn't update your university.");
    } finally {
      setSaving(false);
    }
  }

  async function saveAffiliation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const university = affiliation.trim().replace(/\s+/g, " ");
    if (university.length < 2) {
      setSaveError("Enter a university name with at least 2 characters.");
      setSaveMessage("");
      return;
    }
    await updateAffiliation(university);
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="university-page-content">
      <section className="university-directory" id="university-directory" aria-labelledby="university-directory-title">
        <div className="university-directory-heading">
          <div>
            <span className="section-kicker">EXPLORE THE NETWORK</span>
            <h2 id="university-directory-title">Academic communities</h2>
            <p>{data ? `${data.total.toLocaleString()} ${data.total === 1 ? "university" : "universities"} with member accounts` : "Search universities shared by CareerVerse members"}</p>
          </div>
        </div>

        <div className="university-directory-controls">
          <div className="university-search">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              value={search}
              onChange={(event) => { setSearch(event.target.value); setPage(1); }}
              placeholder="Search university names"
              maxLength={100}
              aria-label="Search university names"
            />
            {search && <button type="button" onClick={() => { setSearch(""); setPage(1); }}>Clear</button>}
          </div>
          <label className="university-sort">
            <span>Sort by</span>
            <select value={sort} onChange={(event) => { setSort(event.target.value as "members" | "name"); setPage(1); }}>
              <option value="members">Most members</option>
              <option value="name">University name</option>
            </select>
          </label>
        </div>

        {loadError && <div className="university-notice" role="alert">{loadError} <button type="button" onClick={() => void loadDirectory()}>Try again</button></div>}
        {loading && <p className="university-loading" role="status">Loading Academic Communities…</p>}
        {!loading && !loadError && data && (
          data.universities.length > 0 ? (
            <>
              <ul className="university-list">
                {data.universities.map((university) => (
                  <li className="university-card card" key={university.id}>
                    <button
                      type="button"
                      className="university-card-button"
                      aria-expanded={selectedUniversity?.id === university.id}
                      aria-controls="university-members"
                      onClick={() => {
                        setSelectedUniversity((current) => current?.id === university.id ? null : university);
                        setMembersPage(1);
                        setUniversityMembers(null);
                        setMembersError("");
                      }}
                    >
                      <span className="university-card-mark" aria-hidden="true">{university.name.trim().charAt(0).toUpperCase()}</span>
                      <span className="university-card-name">{university.name}</span>
                      <span className="university-member-count">{university.memberCount.toLocaleString()} {university.memberCount === 1 ? "member" : "members"} <span aria-hidden="true">›</span></span>
                    </button>
                    {selectedUniversity?.id === university.id && (
                      <section className="university-members-panel" id="university-members" aria-labelledby="university-members-title">
                        <div className="university-members-heading">
                          <div>
                            <span className="section-kicker">PUBLIC ACADEMIC COMMUNITY</span>
                            <h3 id="university-members-title">{selectedUniversity.name} members</h3>
                            <p>{universityMembers ? `${universityMembers.total.toLocaleString()} public ${universityMembers.total === 1 ? "profile" : "profiles"}` : "Profiles are visible only when their owners choose public visibility."}</p>
                          </div>
                          <button type="button" className="btn btn-line" onClick={() => setSelectedUniversity(null)}>Close</button>
                        </div>
                        {membersLoading && <p className="university-loading" role="status">Loading public profiles…</p>}
                        {membersError && <div className="university-notice" role="alert">{membersError} <button type="button" onClick={() => setMembersRefresh((current) => current + 1)}>Try again</button></div>}
                        {!membersLoading && !membersError && universityMembers && (
                          universityMembers.members.length ? (
                            <>
                              <ul className="university-members-list">
                                {universityMembers.members.map((member) => (
                                  <li key={member.userId}>
                                    <Link className="university-member-profile" href={`/profiles/${encodeURIComponent(member.profileSlug)}`}>
                                      <span className="university-member-avatar" aria-hidden="true">{member.fullName.trim().charAt(0).toUpperCase()}</span>
                                      <span className="university-member-identity">
                                        <strong>{member.fullName}</strong>
                                        {member.headline && <span>{member.headline}</span>}
                                        {member.location && <small>{member.location}</small>}
                                      </span>
                                      <span className="university-member-open">View profile <span aria-hidden="true">↗</span></span>
                                    </Link>
                                  </li>
                                ))}
                              </ul>
                              {universityMembers.total > universityMembers.pageSize && (
                                <nav className="university-pagination" aria-label="University member pages">
                                  <span>{(universityMembers.page - 1) * universityMembers.pageSize + 1}–{Math.min(universityMembers.page * universityMembers.pageSize, universityMembers.total)} of {universityMembers.total}</span>
                                  <div>
                                    <button type="button" className="btn btn-line" disabled={universityMembers.page <= 1 || membersLoading} onClick={() => setMembersPage((current) => Math.max(1, current - 1))}>Previous</button>
                                    <span aria-live="polite">Page {universityMembers.page} of {Math.ceil(universityMembers.total / universityMembers.pageSize)}</span>
                                    <button type="button" className="btn btn-line" disabled={universityMembers.page >= Math.ceil(universityMembers.total / universityMembers.pageSize) || membersLoading} onClick={() => setMembersPage((current) => current + 1)}>Next</button>
                                  </div>
                                </nav>
                              )}
                            </>
                          ) : (
                            <p className="university-empty-members">No members from this university have a public profile yet.</p>
                          )
                        )}
                      </section>
                    )}
                  </li>
                ))}
              </ul>
              <nav className="university-pagination" aria-label="Academic Communities pages">
                <span>{data.total === 0 ? "No universities" : `Showing ${(data.page - 1) * data.pageSize + 1}–${Math.min(data.page * data.pageSize, data.total)} of ${data.total}`}</span>
                <div>
                  <button type="button" className="btn btn-line" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
                  <span aria-live="polite">Page {data.page} of {totalPages}</span>
                  <button type="button" className="btn btn-line" disabled={page >= totalPages || loading} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Next</button>
                </div>
              </nav>
            </>
          ) : (
            <section className="jobs-empty-state university-empty-state">
              <span aria-hidden="true">⌕</span>
              <h3>{search ? "No matching universities" : "Academic Communities is just getting started"}</h3>
              <p>{search ? "Try a different spelling or clear your search to browse all universities." : "Be one of the first members to add your university below. It will appear in the directory automatically."}</p>
              {search && <button type="button" className="btn btn-line" onClick={() => setSearch("")}>Clear search</button>}
            </section>
          )
        )}
      </section>

      {data && (
        <section className="university-stats" aria-label="Academic communities summary">
          <article className="university-stat card">
            <span>Academic communities represented</span>
            <strong>{data.universityCount.toLocaleString()}</strong>
          </article>
          <article className="university-stat card">
            <span>Members sharing an affiliation</span>
            <strong>{data.memberCount.toLocaleString()}</strong>
          </article>
        </section>
      )}

      <section className="campus-toolkit" id="campus-toolkit" aria-labelledby="campus-toolkit-title">
        <div className="campus-toolkit-heading">
          <div>
            <span className="section-kicker">MADE FOR UNIVERSITY LIFE</span>
            <h2 id="campus-toolkit-title">Practical tools for your next career step</h2>
            <p>Small, useful actions you can take alongside classes—no special account or paid plan needed.</p>
          </div>
          <a className="campus-jump-link" href="#university-directory">Explore academic communities <span aria-hidden="true">↓</span></a>
        </div>

        <div className="campus-toolkit-grid">
          <section className="campus-resource-card campus-learning-card card" aria-labelledby="campus-learning-title">
            <div className="campus-card-heading">
              <span className="campus-resource-icon campus-resource-icon-green" aria-hidden="true">↗</span>
              <div><span className="campus-card-eyebrow">FREE EXTERNAL RESOURCES</span><h3 id="campus-learning-title">Build experience beyond class</h3></div>
            </div>
            <p className="campus-card-description">Independent learning and practical exercises you can use to explore a field or create evidence of your skills.</p>
            <ul className="campus-learning-links">
              <li><a href="https://skillsbuild.org/students" target="_blank" rel="noopener noreferrer">IBM SkillsBuild for students <span aria-hidden="true">↗</span></a><p>Explore free learning paths and workplace skills from IBM SkillsBuild.</p></li>
              <li><a href="https://github.com/skills" target="_blank" rel="noopener noreferrer">GitHub Skills <span aria-hidden="true">↗</span></a><p>Practice GitHub workflows through short, hands-on exercises.</p></li>
              <li><a href="https://www.theforage.com/" target="_blank" rel="noopener noreferrer">Forage virtual job simulations <span aria-hidden="true">↗</span></a><p>Explore self-paced, employer-designed work simulations; check each program’s current access terms.</p></li>
            </ul>
            <p className="campus-template-tip">External services have their own terms and privacy policies. Review them before sharing personal information.</p>
          </section>
        </div>
      </section>

      <section className="university-affiliation card" aria-labelledby="university-affiliation-title">
        <div className="university-affiliation-copy">
          <span className="section-kicker">YOUR PROFILE</span>
          <h2 id="university-affiliation-title">Add your university</h2>
          <p>Connect your account to your university community. This is optional, and you can change or remove it at any time.</p>
        </div>
        {data?.isSignedIn ? (
          <form className="university-affiliation-form" onSubmit={saveAffiliation} aria-busy={saving}>
            <label htmlFor="university-affiliation-input">University name</label>
            <input
              id="university-affiliation-input"
              value={affiliation}
              onChange={(event) => { setAffiliation(event.target.value); setSaveMessage(""); setSaveError(""); }}
              placeholder="e.g. University of Dhaka"
              maxLength={160}
              minLength={2}
              required
              disabled={saving}
            />
            <div className="university-affiliation-actions">
              <button type="submit" className="btn btn-violet" disabled={saving}>
                {saving ? "Saving…" : "Save university"}
              </button>
              {data.myUniversity && (
                <button
                  type="button"
                  className="btn btn-line"
                  disabled={saving}
                  onClick={() => void updateAffiliation("")}
                >
                  {saving && !affiliation.trim() ? "Removing…" : "Remove affiliation"}
                </button>
              )}
            </div>
            {saveMessage && <p className="university-form-success" role="status">{saveMessage}</p>}
            {saveError && <p className="account-form-error" role="alert">{saveError}</p>}
          </form>
        ) : (
          <div className="university-signin-prompt">
            <p>Sign in to add or update the university on your account.</p>
            <Link className="btn btn-violet" href="/login">Log in to update</Link>
          </div>
        )}
      </section>

    </div>
  );
}
