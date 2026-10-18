export type CareerJob = {
  id?: number;
  slug: string;
  title: string;
  company: string;
  initials: string;
  location: string;
  type: "Full-time" | "Part-time" | "Contract" | "Internship" | "Temporary" | "Hybrid" | "Remote";
  experience: string;
  match: number | null;
  salary: string;
  posted: string;
  description: string;
  requirements: string[];
  countryCode: string;
  workplaceType: "onsite" | "hybrid" | "remote";
  sourceType: "government" | "private";
  sourceName: string;
  sourceUrl: string | null;
  applyUrl: string | null;
  isSample: boolean;
  external: boolean;
};

export const careerJobs: CareerJob[] = [
  {
    slug: "senior-software-engineer",
    title: "Senior Software Engineer",
    company: "bKash Limited",
    initials: "bK",
    location: "Dhaka, Bangladesh",
    type: "Full-time",
    experience: "3–8 years",
    match: null,
    salary: "৳120K–180K / month",
    posted: "2h ago",
    description: "Design and build reliable backend services for high-traffic digital products. Partner with product, design, and security teams to deliver thoughtful experiences at scale.",
    requirements: ["3+ years of professional software engineering experience", "Strong skills in Node.js or Java and relational databases", "Experience building APIs and production services", "Clear communication and collaborative problem-solving"],
    countryCode: "BD",
    workplaceType: "onsite",
    sourceType: "private",
    sourceName: "CareerVerse sample",
    sourceUrl: null,
    applyUrl: null,
    isSample: true,
    external: false,
  },
  {
    slug: "data-analyst",
    title: "Data Analyst",
    company: "BRAC Net",
    initials: "BR",
    location: "Dhaka, Bangladesh",
    type: "Hybrid",
    experience: "1–3 years",
    match: null,
    salary: "৳55K–90K / month",
    posted: "5h ago",
    description: "Help teams make better decisions by turning complex data into clear insights, useful dashboards, and recommendations that move the business forward.",
    requirements: ["Experience with SQL and data visualization", "Comfort working with spreadsheets and large datasets", "Strong analytical thinking and attention to detail", "Ability to present findings to non-technical partners"],
    countryCode: "BD",
    workplaceType: "hybrid",
    sourceType: "private",
    sourceName: "CareerVerse sample",
    sourceUrl: null,
    applyUrl: null,
    isSample: true,
    external: false,
  },
  {
    slug: "product-manager",
    title: "Product Manager",
    company: "Daraz Bangladesh",
    initials: "DZ",
    location: "Dhaka, Bangladesh",
    type: "Full-time",
    experience: "2–7 years",
    match: null,
    salary: "৳100K–160K / month",
    posted: "10h ago",
    description: "Bring customer needs and business goals together to shape a product roadmap. Work with engineering and design from discovery through launch and iteration.",
    requirements: ["Experience delivering digital products", "Strong customer research and prioritization skills", "Comfort working with product analytics", "Excellent written and verbal communication"],
    countryCode: "BD",
    workplaceType: "onsite",
    sourceType: "private",
    sourceName: "CareerVerse sample",
    sourceUrl: null,
    applyUrl: null,
    isSample: true,
    external: false,
  },
  {
    slug: "ux-ui-designer",
    title: "UI/UX Designer",
    company: "Creative Institute",
    initials: "CI",
    location: "Remote · Bangladesh",
    type: "Remote",
    experience: "1–3 years",
    match: null,
    salary: "৳60K–100K / month",
    posted: "1d ago",
    description: "Create intuitive digital experiences from early concepts to detailed interface designs. Collaborate with product and engineering to make every interaction feel clear and considered.",
    requirements: ["A portfolio showing thoughtful digital product work", "Proficiency with Figma and prototyping", "Understanding of responsive and accessible design", "Comfort sharing work and incorporating feedback"],
    countryCode: "BD",
    workplaceType: "remote",
    sourceType: "private",
    sourceName: "CareerVerse sample",
    sourceUrl: null,
    applyUrl: null,
    isSample: true,
    external: false,
  },
  {
    slug: "digital-marketing-executive",
    title: "Digital Marketing Executive",
    company: "ACI Limited",
    initials: "AC",
    location: "Dhaka, Bangladesh",
    type: "Full-time",
    experience: "0–2 years",
    match: null,
    salary: "৳40K–65K / month",
    posted: "1d ago",
    description: "Support digital campaigns across channels, learn from performance data, and help create useful content for a growing range of customer audiences.",
    requirements: ["Interest in digital marketing and campaign execution", "Basic knowledge of social and search platforms", "Strong writing and organizational skills", "A curious, data-informed approach to learning"],
    countryCode: "BD",
    workplaceType: "onsite",
    sourceType: "private",
    sourceName: "CareerVerse sample",
    sourceUrl: null,
    applyUrl: null,
    isSample: true,
    external: false,
  },
  {
    slug: "backend-developer",
    title: "Backend Developer (Node.js)",
    company: "Pathao",
    initials: "Pa",
    location: "Remote · Bangladesh",
    type: "Remote",
    experience: "2–5 years",
    match: null,
    salary: "৳90K–150K / month",
    posted: "2d ago",
    description: "Build dependable services that support products used every day. Work with an experienced engineering team on APIs, data stores, and the systems behind a seamless customer experience.",
    requirements: ["Professional experience with Node.js", "Familiarity with API design and SQL or NoSQL data stores", "Understanding of testing, code review, and deployment workflows", "A thoughtful approach to reliability and maintainability"],
    countryCode: "BD",
    workplaceType: "remote",
    sourceType: "private",
    sourceName: "CareerVerse sample",
    sourceUrl: null,
    applyUrl: null,
    isSample: true,
    external: false,
  },
  {
    slug: "software-engineering-intern",
    title: "Software Engineering Intern",
    company: "CareerVerse Example Employer",
    initials: "CV",
    location: "Remote · Bangladesh",
    type: "Internship",
    experience: "Entry level",
    match: null,
    salary: "Compensation not provided",
    posted: "Sample listing",
    description: "A fictional sample internship listing used to demonstrate internship and remote filters. This is not an open vacancy.",
    requirements: ["Currently studying software engineering or a related field", "Basic programming fundamentals", "Curiosity and willingness to learn"],
    countryCode: "BD",
    workplaceType: "remote",
    sourceType: "private",
    sourceName: "CareerVerse sample",
    sourceUrl: null,
    applyUrl: null,
    isSample: true,
    external: false,
  },
];

export function getCareerJob(slug: string): CareerJob | undefined {
  return careerJobs.find((job) => job.slug === slug);
}
