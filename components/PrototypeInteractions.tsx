"use client";

import { useEffect, type FormEvent } from "react";
import { usePathname } from "next/navigation";

type ResumeDraft = {
  fields: Record<string, string>;
  experiences: Experience[];
  education: Education[];
};

type Experience = {
  title: string;
  company: string;
  dates: string;
  impact: string;
};

type Education = {
  degree: string;
  school: string;
  dates: string;
  location: string;
};

function isExperience(value: unknown): value is Experience {
  return (
    typeof value === "object" &&
    value !== null &&
    "title" in value &&
    "company" in value &&
    "dates" in value &&
    "impact" in value &&
    typeof value.title === "string" &&
    typeof value.company === "string" &&
    typeof value.dates === "string" &&
    typeof value.impact === "string"
  );
}

function isEducation(value: unknown): value is Education {
  return (
    typeof value === "object" &&
    value !== null &&
    "degree" in value &&
    "school" in value &&
    "dates" in value &&
    "location" in value &&
    typeof value.degree === "string" &&
    typeof value.school === "string" &&
    typeof value.dates === "string" &&
    typeof value.location === "string"
  );
}

function showToast(message: string) {
  let toast = document.querySelector<HTMLElement>("#careerverse-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "careerverse-toast";
    toast.className = "site-toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    document.body.append(toast);
  }

  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(Number(toast.dataset.timeout));
  const timeout = window.setTimeout(() => toast?.classList.remove("visible"), 2800);
  toast.dataset.timeout = String(timeout);
}

function exportReport() {
  const metric = (selector: string, fallback: string) =>
    document.querySelector(selector)?.textContent?.trim() || fallback;
  const pipelineMetric = (label: string, fallback: string) =>
    [...document.querySelectorAll(".pipe-row")]
      .find((row) => row.textContent?.trim().toLowerCase().startsWith(label.toLowerCase()))
      ?.querySelector("b")?.textContent?.trim() || fallback;
  const rows = [
    ["Recruiting metric", "Value"],
    ["Open roles", metric(".stat4 .card:nth-child(1) .n", "8")],
    ["Applicants this week", metric(".stat4 .card:nth-child(2) .n", "156")],
    ["Screened", pipelineMetric("Screened", "64")],
    ["Shortlisted", pipelineMetric("Shortlisted", "0")],
    ["Interviews scheduled", metric(".stat4 .card:nth-child(3) .n", "11")],
    ["Offers extended", metric(".stat4 .card:nth-child(4) .n", "3")],
    ["Average time to hire", "18 days"],
    ["Screening accuracy", "94/100"],
  ];
  const csv = rows
    .map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(","))
    .join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "careerverse-recruiter-hiring-report.csv";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("Report downloaded.");
}

