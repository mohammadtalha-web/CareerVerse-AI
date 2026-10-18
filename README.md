# CareerVerse AI

CareerVerse AI is a Next.js career and recruitment experience using the App
Router, React, TypeScript, MySQL, and a shared responsive design system.

## Getting started

Use Node.js 20.9 or later and MySQL 8+ or a compatible MariaDB release. Copy
`.env.example` to `.env.local`, set the database connection values, then import
`database/schema.sql` into MySQL (for example through XAMPP phpMyAdmin). The
schema creates the `careerverse_ai` database and the account, university, job,
source, application, saved-job, and professional networking tables.
To enable Google sign-in, create an OAuth 2.0 Web application client in Google
Cloud Console, add `http://localhost:3000/api/auth/google/callback` as an
authorized redirect URI for local development, and set `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` in `.env.local`. The redirect
URI must exactly match the Google Cloud Console entry; use your production HTTPS
callback URL in production. Google sign-in uses OpenID Connect and does not
require a paid Google API or billing-enabled API. New Google accounts are
created as job seekers; verified Google email addresses can link to an existing
CareerVerse account without changing that account's role.
Email/password registrations must verify a six-digit email code before an
account or session is created. Configure `SMTP_HOST`, `SMTP_PORT`,
`SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM` in `.env.local`.
For Brevo SMTP, verify a sender in Brevo and use `smtp-relay.brevo.com`,
port `587`, `SMTP_SECURE=false`, the SMTP login as `SMTP_USER`, the generated
SMTP key as `SMTP_PASSWORD`, and the verified sender address as `SMTP_FROM`.
Use SMTP credentials, not a Brevo API key. Codes expire after 10 minutes, can
be resent once per minute, and allow five verification attempts. Google sign-up
verifies ownership through Google's signed
`email_verified` claim and does not send a separate code.
For an existing database, import `database/migrations/011_university_affiliation.sql`
to enable optional university selection during signup, account affiliation
updates, and the live Academic Communities directory. Members can search and
sort the paginated directory and add, change, or remove their own affiliation. The
directory shows aggregate affiliation counts; selecting a university lists
only members who have chosen public profile visibility. Private profiles and
contact details are not exposed. Affiliations are self-reported and not
independently verified.
The recruiter dashboard requires administrator review: only after verifying
an employer through a trusted process should an administrator set
`users.recruiter_verified=TRUE`. The signup choice alone never authorizes
recruiters to post jobs. Administrator accounts must be explicitly assigned
by a trusted operator in the database; public registration cannot create one.

```bash
npm install
npm run dev
```

Open http://localhost:3000. The project uses port 3000 for local development and production preview. Validate and run a production build with:

```bash
npm run lint
npm run build
npm start
```

Never expose `.env.local`, database passwords, AI keys, feed tokens, or the
source-sync secret in client-side `NEXT_PUBLIC_` variables.

## Job management

- `/jobs` searches by keyword and location, with country, employment type,
  workplace, and government/private source filters. Search is paginated.
- With database settings absent, the page explicitly labels its local example
  records as samples; sample roles cannot be applied to or saved. With database
  settings present, the live catalog is queried from MySQL. An unreachable or
  incomplete database is shown as unavailable, not silently replaced with fake
  live search results.
- Signed-in job seekers can apply to CareerVerse-hosted live roles and save
  supported live roles. Duplicate applications are rejected. Application and
  saved-job history is available under `/account`.
- Verified recruiters can publish private roles at `/employer/jobs` and review
  applicant status at `/employer/applications`. Publishing stays disabled
  until an administrator verifies the recruiter.
- Applicants can optionally attach a private PDF/DOCX resume (up to 5 MB).
  Resume access is limited to the applicant and the employer that owns the role.
  AI screening requires explicit, application-specific consent to local
  processing; applications without the current consent remain available for
  manual review. The advisory score never makes an automated hiring decision.
- Verified recruiter accounts can publish a company profile and view real
  application-pipeline counts, application trends, and the structured pay
  ranges they have advertised for their own live jobs. Workforce size is
  self-reported by that employer. These figures do not represent overall
  market salary, payroll, employee outcomes, or off-platform hiring.
- The company directory shows only profiles owned by currently verified
  recruiters. Company-owned salary ranges are labeled as advertised and
  employer-provided. External salary/workforce datasets are not connected:
  choose and authorize a data vendor and provide its API contract and
  credentials before integrating one.
