import Link from "next/link";

export default function Footer() {
  return (
    <footer>
      <div className="wrap foot-grid">
        <div>
          <div className="logo">
            <span className="mark">C</span>CareerVerse AI
          </div>
          <p>Your all-in-one platform for job search, networking, learning, and growth.</p>
        </div>
        <div>
          <h4>Explore</h4>
          <Link href="/jobs">Find Jobs</Link>
          <Link href="/companies">Companies</Link>
        </div>
        <div>
          <h4>Career tools</h4>
          <Link href="/ai-career-tools">AI career tools</Link>
          <Link href="/resume-builder">Resume builder</Link>
          <Link href="/university-portal">Academic Communities</Link>
        </div>
        <div>
          <h4>Professional network</h4>
          <Link href="/networking/feed">Career feed</Link>
          <Link href="/networking/connections">Connections</Link>
          <Link href="/networking/messages">Messages</Link>
          <Link href="/networking/profile">Your profile</Link>
        </div>
        <div>
          <h4>For Employers</h4>
          <Link href="/employer/jobs">Employer workspace</Link>
        </div>
      </div>
      <div className="foot-bottom">
        © {new Date().getFullYear()} CareerVerse AI. All rights reserved.
      </div>
    </footer>
  );
}
