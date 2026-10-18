import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
const scrypt = promisify(scryptCallback);
const DEMO_EMAILS = [
  "careerverse-demo+recruiter01@example.com",
  "careerverse-demo+recruiter02@example.com",
  ...Array.from({ length: 8 }, (_, index) =>
    `careerverse-demo+seeker${String(index + 1).padStart(2, "0")}@example.com`,
  ),
];
const CREDENTIALS_PATH = path.join(process.cwd(), "var", "careerverse-demo-credentials.txt");

const people = [
  { name: "[DEMO] Recruiter 01", role: "recruiter", headline: "[DEMO] Hiring team · DemoOrbit Software", location: "Dhaka, Bangladesh", skills: ["Hiring", "Software", "Product"], company: "DemoOrbit Software" },
  { name: "[DEMO] Recruiter 02", role: "recruiter", headline: "[DEMO] Hiring team · BrightPath Digital", location: "Dhaka, Bangladesh", skills: ["Recruiting", "Design", "Engineering"], company: "BrightPath Digital" },
  { name: "[DEMO] Amina Rahman", role: "job_seeker", headline: "[DEMO] Software Engineer · React and Node.js", location: "Dhaka, Bangladesh", skills: ["React", "TypeScript", "Node.js"] },
  { name: "[DEMO] Rafi Ahmed", role: "job_seeker", headline: "[DEMO] Data Analyst · SQL and Python", location: "Chattogram, Bangladesh", skills: ["SQL", "Python", "Power BI"] },
  { name: "[DEMO] Nabila Islam", role: "job_seeker", headline: "[DEMO] Product Designer · UX research", location: "Dhaka, Bangladesh", skills: ["Figma", "UX Research", "Prototyping"] },
  { name: "[DEMO] Tanvir Hasan", role: "job_seeker", headline: "[DEMO] Frontend Developer · Accessible UI", location: "Sylhet, Bangladesh", skills: ["JavaScript", "CSS", "Accessibility"] },
  { name: "[DEMO] Sadia Karim", role: "job_seeker", headline: "[DEMO] Product Manager · Agile delivery", location: "Dhaka, Bangladesh", skills: ["Product Strategy", "Agile", "Analytics"] },
  { name: "[DEMO] Imran Chowdhury", role: "job_seeker", headline: "[DEMO] QA Engineer · Test automation", location: "Rajshahi, Bangladesh", skills: ["Playwright", "Testing", "CI/CD"] },
  { name: "[DEMO] Farzana Noor", role: "job_seeker", headline: "[DEMO] UX Designer · Design systems", location: "Dhaka, Bangladesh", skills: ["Figma", "Design Systems", "Usability"] },
  { name: "[DEMO] Samiul Haque", role: "job_seeker", headline: "[DEMO] Backend Developer · APIs and databases", location: "Khulna, Bangladesh", skills: ["Node.js", "MySQL", "APIs"] },
];