- External portal listings link to the verified source application page. The
  app does not claim to submit data directly to a third-party portal. Direct
  portal submission requires an explicitly authorized provider integration;
  credentials and vendor-specific APIs must be supplied before such an
  integration can be enabled.
- Internship and remote are separate, filterable values in the catalog.

## Configuring job sources

The app ingests normalized JSON feeds from sources that you have permission to
use. Before enabling a source, verify its ownership, feed terms, coverage, and
country, then add its public metadata to `job_sources` with `verified=TRUE` and
`enabled=TRUE`. Keep source credentials and feed URLs server-side. Configure
`JOB_SOURCE_ALLOWED_HOSTS` with exact feed hostnames and
`JOB_SOURCE_FEEDS_JSON` with feed definitions, for example:

```json
[
  {
    "key": "example-government-uk",
    "feedUrl": "https://feeds.example.org/jobs"
  }
]
```

The configured feed host must also be listed in `JOB_SOURCE_ALLOWED_HOSTS`.
An optional `apiKeyEnv` field can name a server environment variable matching
`JOB_SOURCE_*_API_KEY`; the value is sent as a Bearer token only to that
allowlisted feed host.

Each feed returns a JSON object with a `jobs` array. Each job must provide
`externalId`, `title`, `companyName`, `location`, `employmentType`
(`full_time`, `part_time`, `contract`, `internship`, or `temporary`),
`workplaceType` (`onsite`, `hybrid`, or `remote`), `description`,
`requirements` (string array), `applicationUrl`, and `sourceUrl`. Optional
fields are `experience`, `salary`, and an ISO `expiresAt`. Country and source
type are assigned from the verified `job_sources` record, not trusted from the
feed payload. Records are deduplicated by source and external ID; listings not
seen on a successful sync are closed.

Set a long random `JOB_SOURCE_SYNC_SECRET` and invoke `POST /api/jobs/sync` from
a trusted scheduler using the `x-job-sync-secret` header. Configure only feeds
for which you have permission and test their normalized output before
enabling synchronization. No government or private portal is preconfigured,
so the live catalog remains empty until you install and verify sources. Global
coverage means the countries represented by your enabled sources; it is not an
automatic promise that every country or portal is covered.

## Configuring live AI features

`/ai-career-tools` provides the AI Career Coach, Resume Builder & Analyzer,
Cover Letter Generation, Interview Simulation, Skill Gap Analysis, and Career
Path Prediction. These features use a local Ollama model; the same model powers
personalized job matching and optional recruiter resume screening.
Users must affirm data-sharing consent for each career-tool or matching
request. Candidate screening requires a separate, application-specific opt-in.