function bindResumeBuilder() {
  const page = document.querySelector<HTMLElement>(".resume-builder-page");
  if (!page) return () => {};

  const editor = page.querySelector(".split > .card");
  const preview = page.querySelector<HTMLElement>(".resume-preview");
  if (!editor || !preview) return () => {};

  const inputFields = [...editor.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-resume-field]")];
  const experienceList = editor.querySelector<HTMLElement>("[data-experience-list]");
  const educationList = editor.querySelector<HTMLElement>("[data-education-list]");
  const previewExperience = preview.querySelector<HTMLElement>("[data-preview-experience]");
  const previewEducation = preview.querySelector<HTMLElement>("[data-preview-education]");
  if (!experienceList || !educationList || !previewExperience || !previewEducation) return () => {};
  const key = "careerverse-next-resume-draft";

  const readExperience = (entry: Element): Experience => ({
    title: entry.querySelector<HTMLInputElement>("[data-experience-title]")?.value.trim() ?? "",
    company: entry.querySelector<HTMLInputElement>("[data-experience-company]")?.value.trim() ?? "",
    dates: entry.querySelector<HTMLInputElement>("[data-experience-dates]")?.value.trim() ?? "",
    impact: entry.querySelector<HTMLTextAreaElement>("[data-experience-impact]")?.value.trim() ?? "",
  });
  const readEducation = (entry: Element): Education => ({
    degree: entry.querySelector<HTMLInputElement>("[data-education-degree]")?.value.trim() ?? "",
    school: entry.querySelector<HTMLInputElement>("[data-education-school]")?.value.trim() ?? "",
    dates: entry.querySelector<HTMLInputElement>("[data-education-dates]")?.value.trim() ?? "",
    location: entry.querySelector<HTMLInputElement>("[data-education-location]")?.value.trim() ?? "",
  });

  const addEntry = (list: HTMLElement, selector: string, removeLabel: string) => {
    const template = list.querySelector<HTMLElement>(selector);
    if (!template) return null;
    const entry = template.cloneNode(true) as HTMLElement;
    entry.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea").forEach((field) => {
      field.value = "";
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "entry-remove";
    remove.textContent = removeLabel;
    entry.append(remove);
    list.append(entry);
    return entry;
  };

  const setExperience = (entry: Element, value: Experience) => {
    const title = entry.querySelector<HTMLInputElement>("[data-experience-title]");
    const company = entry.querySelector<HTMLInputElement>("[data-experience-company]");
    const dates = entry.querySelector<HTMLInputElement>("[data-experience-dates]");
    const impact = entry.querySelector<HTMLTextAreaElement>("[data-experience-impact]");
    if (title) title.value = value.title;
    if (company) company.value = value.company;
    if (dates) dates.value = value.dates;
    if (impact) impact.value = value.impact;
  };

  const setEducation = (entry: Element, value: Education) => {
    const degree = entry.querySelector<HTMLInputElement>("[data-education-degree]");
    const school = entry.querySelector<HTMLInputElement>("[data-education-school]");
    const dates = entry.querySelector<HTMLInputElement>("[data-education-dates]");
    const location = entry.querySelector<HTMLInputElement>("[data-education-location]");
    if (degree) degree.value = value.degree;
    if (school) school.value = value.school;
    if (dates) dates.value = value.dates;
    if (location) location.value = value.location;
  };

  const updatePreview = () => {
    const values = Object.fromEntries(inputFields.map((field) => [field.dataset.resumeField ?? "", field.value.trim()]));
    const experiences = [...experienceList.querySelectorAll(".experience-entry")].map(readExperience);
    const education = [...educationList.querySelectorAll(".education-entry")].map(readEducation);
    const skills = (values.skills ?? "").split(",").map((skill) => skill.trim()).filter(Boolean);
    const heading = preview.querySelector("h3");
    const rolePreview = preview.querySelector<HTMLElement>(".rp-role");
    const contact = preview.querySelector<HTMLElement>(".rp-contact");

    if (heading) heading.textContent = values.name || "Your name";
    if (rolePreview) rolePreview.textContent = values.role || "Target role";
    if (contact) contact.textContent = [values.email, values.phone, values.location].filter(Boolean).join(" · ");
    const summary = preview.querySelector<HTMLElement>(".rp-summary");
    if (summary) summary.textContent = values.summary ?? "";
    previewExperience.replaceChildren();
    experiences.filter((item) => Object.values(item).some(Boolean)).forEach((item) => {
      const row = document.createElement("div");
      row.className = "rp-item";
      const title = document.createElement("b");
      title.textContent = [item.title, item.company].filter(Boolean).join(" — ");
      const meta = document.createElement("div");
      meta.className = "rp-meta";
      meta.textContent = item.dates;
      const impact = document.createElement("span");
      impact.textContent = item.impact;
      row.append(title, meta, impact);
      previewExperience.append(row);
    });
    previewEducation.replaceChildren();
    education.filter((item) => Object.values(item).some(Boolean)).forEach((item) => {
      const row = document.createElement("div");
      row.className = "rp-item";
      const title = document.createElement("b");
      title.textContent = [item.degree, item.school].filter(Boolean).join(" — ");
      const meta = document.createElement("div");
      meta.className = "rp-meta";
      meta.textContent = [item.dates, item.location].filter(Boolean).join(" · ");
      row.append(title, meta);
      previewEducation.append(row);
    });

    const skillsHeading = [...preview.querySelectorAll("h4")].find((item) => item.textContent === "Skills");
    preview.querySelectorAll(".rp-skill-chip").forEach((chip) => chip.remove());
    const chips = skills.map((skill) => {
      const chip = document.createElement("span");
      chip.className = "rp-skill-chip";
      chip.textContent = skill;
      return chip;
    });
    skillsHeading?.after(...chips);

    const hasImpact = experiences.some((item) => item.impact);
    const score = Math.min(
      98,
      45 +
        skills.length * 4 +
        (hasImpact ? 12 : 0) +
        (values.name && values.role ? 8 : 0) +
        (education.some((item) => item.degree || item.school) ? 8 : 0) +
        (values.summary ? 8 : 0),
    );
    const gauge = page.querySelector<HTMLElement>(".ats-gauge");
    const scoreValue = gauge?.querySelector("b");
    if (scoreValue) scoreValue.textContent = String(score);
    if (gauge) gauge.style.background = `conic-gradient(var(--green) 0 ${score}%, #E9E7F7 ${score}% 100%)`;
  };

  try {
    const saved = window.localStorage.getItem(key);
    if (saved) {
      const draft: unknown = JSON.parse(saved);
      if (draft && typeof draft === "object" && "fields" in draft) {
        if (Array.isArray(draft.fields)) {
          const legacyFields = draft.fields;
          const legacyFieldIndexes: Record<string, number> = {
            name: 0,
            role: 1,
            email: 2,
            phone: 3,
            location: 4,
            skills: 7,
          };
          inputFields.forEach((field) => {
            const index = legacyFieldIndexes[field.dataset.resumeField ?? ""];
            if (index !== undefined && typeof legacyFields[index] === "string") field.value = legacyFields[index];
          });
          const legacyExperience = experienceList.querySelector(".experience-entry");
          const title = legacyExperience?.querySelector<HTMLInputElement>("[data-experience-title]");
          const company = legacyExperience?.querySelector<HTMLInputElement>("[data-experience-company]");
          if (title && typeof legacyFields[5] === "string") title.value = legacyFields[5];
          if (company && typeof legacyFields[6] === "string") company.value = legacyFields[6];
        } else if (draft.fields && typeof draft.fields === "object") {
          const fields = draft.fields as Record<string, unknown>;
          inputFields.forEach((field) => {
            const value = fields[field.dataset.resumeField ?? ""];
            if (typeof value === "string") field.value = value;
          });
        }
        const stored = draft as Partial<ResumeDraft>;
        const experiences = Array.isArray(stored.experiences) ? stored.experiences.filter(isExperience) : [];
        if (experiences.length) {
          experiences.slice(1).forEach(() => addEntry(experienceList, ".experience-entry", "Remove experience"));
          [...experienceList.querySelectorAll(".experience-entry")].forEach((entry, index) => {
            const item = experiences[index];
            if (item) setExperience(entry, item);
          });
        }
        const education = Array.isArray(stored.education) ? stored.education.filter(isEducation) : [];
        if (education.length) {
          education.slice(1).forEach(() => addEntry(educationList, ".education-entry", "Remove education"));
          [...educationList.querySelectorAll(".education-entry")].forEach((entry, index) => {
            const item = education[index];
            if (item) setEducation(entry, item);
          });
        }
      }
    }
  } catch (error) {
    console.error("Unable to restore the resume draft.", error);
    showToast("Saved resume draft could not be read.");
  }
  updatePreview();

  const onInput = () => updatePreview();
  editor.addEventListener("input", onInput);

  const onClick = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest("button, a");
    if (!button) return;
    const label = button.textContent?.trim().toLowerCase() ?? "";

    if (label.includes("save draft")) {
      event.preventDefault();
      try {
        const draft: ResumeDraft = {
          fields: Object.fromEntries(inputFields.map((field) => [field.dataset.resumeField ?? "", field.value])),
          experiences: [...experienceList.querySelectorAll(".experience-entry")].map(readExperience),
          education: [...educationList.querySelectorAll(".education-entry")].map(readEducation),
        };
        window.localStorage.setItem(key, JSON.stringify(draft));
        showToast("Resume draft saved on this device.");
      } catch (error) {
        console.error("Unable to save the resume draft.", error);
        showToast("Resume draft could not be saved. Check browser storage settings.");
      }
    } else if (label.includes("generate with ai")) {
      event.preventDefault();
      const suggestion = page.querySelector(".assist-card p");
      if (suggestion) {
        suggestion.textContent =
          "Writing tip: keep your impact statement specific, truthful, and measurable. AI review is not connected in this prototype.";
      }
      showToast("Resume review tip updated.");
    } else if (label.includes("apply suggestion")) {
      event.preventDefault();
      editor.querySelector<HTMLTextAreaElement>("[data-experience-impact]")?.focus();
      showToast("Add a truthful metric or outcome to your experience.");
    } else if (label.includes("download pdf")) {
      event.preventDefault();
      window.print();
    } else if (button.matches("[data-add-experience]")) {
      event.preventDefault();
      addEntry(experienceList, ".experience-entry", "Remove experience");
      updatePreview();
      showToast("Experience section added. Complete the new fields before saving.");
    } else if (button.matches("[data-add-education]")) {
      event.preventDefault();
      addEntry(educationList, ".education-entry", "Remove education");
      updatePreview();
      showToast("Education section added.");
    } else if (button.matches(".entry-remove")) {
      event.preventDefault();
      button.closest(".experience-entry, .education-entry")?.remove();
      updatePreview();
    } else if (button.matches("[data-download-pdf]")) {
      event.preventDefault();
      window.print();
    }
  };
  editor.addEventListener("click", onClick);

  return () => {
    editor.removeEventListener("input", onInput);
    editor.removeEventListener("click", onClick);
  };
}

