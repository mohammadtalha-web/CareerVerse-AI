import type { Metadata } from "next";
import Link from "next/link";
import NetworkingNavigation from "@/components/NetworkingNavigation";
import { FeedWorkspace } from "@/components/NetworkingWorkspace";
import { getCurrentAccount } from "@/lib/auth";
import { isDatabaseUnavailable } from "@/lib/http";
import { searchJobs, type JobSearchPage } from "@/lib/job-repository";

export const metadata: Metadata = {
  title: "CareerVerse AI — Find your next move",
  description:
    "Discover work that fits your ambitions, build skills employers value, and move forward with CareerVerse AI.",
};

const careerTools = [
  { icon: "✳", title: "Build a standout resume", copy: "Create and analyze a resume using your real experience and target role.", href: "/ai-career-tools", action: "Build your resume" },
  { icon: "◎", title: "Practice with confidence", copy: "Run a role-focused interview simulation and get feedback on your answers.", href: "/ai-career-tools", action: "Practice an interview" },
  { icon: "↗", title: "Close your skill gaps", copy: "Compare your current strengths with a target role and plan what to learn next.", href: "/ai-career-tools", action: "Explore your skills" },
];

const platformPaths = [
  {
    eyebrow: "FOR PROFESSIONALS",
    title: "Find your next role",
    copy: "Search published opportunities by job title, company, and location.",
    href: "/jobs",
    action: "Explore jobs",
    icon: "⌕",
    className: "path-jobs",
  },
  {
    eyebrow: "CAREER COMMUNITY",
    title: "Grow your network",
    copy: "Join professional conversations and learn from the CareerVerse community.",
    href: "/networking/feed",
    action: "Visit the feed",
    icon: "◎",
    className: "path-community",
  },
  {
    eyebrow: "FOR HIRING TEAMS",
    title: "Build your team",
    copy: "Set up an employer workspace to publish roles and manage applications. Verification is required before publishing.",
    href: "/employer/jobs",
    action: "Open employer workspace",
    icon: "↗",
    className: "path-employers",
  },
];

export const dynamic = "force-dynamic";

async function FeaturedOpportunities() {
  let result: JobSearchPage | null = null;
  let unavailable = false;
  try {
    result = await searchJobs({ pageSize: 3 });
  } catch (error) {
    if (isDatabaseUnavailable(error)) {
      unavailable = true;
    } else {
      console.error("Loading homepage job listings failed.", error);
      unavailable = true;
    }
  }

  const jobs = result?.jobs ?? [];
  return (
    <>
      {jobs.length > 0 ? (
        <div className="featured-job-list">
          {jobs.map((job, index) => (
            <Link key={job.slug} href={`/jobs/${encodeURIComponent(job.slug)}`} className="featured-job-card">
              <div className={`featured-company-logo ${["violet", "blue", "orange"][index % 3]}`}>{job.initials}</div>
              <div className="featured-job-info">
                <div className="featured-job-company">
                  {job.company}
                  <span className={`result-tag${job.isSample ? " home-sample-tag" : ""}`}>
                    {job.isSample ? "Sample listing" : job.sourceType === "government" ? "Government" : "Private"}
                  </span>
                </div>
                <h3>{job.title}</h3>
                <p>{job.location} <i /> {job.type}</p>
                <small>{job.isSample ? "Example only · not a live vacancy" : `${job.sourceName} · ${job.posted}`}</small>
              </div>
              <span className="featured-job-arrow" aria-hidden="true">↗</span>
            </Link>
          ))}
        </div>
      ) : (
        <div className={`home-opportunities-empty${unavailable ? " home-opportunities-unavailable" : ""}`} role={unavailable ? "status" : undefined}>
          <span aria-hidden="true">{unavailable ? "!" : "⌕"}</span>
          <div>
            <strong>{unavailable ? "Job listings are temporarily unavailable" : "No current listings to feature"}</strong>
            <p>{unavailable
              ? "We couldn’t check the live job catalog just now. You can still browse the job search or try again later."
              : "We don’t have a published opening to show here right now. Browse the catalog for updates, or build your profile and get ready for your next search."}</p>
          </div>
          <Link href="/jobs">Open job search <span aria-hidden="true">→</span></Link>
        </div>
      )}
      {result?.mode === "demo" && jobs.length > 0 && (
        <div className="home-section-footnote"><span aria-hidden="true">ⓘ</span> These clearly labelled examples aren’t current vacancies and can’t accept applications.</div>
      )}
    </>
  );
}