const jobs = [
  { employer: 0, slug: "cv-demo-job-01", title: "[DEMO] Junior Software Engineer", company: "DemoOrbit Software", type: "full_time", workplace: "hybrid", experience: "1–3 years", salary: "DEMO RANGE · BDT 60,000–90,000 per month", skills: ["TypeScript", "React", "REST APIs"], description: "DEMO LISTING — fictional role for local CareerVerse testing only. Help build and maintain accessible product features with a supportive engineering team. This is not a real vacancy and must not be used to recruit or collect applications." },
  { employer: 0, slug: "cv-demo-job-02", title: "[DEMO] Data Analyst", company: "DemoOrbit Software", type: "full_time", workplace: "onsite", experience: "1–2 years", salary: "DEMO RANGE · BDT 50,000–75,000 per month", skills: ["SQL", "Python", "Data visualization"], description: "DEMO LISTING — fictional role for local CareerVerse testing only. Explore sample product data, prepare dashboards, and explain findings to a cross-functional team. This is not a real vacancy and must not be used to recruit or collect applications." },
  { employer: 1, slug: "cv-demo-job-03", title: "[DEMO] Product Designer", company: "BrightPath Digital", type: "full_time", workplace: "remote", experience: "2–4 years", salary: "DEMO RANGE · BDT 65,000–95,000 per month", skills: ["Figma", "Prototyping", "UX research"], description: "DEMO LISTING — fictional role for local CareerVerse testing only. Create sample user journeys, test prototypes, and document a consistent design system. This is not a real vacancy and must not be used to recruit or collect applications." },
  { employer: 1, slug: "cv-demo-job-04", title: "[DEMO] QA Automation Engineer", company: "BrightPath Digital", type: "full_time", workplace: "hybrid", experience: "1–3 years", salary: "DEMO RANGE · BDT 55,000–80,000 per month", skills: ["Playwright", "TypeScript", "CI/CD"], description: "DEMO LISTING — fictional role for local CareerVerse testing only. Build repeatable browser tests, investigate sample defects, and help improve release confidence. This is not a real vacancy and must not be used to recruit or collect applications." },
];

const postBodies = [
  "DEMO POST — I just finished a small TypeScript project and learned how much useful feedback can improve the final result. What helps you stay focused while learning?",
  "DEMO POST — I have been practicing SQL by turning messy sample data into clear summaries. Sharing progress makes the learning process feel more achievable.",
  "DEMO POST — A good design review starts with understanding the user problem before debating the interface. What is one question you always ask?",
  "DEMO POST — This week I tried adding keyboard navigation to a sample UI. Accessibility work is a great reminder that small details affect real experiences.",
  "DEMO POST — Breaking a product goal into smaller experiments has made planning feel less overwhelming. Curious how other teams prioritize their next step.",
  "DEMO POST — I built my first browser test with Playwright and found a bug I had missed manually. Small automation wins are motivating.",
  "DEMO POST — I have been documenting design-system decisions as I go. Future me is already grateful for the clearer notes.",
  "DEMO POST — A sample API project helped me understand why thoughtful error messages matter as much as the happy path.",
  "DEMO POST — Recruiter demo: this is a fictional community update used to preview how employer posts appear in the feed.",
  "DEMO POST — Recruiter demo: our sample team is practicing clear role descriptions and respectful candidate communication.",
];

const commentBodies = [
  "DEMO COMMENT — Thanks for sharing this. Breaking the work into small steps helped me too.",
  "DEMO COMMENT — Nice progress! I would be interested to hear what you try next.",
  "DEMO COMMENT — Great reminder to keep the user problem in focus.",
];

function requireLocalOptIn() {
  if (process.env.CAREERVERSE_ALLOW_DEMO_SEED !== "true") {
    throw new Error("Set CAREERVERSE_ALLOW_DEMO_SEED=true to opt in to local demo data creation.");
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("Demo seeding is disabled when NODE_ENV=production.");
  }
  const host = (process.env.DB_HOST ?? "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error("Demo seeding only runs against a loopback database host.");
  }
  if (process.env.DB_NAME !== "careerverse_ai") {
    throw new Error("Demo seeding only runs against the careerverse_ai database.");
  }
  if (!process.env.DB_USER) {
    throw new Error("DB_USER is required to connect to the local demo database.");
  }
}

