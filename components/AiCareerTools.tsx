"use client";

import { useEffect, useState, type FormEvent } from "react";

type ToolId = "coach" | "resume" | "cover-letter" | "interview" | "skill-gap" | "career-path";
type ToolField = { name: string; label: string; placeholder: string; required?: boolean; rows?: number };
type ChatMessage = { role: "user" | "assistant"; content: string };
type ProviderStatus = "checking" | "configured" | "model-missing" | "offline" | "sign-in" | "unavailable";

const tools: Array<{
  id: ToolId;
  number: string;
  name: string;
  summary: string;
  fields: ToolField[];
  button: string;
}> = [
  {
    id: "coach",
    number: "01",
    name: "AI Career Coach",
    summary: "Get practical guidance for a real career decision, challenge, or next step.",
    fields: [
      { name: "context", label: "A little context (optional)", placeholder: "Your situation, goals, or constraints", rows: 3 },
      { name: "question", label: "What would you like help with?", placeholder: "Ask a specific career question", required: true, rows: 3 },
    ],
    button: "Ask your coach",
  },
  {
    id: "resume",
    number: "02",
    name: "Resume Builder & Analyzer",
    summary: "Turn your own experience into a clear resume draft and get an honest, job-specific review.",
    fields: [
      { name: "targetRole", label: "Target role", placeholder: "e.g. Product Designer", required: true },
      { name: "jobDescription", label: "Target job description (optional)", placeholder: "Paste a job description to tailor the review", rows: 4 },
      { name: "resumeText", label: "Your resume or factual career notes", placeholder: "Add experience, dates, education, skills, projects, and real achievements. Omit email, phone, and home address.", required: true, rows: 9 },
    ],
    button: "Analyze and build my resume",
  },
  {
    id: "cover-letter",
    number: "03",
    name: "Cover Letter Generation",
    summary: "Create a tailored letter grounded in the role and your real qualifications.",
    fields: [
      { name: "targetRole", label: "Role title", placeholder: "e.g. Customer Success Manager", required: true },
      { name: "company", label: "Company", placeholder: "Company name", required: true },
      { name: "jobDescription", label: "Job description", placeholder: "Paste the role's requirements and responsibilities", required: true, rows: 5 },
      { name: "experienceFacts", label: "Your relevant experience and achievements", placeholder: "Only include true experience, skills, and results", required: true, rows: 5 },
    ],
    button: "Draft my cover letter",
  },
  {
    id: "interview",
    number: "04",
    name: "Interview Simulation",
    summary: "Practice a role-specific interview, one question at a time, with useful feedback.",
    fields: [
      { name: "targetRole", label: "Role you are interviewing for", placeholder: "e.g. Backend Engineer", required: true },
      { name: "jobDescription", label: "Job description (optional)", placeholder: "Add role details for more focused questions", rows: 4 },
    ],
    button: "Start interview practice",
  },
  {
    id: "skill-gap",
    number: "05",
    name: "Skill Gap Analysis",
    summary: "Compare your current skills with a target role and get a staged learning plan.",
    fields: [
      { name: "targetRole", label: "Target role", placeholder: "e.g. Data Analyst", required: true },
      { name: "currentSkills", label: "Current skills and tools", placeholder: "List what you can genuinely use today", required: true, rows: 4 },
      { name: "experience", label: "Relevant experience (optional)", placeholder: "Projects, responsibilities, or years in the field", rows: 4 },
    ],
    button: "Analyze my skill gaps",
  },
  {
    id: "career-path",
    number: "06",
    name: "Career Path Prediction",
    summary: "Explore plausible next roles, trade-offs, and concrete steps based on what you share.",
    fields: [
      { name: "currentRole", label: "Current role or situation", placeholder: "Include if you are studying, changing careers, or between roles", required: true },
      { name: "experience", label: "Experience so far", placeholder: "Relevant work, projects, or education", required: true, rows: 3 },
      { name: "skills", label: "Skills", placeholder: "Your current skills and strengths", required: true, rows: 3 },
      { name: "interests", label: "Interests and priorities", placeholder: "Work you enjoy, values, constraints, or goals", required: true, rows: 3 },
    ],
    button: "Explore possible paths",
  },
];