export default function PrototypeInteractions() {
  const pathname = usePathname();
  const isReportPage = pathname === "/recruiter-dashboard";

  useEffect(() => {
    const unbindResume = bindResumeBuilder();

    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest<HTMLAnchorElement>('a[href="#"]');
      if (link) {
        const popular = link.closest(".popular");
        if (popular && link.textContent?.trim().toLowerCase() !== "more") {
          const keyword = document.querySelector<HTMLInputElement>(".searchbar input");
          if (keyword) keyword.value = link.textContent?.trim() ?? "";
          event.preventDefault();
          return;
        }
        if (popular) {
          document.querySelector("#jobs")?.scrollIntoView({ behavior: "smooth" });
          event.preventDefault();
          return;
        }
        event.preventDefault();
        showToast("This feature is a prototype preview.");
        return;
      }

      const button = target.closest<HTMLButtonElement>("button");
      if (!button) return;
      const label = button.textContent?.trim().toLowerCase() ?? "";

      if (button.hasAttribute("data-export-report")) return;
      if (label.includes("export report")) {
        if (pathname === "/recruiter-dashboard") exportReport();
        return;
      }

      if (label.includes("search jobs") && pathname === "/") {
        const keyword = document.querySelector<HTMLInputElement>(".searchbar input");
        const location = document.querySelector<HTMLInputElement>(".searchbar input:nth-of-type(2)");
        const query = `${keyword?.value ?? ""} ${location?.value ?? ""}`.trim().toLowerCase();
        const jobs = [...document.querySelectorAll<HTMLElement>("#jobs .job-row")];
        let matches = 0;
        jobs.forEach((job) => {
          const visible = !query || query.split(/\s+/).every((word) => job.textContent?.toLowerCase().includes(word));
          job.hidden = !visible;
          if (visible) matches += 1;
        });
        document.querySelectorAll<HTMLElement>("#jobs .company-grid, #jobs .pair, #jobs>.wrap>div:not(:first-child)").forEach((block) => {
          block.hidden = Boolean(query);
        });
        showToast(matches ? `${matches} matching ${matches === 1 ? "job" : "jobs"} found.` : "No exact matches. Try a broader search.");
        document.querySelector("#jobs")?.scrollIntoView({ behavior: "smooth" });
        return;
      }

      if (label.includes("view matches") && pathname === "/") {
        document.querySelector("#jobs")?.scrollIntoView({ behavior: "smooth" });
        return;
      }

      if (button.matches("[data-open-post]")) return;
      if (pathname === "/recruiter-dashboard" && label.includes("post a job")) {
        document.querySelector<HTMLDialogElement>("#post-job-dialog")?.showModal();
        return;
      }

      if (pathname === "/recruiter-dashboard" && label.includes("shortlist")) {
        button.textContent = "Shortlisted ✓";
        button.disabled = true;
        const candidate = button.closest(".jobmatch-row");
        const name = candidate?.querySelector(".job-title")?.textContent ?? "Candidate";
        const pipeline = [...document.querySelectorAll(".pipe-row")].find((row) =>
          row.textContent?.toLowerCase().includes("shortlisted"),
        );
        const count = pipeline?.querySelector("b");
        if (count) count.textContent = String(Number(count.textContent ?? 0) + 1);
        showToast(`${name} added to the shortlist.`);
        return;
      }

      if (pathname === "/" && /easy apply/i.test(button.textContent ?? "")) {
        button.textContent = "Applied ✓";
        button.disabled = true;
        const applicationCount = document.querySelector(".stat4 .card:nth-child(2) .n");
        if (applicationCount) applicationCount.textContent = String(Number(applicationCount.textContent ?? 0) + 1);
        const appliedStage = [...document.querySelectorAll(".pipe-row")].find((row) =>
          row.textContent?.trim().toLowerCase().startsWith("applied"),
        );
        const stageCount = appliedStage?.querySelector("b");
        if (stageCount) stageCount.textContent = String(Number(stageCount.textContent ?? 0) + 1);
        showToast("Application added to your pipeline.");
        return;
      }

      if (label.includes("subscribe")) {
        const email = button.closest(".nform")?.querySelector<HTMLInputElement>('input[type="email"]');
        if (!email || !email.reportValidity()) return;
        email.value = "";
        showToast("Thanks for subscribing to CareerVerse updates.");
      }
    };

    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("click", onClick);
      unbindResume();
    };
  }, [pathname]);

  return (
    <>
      {isReportPage && (
        <div className="route-actions wrap">
          {pathname === "/recruiter-dashboard" && (
            <button
              className="btn btn-violet"
              type="button"
              data-open-post
              onClick={() => document.querySelector<HTMLDialogElement>("#post-job-dialog")?.showModal()}
            >
              + Post a job
            </button>
          )}
          <button className="btn btn-line" type="button" data-export-report onClick={() => exportReport()}>
            Export report
          </button>
        </div>
      )}
      {pathname === "/recruiter-dashboard" && (
        <dialog className="post-job-dialog" id="post-job-dialog" aria-labelledby="post-job-title">
          <form
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              const form = event.currentTarget;
              const values = new FormData(form);
              const title = String(values.get("title") ?? "").trim();
              const company = String(values.get("company") ?? "").trim();
              const location = String(values.get("location") ?? "").trim();
              const row = document.createElement("div");
              row.className = "pipe-row";
              const role = document.createElement("span");
              role.textContent = `${title} · ${company} · ${location}`;
              const status = document.createElement("b");
              status.textContent = "Draft";
              row.append(role, status);
              document.querySelector(".pipe-row")?.parentElement?.append(row);
              const openRoles = document.querySelector(".stat4 .n");
              if (openRoles) openRoles.textContent = String(Number(openRoles.textContent ?? 0) + 1);
              form.reset();
              document.querySelector<HTMLDialogElement>("#post-job-dialog")?.close();
              showToast(`${title} added as a draft role.`);
            }}
          >
            <h2 id="post-job-title">Post a job</h2>
            <p>Add a draft role to your hiring pipeline.</p>
            <label>Job title<input name="title" required maxLength={80} /></label>
            <label>Company<input name="company" required maxLength={80} /></label>
            <label>Location<input name="location" required maxLength={80} /></label>
            <div className="dialog-actions">
              <button className="btn btn-line" type="button" onClick={() => document.querySelector<HTMLDialogElement>("#post-job-dialog")?.close()}>Cancel</button>
              <button className="btn btn-violet" type="submit">Save draft</button>
            </div>
          </form>
        </dialog>
      )}
    </>
  );
}