async function createPasswordRecord(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt, 64, {
    N: 32_768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return { salt, hash: Buffer.from(hash).toString("hex") };
}

async function main() {
  loadEnvConfig(process.cwd());
  requireLocalOptIn();

  const database = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? "3306"),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD ?? "",
    database: process.env.DB_NAME,
    charset: "utf8mb4",
    connectTimeout: 5000,
  });
  let credentialsCreated = false;
  let transactionStarted = false;

  try {
    const [databaseRows] = await database.query("SELECT DATABASE() AS databaseName");
    if (databaseRows[0]?.databaseName !== "careerverse_ai") {
      throw new Error("Connected database did not match the local demo database.");
    }

    const [existing] = await database.execute(
      `SELECT id, email, role FROM users WHERE email IN (${DEMO_EMAILS.map(() => "?").join(",")})`,
      DEMO_EMAILS,
    );
    if (existing.length === DEMO_EMAILS.length) {
      console.log("The ten CareerVerse demo accounts already exist; no records were changed.");
      return;
    }
    if (existing.length > 0) {
      throw new Error("Some reserved demo accounts already exist. Refusing a partial seed to avoid changing existing accounts.");
    }

    const jobSlugs = jobs.map((job) => job.slug);
    const [existingJobs] = await database.execute(
      `SELECT id FROM jobs WHERE slug IN (${jobSlugs.map(() => "?").join(",")})`,
      jobSlugs,
    );
    if (existingJobs.length > 0) {
      throw new Error("Reserved demo job slugs already exist without the complete demo account set. No records were changed.");
    }

    const passwords = people.map(() => randomBytes(24).toString("base64url"));
    const passwordRecords = await Promise.all(passwords.map(createPasswordRecord));
    const credentials = [
      "CareerVerse local demo accounts",
      "All people, posts, vacancies, ranges, and applications below are fictional test data.",
      "These passwords are random local-only credentials. Do not use these accounts on a live service.",
      "",
      ...people.map((person, index) =>
        `${person.role.toUpperCase()} | ${person.name} | careerverse-demo+${person.role === "recruiter" ? `recruiter${String(index + 1).padStart(2, "0")}` : `seeker${String(index - 1).padStart(2, "0")}`}@example.com | ${passwords[index]}`,
      ),
      "",
    ].join("\r\n");

    await mkdir(path.dirname(CREDENTIALS_PATH), { recursive: true });
    await writeFile(CREDENTIALS_PATH, credentials, { encoding: "utf8", flag: "wx", mode: 0o600 });
    credentialsCreated = true;

    await database.beginTransaction();
    transactionStarted = true;

    const accountIds = [];
    for (const [index, person] of people.entries()) {
      const [result] = await database.execute(
        `INSERT INTO users
         (email, full_name, role, password_salt, password_hash, recruiter_verified)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          DEMO_EMAILS[index],
          person.name,
          person.role,
          passwordRecords[index].salt,
          passwordRecords[index].hash,
          person.role === "recruiter",
        ],
      );
      accountIds.push(Number(result.insertId));
    }

    for (const [index, person] of people.entries()) {
      const slug = `careerverse-demo-member-${String(index + 1).padStart(2, "0")}`;
      await database.execute(
        `INSERT INTO networking_profiles
         (user_id, profile_slug, headline, location, bio, skills, visibility)
         VALUES (?, ?, ?, ?, ?, ?, 'public')`,
        [
          accountIds[index],
          slug,
          person.headline,
          person.location,
          "DEMO PROFILE — fictional member used only for local CareerVerse UI and workflow testing.",
          JSON.stringify(person.skills),
        ],
      );
    }

    const companySlugs = ["careerverse-demo-orbit", "careerverse-demo-brightpath"];
    for (let index = 0; index < 2; index += 1) {
      const person = people[index];
      await database.execute(
        `INSERT INTO company_profiles
         (owner_user_id, slug, company_name, industry, headquarters, description)
         VALUES (?, ?, ?, 'DEMO ONLY', 'Dhaka, Bangladesh', ?)`,
        [
          accountIds[index],
          companySlugs[index],
          person.company,
          "DEMO COMPANY — fictional employer profile for local CareerVerse testing only.",
        ],
      );
    }

    const jobIds = [];
    for (const job of jobs) {
      const [result] = await database.execute(
        `INSERT INTO jobs (
          employer_id, slug, title, company_name, location, country_code,
          employment_type, workplace_type, experience, salary, description,
          requirements, status, is_sample, published_at
        ) VALUES (?, ?, ?, ?, 'Dhaka, Bangladesh', 'BD', ?, ?, ?, ?, ?, ?, 'published', FALSE, CURRENT_TIMESTAMP(3))`,
        [
          accountIds[job.employer],
          job.slug,
          job.title,
          job.company,
          job.type,
          job.workplace,
          job.experience,
          job.salary,
          job.description,
          JSON.stringify(job.skills),
        ],
      );
      jobIds.push(Number(result.insertId));
    }

    const postIds = [];
    for (let index = 0; index < postBodies.length; index += 1) {
      const [result] = await database.execute(
        "INSERT INTO networking_posts (user_id, body) VALUES (?, ?)",
        [accountIds[index], postBodies[index]],
      );
      postIds.push(Number(result.insertId));
    }

    for (const [postIndex, postId] of postIds.entries()) {
      for (let commentIndex = 0; commentIndex < 2; commentIndex += 1) {
        const commenterId = accountIds[(postIndex + commentIndex + 1) % accountIds.length];
        await database.execute(
          "INSERT INTO networking_comments (post_id, user_id, body) VALUES (?, ?, ?)",
          [postId, commenterId, commentBodies[(postIndex + commentIndex) % commentBodies.length]],
        );
      }
      for (let reactionIndex = 0; reactionIndex < 4; reactionIndex += 1) {
        const reactorId = accountIds[(postIndex + reactionIndex + 2) % accountIds.length];
        const reaction = ["like", "celebrate", "insightful", "like"][reactionIndex];
        await database.execute(
          "INSERT INTO networking_reactions (post_id, user_id, reaction) VALUES (?, ?, ?)",
          [postId, reactorId, reaction],
        );
      }
    }

    for (let index = 0; index < accountIds.length; index += 1) {
      const first = accountIds[index];
      const second = accountIds[(index + 1) % accountIds.length];
      const lowId = Math.min(first, second);
      const highId = Math.max(first, second);
      await database.execute(
        `INSERT INTO networking_connections (user_low_id, user_high_id, requester_id, status)
         VALUES (?, ?, ?, 'accepted')`,
        [lowId, highId, lowId],
      );
    }

    for (let seekerIndex = 2; seekerIndex < accountIds.length; seekerIndex += 1) {
      const firstJobIndex = (seekerIndex - 2) % jobIds.length;
      const secondJobIndex = (firstJobIndex + 1) % jobIds.length;
      for (const jobIndex of [firstJobIndex, secondJobIndex]) {
        await database.execute(
          `INSERT INTO applications (user_id, job_id, cover_letter)
           VALUES (?, ?, ?)`,
          [
            accountIds[seekerIndex],
            jobIds[jobIndex],
            "DEMO APPLICATION — fictional application created to test the local CareerVerse workflow. This is not a real candidacy.",
          ],
        );
        await database.execute(
          "INSERT INTO saved_jobs (user_id, job_id) VALUES (?, ?)",
          [accountIds[seekerIndex], jobIds[jobIndex]],
        );
      }
    }

    await database.commit();
    transactionStarted = false;
    console.log("Created 10 fictional demo accounts, 2 demo company profiles, 4 clearly labelled demo jobs, 10 demo posts, 20 comments, 40 reactions, 10 connections, and 16 applications/saved-job records.");
    console.log("Demo account credentials were written to var/careerverse-demo-credentials.txt.");
    console.log("All records are in the guarded local careerverse_ai database; no live service was contacted.");
  } catch (error) {
    if (transactionStarted) await database.rollback();
    if (credentialsCreated) await unlink(CREDENTIALS_PATH).catch(() => {});
    throw error;
  } finally {
    await database.end();
  }
}

main().catch((error) => {
  console.error(`Demo seeding failed: ${error instanceof Error ? error.message : "Unexpected error."}`);
  process.exitCode = 1;
});