Install [Ollama for Windows](https://ollama.com/download/windows), then open a
terminal and download the default model:

```powershell
ollama pull qwen2.5:3b
```

Ollama must keep running on the same host as the CareerVerse server; the app
connects to its loopback API at `127.0.0.1:11434`. The default model is
`qwen2.5:3b`; set `OLLAMA_MODEL` in server `.env.local` only if a different
locally installed Ollama model is desired. No API key, paid inference service,
or cloud billing is required. Model quality and response speed depend on the
host's memory and CPU/GPU; 8 GB of system memory is recommended. Downloading
and running a model uses local disk, memory, compute, and electricity. Review
the selected model's license before use.

Career-tool inputs, job-matching data, and opted-in resumes are sent only to
the local Ollama instance on the CareerVerse server for inference, not to a
remote AI provider. Ollama keeps the model warm for 30 minutes after requests
to avoid repeated cold-start delays. Career tools use short, task-specific
output limits to keep responses quick; resume drafts retain a larger allowance.
CareerVerse does not save career-tool prompts or generated drafts. Use explicit
consent, avoid unnecessary sensitive details, and check model output for errors.
The API enforces a maximum of 20 AI requests per account per hour. Resume and
cover-letter text are drafts, career-path guidance
is exploratory rather than a validated prediction, job matches are suggestions,
and interview, skill-gap, and recruiter-screening feedback are not employment
decisions. Recruiters must review source resumes and make all hiring decisions.
For existing databases, migration
`database/migrations/017_gemini_screening_consent.sql` adds the versioned
screening-consent column. Older applications, including those with previous
provider consent, remain manual-review-only until the candidate opts in under
the current local-processing disclosure.

## Professional networking

- For local UI/workflow testing only, `CAREERVERSE_ALLOW_DEMO_SEED=true npm run
  seed:demo` creates ten clearly marked fictional accounts, public demo
  profiles, two demo employers, four `[DEMO]` job listings, posts, comments,
  reactions, connections, saved jobs, and applications. The command refuses
  production mode, non-loopback database hosts, and databases other than
  `careerverse_ai`; demo job listings and applications are fictional and must
  never be used for actual hiring. Random account passwords are written to the
  git-ignored `var/careerverse-demo-credentials.txt`. The operation is
  transactional and refuses partial/conflicting seed accounts.
- `/networking/profile` lets a signed-in member create a professional profile
  and portfolio. Profiles are private until explicitly published. Published
  profiles and portfolio items can be viewed by visitors; unpublished profiles
  and their attachments are visible only to the owner.
- `/networking/connections` supports finding published profiles, sending
  connection requests, accepting or declining requests, disconnecting, and
  blocking. Blocks prevent profile discovery and connection or messaging access.
- `/networking/messages` is available only to accepted, unblocked connections.
  Messages can include up to five private file or image attachments (5 MB each,
  25 MB combined); supported image previews are signature-checked and delivered
  through the same conversation-authorized attachment route.
- Signed-in members get an in-app notification bell for new messages,
  connection requests/acceptances, and newly published genuine jobs matching
  public profile headline/skills/location or recent job searches. Search history
  is private to the member, limited to 20 searches, and used for job matching
  only during the most recent 30 days. Optional browser push is sent only after
  explicit permission and subscription; the in-app inbox works without VAPID
  configuration or browser push support. Generate a VAPID key pair once with
  `npx web-push generate-vapid-keys`; configure
  `CAREERVERSE_VAPID_PUBLIC_KEY`, `CAREERVERSE_VAPID_PRIVATE_KEY`, and a
  `mailto:` or HTTPS `CAREERVERSE_VAPID_SUBJECT` server-side. Never commit the
  private key.
- `/networking/feed` is limited to signed-in members and supports text/link
  posts, image previews, comments, Like/Celebrate/Insightful reactions,
  editing, and deletion. Image previews are signature-checked and remain
  access-checked; other attachments remain downloads. User text is displayed
  as text, not interpreted as HTML. The general feed shows posts from all
  unblocked members; the top of `/networking/connections` shows posts only
  from accepted connections.
- `/companies` and `/companies/[slug]` display real company profiles owned by
  verified employers, current openings, company-provided advertised-pay
  ranges, and CareerVerse application totals. No company ratings, market
  salary benchmarks, fabricated job listings, or unsourced workforce counts
  are presented as real.
- `/ai-career-tools` contains the six AI-assisted career tools. Provider
  setup, account sign-in, and per-request consent are required for live
  local model responses; the page reports whether Ollama and the selected model
  are available.
- Portfolio and post attachments accept any file type up to 5 MB per file, at
  most five files and 25 MB combined per submission. Files are stored outside
  `public/` in `CAREERVERSE_UPLOAD_DIR` (default `./var/uploads`) and served
  through an access-checked download route as `application/octet-stream`
  attachments. Feed previews serve verified JPEG, PNG, and WebP post images
  inline through the same access-checked route. Configure that directory on
  persistent storage, restrict filesystem access to the application account,
  and include it in secure backups. Never configure it inside `public/`.
- Member profile photos accept JPEG, PNG, or WebP images up to 5 MB. Images are
  signature-checked, stored in the same private upload directory, and served
  only to the member or viewers allowed by the profile's visibility and block
  settings. Apply `010_networking_profile_photos.sql` to existing databases
  before using profile photo uploads.
- For an existing database, apply
  `database/migrations/002_professional_networking.sql` after the original
  schema. Then apply
  `database/migrations/003_database_scale_indexes.sql` and
  `database/migrations/004_ai_tools.sql` and
  `database/migrations/005_real_recruiting_companies.sql` and
  `database/migrations/006_shared_auth_rate_limits.sql` and
  `database/migrations/007_admin_workspace.sql` and
  `database/migrations/008_admin_job_moderation.sql`,
  `database/migrations/009_admin_reports_moderation.sql`, and
  `database/migrations/010_networking_profile_photos.sql`, and
  `database/migrations/011_message_attachments.sql`, and
  `database/migrations/012_notifications_and_job_searches.sql`, and
  `database/migrations/013_google_sign_in.sql`, and
  `database/migrations/014_email_verification.sql`, and
  `database/migrations/015_admin_member_management.sql`, and
  `database/migrations/016_application_notifications.sql` and
  `database/migrations/017_gemini_screening_consent.sql` once, in order.
  New databases can import the
  updated `database/schema.sql` instead of applying these migrations.
  Schedule index creation for a maintenance window on large
  existing tables and take a verified backup first; index builds consume disk,
  memory, and I/O.
- Local storage is intended for a single application host. Multiple app
  instances need shared object storage and a coordinated migration before they
  can reliably serve the same attachments.

## Other routes and prototype limitations

| Route | Page |
|---|---|
| `/` | Landing page and clearly labelled example roles |
| `/login`, `/signup`, `/account` | Password-based account and job-seeker workspace |
| `/employer/jobs`, `/employer/applications` | Verified recruiter job publishing, company profile, hiring reports, advertised salary data, and application review |
| `/companies`, `/companies/[slug]` | Verified company directory and live employer profiles |
| `/networking/profile`, `/profiles/[slug]` | Private-by-default member profiles, published profiles, and portfolios |
| `/networking/connections`, `/networking/messages` | Connection requests and accepted-connection messaging |
| `/networking/feed` | Signed-in career feed |
| `/university-portal` | Academic Communities directory, personal career checklist, outreach templates, and external opportunity tracker |
| `/recruiter-dashboard` | Redirects to the verified-employer workspace |
| `/ai-career-tools` | Live AI coach, resume analysis, cover letters, interview practice, skill gaps, and career path prediction |
| `/resume-builder` | Redirects to the AI career tools |

Academic Communities shows current member-reported affiliations and
aggregate counts, with links to public member profiles when a university is
selected. Private profiles remain hidden. These are not verified placement
outcomes or institutional analytics.
The campus checklist is saved in the user's browser; outreach messages and the
external-opportunity CSV are created locally and are not uploaded. Third-party
learning resources are operated under their own terms and privacy policies.
The recruiter analytics page is a prototype. The old fictional TechNova
employer profile now redirects to the real verified company directory. The
older standalone HTML prototype files have been removed; use the integrated
App Router pages listed above.

## Database capacity and operations

- The schema includes full-text indexes for job and member keyword searches,
  ordered lookup indexes for common account/job/networking queries, and
  cursor-based feed and connection-list pagination. Keyword search uses
  token-prefix full-text matching; very short terms use indexed field-prefix
  matching. This is not identical to arbitrary substring search.
- `DB_POOL_SIZE` controls the maximum MySQL connections held by each Node.js
  process (default 10; allowed 2–50). The pool waits for connections and
  limits its pending queue to 100 requests. Size the aggregate as
  `DB_POOL_SIZE × application processes/instances` and keep it within the
  database server's connection and memory budget; do not raise it without
  measuring saturation and latency.
- The app does not automatically tune MariaDB/MySQL memory, storage, backups,
  replication, or failover. XAMPP on one workstation and local upload storage
  are development/single-host arrangements, not a high-availability,
  horizontally scaled production deployment. Production capacity must be
  tested with representative data and load on the intended database and app
  hosts. Use shared object storage and a coordinated migration before running
  multiple app instances.

Sign-in and registration attempt limits are stored in MySQL so they are shared
between application instances. The rate-limit table stores hashes of email and
network buckets rather than raw identifiers and removes expired rows in
bounded batches during account requests. Apply migration
`006_shared_auth_rate_limits.sql` before deploying this version.

The protected `/admin` workspace shows live account, job, and application
totals; provides a searchable, paginated member directory; supports recruiter
verification; and lets administrators review reports for feed posts, public
profiles, and employer-posted jobs. Administrators can hide and restore content
without deleting member data or attachments. Each new recruiter, job, and
content moderation decision requires a reason and appears in the visible
`admin_audit_log` history. Members can submit categorized reports with an
optional explanation; duplicate open reports from the same member are
prevented. Hidden posts, profiles, attachments, and employer listings are
omitted from public discovery and direct content access while remaining
available to their owner where appropriate.
Apply `008_admin_job_moderation.sql` to an existing database before using job
moderation and then apply `009_admin_reports_moderation.sql` before using the
report queue, audit reasons, or reversible content visibility controls.
Existing audit rows remain available and are marked as historical entries
without a recorded reason. Grant administrator access only through a trusted
database operator, for example:

```sql
UPDATE users SET role = 'admin' WHERE email = 'trusted-admin@example.com';
```

Do not expose administrator role assignment through public signup or an
unprotected API. Keep admin accounts limited to trusted staff.

Password signups require email verification, and Google sign-in verifies the
identity through Google's signed OpenID Connect claims. Password recovery and
MFA are not implemented. Deploy behind HTTPS and complete those account-recovery
requirements before using it for production accounts.