export default async function HomePage() {
  const account = await getCurrentAccount();

  if (account) {
    return (
      <main className="jobs-page networking-experience home-member-experience">
        <NetworkingNavigation />
        <div className="wrap network-page home-member-page">
          <FeedWorkspace accountId={account.id} accountName={account.fullName} />
        </div>
      </main>
    );
  }

  return (
    <main className="portal-home">
      <section className="portal-hero">
        <div className="wrap">
          <div className="portal-heading">
            <span className="section-kicker">CAREERVERSE CAREER HUB</span>
            <h1>Find work that moves you forward.</h1>
            <p>Search opportunities, discover employers, and build the profile you want recruiters to see.</p>
          </div>
          <form action="/jobs" method="get" className="portal-search" aria-label="Search job opportunities">
            <label className="portal-search-field">
              <span aria-hidden="true">⌕</span>
              <span className="sr-only">Job title, skill, or company</span>
              <input name="query" type="search" autoComplete="organization-title" placeholder="Job title, skill, or company" />
            </label>
            <label className="portal-search-field portal-location-field">
              <span aria-hidden="true">⌖</span>
              <span className="sr-only">City, region, or country</span>
              <input name="location" type="search" autoComplete="address-level2" placeholder="City, region, or country" />
            </label>
            <button type="submit" className="btn btn-violet">Search jobs <span aria-hidden="true">→</span></button>
          </form>
          <nav className="portal-shortcuts" aria-label="Popular job searches">
            <span>Popular searches</span>
            <Link href="/jobs?query=Software">Software</Link>
            <Link href="/jobs?query=Data">Data</Link>
            <Link href="/jobs?query=Design">Design</Link>
            <Link href="/jobs?employmentType=internship">Internships</Link>
            <Link href="/jobs?location=Remote">Remote</Link>
            <Link href="/jobs?country=BD">Bangladesh</Link>
          </nav>
        </div>
      </section>

      <section className="home-section home-market-section" id="jobs">
        <div className="wrap">
          <div className="home-section-heading">
            <div><span className="section-kicker">CURRENT OPPORTUNITIES</span><h2>Explore open roles.</h2><p>Browse the available catalog, with sample listings clearly marked.</p></div>
            <Link href="/jobs" className="text-link">See all jobs <span aria-hidden="true">→</span></Link>
          </div>
          <div className="home-market-layout">
            <div className="home-market-list"><FeaturedOpportunities /></div>
            <aside className="home-career-sidebar">
              <span className="home-sidebar-kicker">CAREER WORKSPACE</span>
              <h3>More than a job search</h3>
              <p>Build your professional presence and stay connected as you plan your next move.</p>
              <Link href="/networking/profile"><span className="home-sidebar-icon">◎</span><span><strong>Professional profile</strong><small>Show your skills and experience</small></span><b aria-hidden="true">→</b></Link>
              <Link href="/networking/feed"><span className="home-sidebar-icon">◌</span><span><strong>Career community</strong><small>Connect and share with professionals</small></span><b aria-hidden="true">→</b></Link>
              <Link href="/ai-career-tools"><span className="home-sidebar-icon">✳</span><span><strong>Career tools</strong><small>Work on your resume and interviews</small></span><b aria-hidden="true">→</b></Link>
              <Link href="/companies"><span className="home-sidebar-icon">▦</span><span><strong>Explore companies</strong><small>Learn about verified employers</small></span><b aria-hidden="true">→</b></Link>
            </aside>
          </div>
        </div>
      </section>

      <section className="home-pathways" aria-labelledby="home-pathways-title">
        <div className="wrap">
          <div className="home-pathways-heading">
            <div>
              <span className="section-kicker">ONE PLATFORM, DIFFERENT NEXT STEPS</span>
              <h2 id="home-pathways-title">What brings you to CareerVerse?</h2>
            </div>
            <p>Choose the path that fits what you need today.</p>
          </div>
          <div className="home-pathways-grid">
            {platformPaths.map((path) => (
              <Link className={`home-path-card ${path.className}`} href={path.href} key={path.title}>
                <span className="home-path-icon" aria-hidden="true">{path.icon}</span>
                <span className="home-path-eyebrow">{path.eyebrow}</span>
                <h3>{path.title}</h3>
                <p>{path.copy}</p>
                <span className="home-path-action">{path.action} <span aria-hidden="true">→</span></span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="home-section tools-section" id="tools">
        <div className="wrap">
          <div className="home-section-heading">
            <div><span className="section-kicker">More than a job board</span><h2>Build a career you’re proud of.</h2><p>Practical tools for every step between “what’s next?” and “I got it.”</p></div>
            <Link href="/ai-career-tools" className="text-link">Explore career tools <span aria-hidden="true">→</span></Link>
          </div>
          <div className="career-tools-grid">
            {careerTools.map((tool, index) => (
              <Link href={tool.href} key={tool.title} className="career-tool-card">
                <span className={`career-tool-icon icon-${index}`}>{tool.icon}</span><span className="tool-step">0{index + 1} / CAREER TOOL</span><h3>{tool.title}</h3><p>{tool.copy}</p><span className="tool-action">{tool.action} <span aria-hidden="true">→</span></span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="home-cta-section">
        <div className="wrap">
          <div className="home-cta">
            <div><span className="cta-kicker">START WHERE YOU ARE</span><h2>Your next step can be simple.</h2><p>Look through the current job catalog, shape a profile that reflects your experience, or use a practical career tool when you’re ready.</p></div>
            <div className="home-cta-actions"><Link href="/jobs" className="btn btn-violet">Explore opportunities <span aria-hidden="true">→</span></Link><Link href="/networking/profile" className="cta-secondary">Build your professional profile</Link></div>
            <span className="cta-orbit orbit-one" /><span className="cta-orbit orbit-two" />
          </div>
        </div>
      </section>
    </main>
  );
}