export default function AiCareerTools() {
  const [selectedId, setSelectedId] = useState<ToolId>("coach");
  const [values, setValues] = useState<Record<string, string>>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [interviewAnswer, setInterviewAnswer] = useState("");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus>("checking");
  const [providerModel, setProviderModel] = useState("qwen2.5:3b");
  const tool = tools.find((item) => item.id === selectedId) ?? tools[0];
  const isConversation = selectedId === "coach" || selectedId === "interview";
  const interviewStarted = selectedId === "interview" && messages.length > 0;

  useEffect(() => {
    let active = true;
    fetch("/api/ai/tools", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) return { status: "sign-in" as const, model: null };
        if (!response.ok) return { status: "unavailable" as const, model: null };
        const payload: unknown = await response.json();
        if (typeof payload !== "object" || payload === null || !("configured" in payload)) {
          return { status: "unavailable" as const, model: null };
        }
        const model = "model" in payload && typeof payload.model === "string" ? payload.model : null;
        if (payload.configured === true) return { status: "configured" as const, model };
        if ("status" in payload && payload.status === "model-not-installed") return { status: "model-missing" as const, model };
        if ("status" in payload && payload.status === "service-unavailable") return { status: "offline" as const, model };
        return { status: "unavailable" as const, model };
      })
      .then((provider) => {
        if (active) {
          setProviderStatus(provider.status);
          if (provider.model) setProviderModel(provider.model);
        }
      })
      .catch(() => {
        if (active) setProviderStatus("unavailable");
      });
    return () => { active = false; };
  }, []);

  function selectTool(id: ToolId) {
    setSelectedId(id);
    setValues({});
    setMessages([]);
    setInterviewAnswer("");
    setResult("");
    setError("");
    setConsent(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    if (!consent) {
      setError("Confirm local AI processing before using a live AI tool.");
      return;
    }
    const data = { ...values };
    const history =
      selectedId === "coach"
        ? [...messages.slice(-3), { role: "user" as const, content: values.question ?? "" }]
        : selectedId === "interview" && interviewStarted
          ? [...messages.slice(-3), { role: "user" as const, content: interviewAnswer.trim() }]
          : [];
    if (selectedId === "interview" && interviewStarted && !interviewAnswer.trim()) {
      setError("Enter your answer before asking for interview feedback.");
      return;
    }
    setBusy(true);
    setError("");
    setConsent(false);
    try {
      const response = await fetch("/api/ai/tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ tool: selectedId, data, history, consent: true }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string"
            ? payload.error
            : "The AI request could not be completed.";
        throw new Error(message);
      }
      if (typeof payload !== "object" || payload === null || !("result" in payload) || typeof payload.result !== "string") {
        throw new Error("The AI service returned an invalid response.");
      }
      const answer = payload.result;
      if (isConversation) {
        setMessages((current) => {
          const userTurn =
            selectedId === "coach"
              ? { role: "user" as const, content: values.question ?? "" }
              : selectedId === "interview" && interviewStarted
                ? { role: "user" as const, content: interviewAnswer.trim() }
                : null;
          return [...current, ...(userTurn ? [userTurn] : []), { role: "assistant", content: answer }];
        });
        if (selectedId === "coach") {
          setValues((current) => ({ ...current, question: "" }));
        }
        if (selectedId === "interview") setInterviewAnswer("");
      } else {
        setResult(answer);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The AI request could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  async function copyResult() {
    try {
      await navigator.clipboard.writeText(result);
    } catch {
      setError("Copy was blocked by the browser. Select the result and copy it manually.");
    }
  }

  function downloadResult() {
    const file = new Blob([result], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = selectedId === "resume" ? "careerverse-resume-draft.txt" : "careerverse-ai-result.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="ai-tools-page">
      <div className="wrap">
        <header className="ai-tools-heading">
          <span className="section-kicker">YOUR CAREER, WITH REAL AI SUPPORT</span>
          <h1>AI career tools</h1>
          <p>Get practical, locally generated guidance grounded in your real goals and experience.</p>
        </header>

        <div className="ai-tools-layout">
          <nav className="ai-tool-list" aria-label="Choose a career tool">
            {tools.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`ai-tool-choice${item.id === selectedId ? " ai-tool-choice-active" : ""}`}
                aria-pressed={item.id === selectedId}
                onClick={() => selectTool(item.id)}
              >
                <span className="ai-tool-number">{item.number}</span>
                <span><strong>{item.name}</strong><small>{item.summary}</small></span>
                <span className="ai-tool-arrow" aria-hidden="true">→</span>
              </button>
            ))}
          </nav>

          <section className="ai-tool-panel" aria-labelledby="active-ai-tool">
            <div className="ai-tool-panel-heading">
              <span className={`ai-tool-live${providerStatus !== "configured" && providerStatus !== "checking" ? " ai-tool-offline" : ""}`}>
                <i />
                {providerStatus === "checking" && "Checking AI provider setup…"}
                {providerStatus === "configured" && "Local AI model ready"}
                {providerStatus === "model-missing" && `Install local AI model: ollama pull ${providerModel}`}
                {providerStatus === "offline" && "Ollama is not running on this server"}
                {providerStatus === "sign-in" && "Sign in to use live AI tools"}
                {providerStatus === "unavailable" && "Start Ollama to use local AI"}
              </span>
              <h2 id="active-ai-tool">{tool.name}</h2>
              <p>{tool.summary}</p>
            </div>

            {isConversation && messages.length > 0 && (
              <div className="ai-conversation" aria-live="polite">
                {messages.map((message, index) => (
                  <article className={`ai-message ai-message-${message.role}`} key={`${message.role}-${index}`}>
                    <strong>{message.role === "assistant" ? "CareerVerse AI" : "You"}</strong>
                    <p>{message.content}</p>
                  </article>
                ))}
              </div>
            )}

            <form className="ai-tool-form" onSubmit={(event) => void submit(event)}>
              {tool.fields.map((field) => (
                <label className="ai-tool-field" key={field.name}>
                  <span>{field.label}</span>
                  {field.rows ? (
                    <textarea
                      name={field.name}
                      rows={field.rows}
                      value={values[field.name] ?? ""}
                      maxLength={field.name === "resumeText" ? 8_000 : field.name === "question" ? 2_500 : 4_000}
                      required={field.required}
                      placeholder={field.placeholder}
                      onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
                    />
                  ) : (
                    <input
                      name={field.name}
                      value={values[field.name] ?? ""}
                      maxLength={field.name === "targetRole" ? 160 : 240}
                      required={field.required}
                      placeholder={field.placeholder}
                      onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
                    />
                  )}
                </label>
              ))}

              {selectedId === "interview" && interviewStarted && (
                <label className="ai-tool-field">
                  <span>Your answer to the latest question</span>
                  <textarea
                    value={interviewAnswer}
                    onChange={(event) => setInterviewAnswer(event.target.value)}
                    maxLength={2_500}
                    rows={5}
                    required
                    placeholder="Answer as you would in an interview. Be truthful; you can retry at any time."
                  />
                </label>
              )}

              <label className="ai-provider-consent">
                <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
                <span>
                  I agree to process the information entered here with the local AI model running on this CareerVerse server.
                </span>
              </label>

              {error && <p className="ai-tool-error" role="alert">{error}</p>}
              <button className="btn btn-violet" type="submit" disabled={busy}>
                {busy ? "Waiting for the AI service…" : selectedId === "interview" && !interviewStarted ? "Start interview practice" : tool.button}
              </button>
            </form>

            {result && !isConversation && (
              <section className="ai-result" aria-label="AI-generated result">
                <div className="ai-result-heading">
                  <div><span className="section-kicker">PROVIDER RESPONSE</span><h3>{selectedId === "resume" ? "Analysis and editable resume draft" : "Your generated draft"}</h3></div>
                  <div className="ai-result-actions">
                    <button type="button" className="btn btn-line" onClick={() => void copyResult()}>Copy</button>
                    <button type="button" className="btn btn-line" onClick={downloadResult}>Download text</button>
                  </div>
                </div>
                <textarea className="ai-result-editor" aria-label="Edit your AI-generated result" value={result} onChange={(event) => setResult(event.target.value)} rows={16} />
                <p>Review every detail before using it. The draft is not saved to CareerVerse; download or copy it if you want to keep it.</p>
              </section>
            )}

            <p className="ai-tool-privacy">
              Your text is processed by the local AI model on this CareerVerse server and is not sent to an external AI provider. CareerVerse does not save tool input or generated drafts. Avoid sensitive details. AI guidance can be wrong; verify facts and decisions yourself.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
