import { useState, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router";
import { api, ApiError } from "~/lib/api";
import type { OpenRouterModel, ParsedProfile } from "~/lib/types";
import "../styles/settings.css";
import "../styles/onboarding.css";

type ValidationState = "idle" | "ok" | "err";

const AGENTS = [
  { key: "model_job_scout",       label: "JOB SCOUT",       hint: "Scrapes & parses job postings" },
  { key: "model_resume_tailor",   label: "RESUME TAILOR",   hint: "Rewrites resume for the role" },
  { key: "model_quality_analyst", label: "QUALITY ANALYST", hint: "Scores resume vs JD" },
  { key: "model_confirmation",    label: "CONFIRMATION",    hint: "Final pipeline verification" },
  { key: "model_orchestrator",    label: "ORCHESTRATOR",    hint: "Controls pipeline flow" },
] as const;

type AgentModelKey = typeof AGENTS[number]["key"];
type AgentModels = Record<AgentModelKey, string>;

const SENIORITY_OPTIONS = [
  { value: "", label: "— auto-detect —" },
  { value: "junior", label: "Junior" },
  { value: "mid", label: "Mid-Level" },
  { value: "senior", label: "Senior" },
  { value: "lead", label: "Lead" },
  { value: "staff", label: "Staff" },
  { value: "principal", label: "Principal" },
];

export default function Onboarding() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step 1 — Name
  const [displayName, setDisplayName] = useState("");

  // Step 2 — API Key
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [validation, setValidation] = useState<ValidationState>("idle");
  const [validating, setValidating] = useState(false);
  const [validationMsg, setValidationMsg] = useState(
    <>Awaiting validation — paste a key and click <b>VALIDATE KEY</b>.</>
  );

  // Step 3 — Model
  const [model, setModel] = useState("");
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [agentModelsOpen, setAgentModelsOpen] = useState(false);
  const [agentModels, setAgentModels] = useState<AgentModels>({
    model_job_scout: "",
    model_resume_tailor: "",
    model_quality_analyst: "",
    model_confirmation: "",
    model_orchestrator: "",
  });

  // Step 4 — Profile
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resumeUploading, setResumeUploading] = useState(false);
  const [resumeUploaded, setResumeUploaded] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const [profileFullName, setProfileFullName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [profilePhone, setProfilePhone] = useState("");
  const [profileLocation, setProfileLocation] = useState("");
  const [profileLinkedin, setProfileLinkedin] = useState("");
  const [profileWebsite, setProfileWebsite] = useState("");
  const [profileSummary, setProfileSummary] = useState("");
  const [profileYearsExp, setProfileYearsExp] = useState("");
  const [profileSeniority, setProfileSeniority] = useState("");
  const [profileSkills, setProfileSkills] = useState("");
  const [profileIndustries, setProfileIndustries] = useState("");

  // Launch
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  const currentStep = useMemo(() => {
    if (!displayName.trim()) return 0;
    if (validation !== "ok") return 1;
    if (!resumeUploaded) return 3;
    return 4;
  }, [displayName, validation, resumeUploaded]);

  const canLaunch = displayName.trim().length > 0
    && validation === "ok"
    && resumeUploaded
    && !modelsLoading;

  const setAgentModel = useCallback((key: AgentModelKey, value: string) => {
    setAgentModels((prev) => ({ ...prev, [key]: value }));
  }, []);

  // --- Handlers ---

  const handleValidate = async () => {
    const v = apiKey.trim();
    if (!v) {
      setValidation("err");
      setValidationMsg(<><b>NO KEY</b> — paste your OpenRouter key above first.</>);
      return;
    }
    if (!/^sk-or-/.test(v)) {
      setValidation("err");
      setValidationMsg(<><b>INVALID FORMAT</b> — OpenRouter keys start with <b>sk-or-</b>.</>);
      return;
    }
    setValidating(true);
    setValidation("idle");
    setValidationMsg(<>Validating key with OpenRouter…</>);
    setModelsError(null);
    try {
      const fetched = await api.openrouter.listModels(v);
      setModels(fetched);
      if (fetched.length > 0) setModel(fetched[0].id);
      setValidation("ok");
      setValidationMsg(
        <><b>CONNECTED</b> · {fetched.length} models available</>
      );
    } catch (e) {
      setValidation("err");
      if (e instanceof ApiError && e.status === 401) {
        setValidationMsg(<><b>INVALID KEY</b> — OpenRouter rejected this key. Check it at openrouter.ai/settings/keys.</>);
      } else {
        setValidationMsg(<><b>CONNECTION FAILED</b> — {e instanceof Error ? e.message : "Unknown error"}</>);
      }
    } finally {
      setValidating(false);
    }
  };

  const applyParsedProfile = (parsed: ParsedProfile) => {
    if (parsed.full_name) setProfileFullName(parsed.full_name);
    if (parsed.email) setProfileEmail(parsed.email);
    if (parsed.phone) setProfilePhone(parsed.phone);
    if (parsed.location) setProfileLocation(parsed.location);
    if (parsed.linkedin_url) setProfileLinkedin(parsed.linkedin_url);
    if (parsed.website_url) setProfileWebsite(parsed.website_url);
    if (parsed.summary) setProfileSummary(parsed.summary);
    if (parsed.years_experience != null) setProfileYearsExp(String(parsed.years_experience));
    if (parsed.target_seniority) setProfileSeniority(parsed.target_seniority);
    if (parsed.highlight_skills?.length) setProfileSkills(parsed.highlight_skills.join(", "));
    if (parsed.preferred_industries?.length) setProfileIndustries(parsed.preferred_industries.join(", "));
    if (parsed.full_name && !displayName.trim()) setDisplayName(parsed.full_name);
  };

  const handleResumeFile = async (file: File) => {
    const name = file.name.toLowerCase();
    if (!name.endsWith(".pdf") && !name.endsWith(".md") && !name.endsWith(".txt") && !name.endsWith(".text")) {
      setResumeError("Unsupported file type. Upload a PDF, Markdown (.md), or text (.txt) file.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setResumeError("File too large. Maximum size is 10 MB.");
      return;
    }

    setResumeFile(file);
    setResumeError(null);
    setResumeUploading(true);
    setResumeUploaded(false);

    try {
      await ensureProfile(displayName.trim() || "User");
      await api.profile.saveApiKey(apiKey.trim());

      // Save preferred model so LLM parse uses it
      if (model) {
        await api.profile.update({ preferred_model: model }).catch(() => {});
      }

      const result = await api.profile.uploadResume(file);
      setResumeUploaded(true);

      if (result.parsed) {
        applyParsedProfile(result.parsed);
      } else if (result.parse_error) {
        setResumeError(`Resume stored but auto-fill failed: ${result.parse_error}. Fill in your details manually.`);
      }
    } catch (e) {
      const msg = e instanceof ApiError
        ? `Upload failed (${e.status}): ${JSON.stringify((e.body as Record<string, unknown>)?.title ?? e.body)}`
        : e instanceof Error ? e.message : "Unknown error";
      setResumeError(msg);
    } finally {
      setResumeUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleResumeFile(file);
  };

  const ensureProfile = async (name: string) => {
    try {
      await api.profile.create({ display_name: name });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) return;
      throw e;
    }
  };

  const handleLaunch = async () => {
    if (!canLaunch) return;
    setLaunching(true);
    setLaunchError(null);
    try {
      await ensureProfile(displayName.trim());
      await api.profile.saveApiKey(apiKey.trim());

      const profileUpdate: Record<string, unknown> = {
        display_name: displayName.trim(),
      };
      if (model) profileUpdate.preferred_model = model;
      for (const agent of AGENTS) {
        const val = agentModels[agent.key];
        if (val) profileUpdate[agent.key] = val;
      }

      if (profileFullName) profileUpdate.full_name = profileFullName;
      if (profileEmail) profileUpdate.email = profileEmail;
      if (profilePhone) profileUpdate.phone = profilePhone;
      if (profileLocation) profileUpdate.location = profileLocation;
      if (profileLinkedin) profileUpdate.linkedin_url = profileLinkedin;
      if (profileWebsite) profileUpdate.website_url = profileWebsite;
      if (profileSummary) profileUpdate.summary = profileSummary;
      if (profileYearsExp) profileUpdate.years_experience = parseInt(profileYearsExp, 10) || null;
      if (profileSeniority) profileUpdate.target_seniority = profileSeniority;
      if (profileSkills) {
        profileUpdate.highlight_skills = profileSkills.split(",").map((s) => s.trim()).filter(Boolean);
      }
      if (profileIndustries) {
        profileUpdate.preferred_industries = profileIndustries.split(",").map((s) => s.trim()).filter(Boolean);
      }

      await api.profile.update(profileUpdate);

      localStorage.setItem("rendure_onboarded", "true");
      navigate("/");
    } catch (e) {
      const msg = e instanceof ApiError
        ? `API error (${e.status}): ${JSON.stringify(e.body)}`
        : e instanceof Error ? e.message : "Unknown error";
      setLaunchError(msg);
    } finally {
      setLaunching(false);
    }
  };

  const stepState = (idx: number): string => {
    if (idx < currentStep) return "done";
    if (idx === currentStep) return "active";
    return "pending";
  };

  return (
    <>
      <nav className="onboarding-nav">
        <div className="wordmark">
          <span className="dot" />
          RENDURE
        </div>
      </nav>

      <main className="page onboarding-page">
        {/* Hero */}
        <header className="ob-hero">
          <h1>SETUP</h1>
          <div className="ob-sub">
            <span>CONNECT YOUR AI PROVIDER AND UPLOAD YOUR RESUME</span>
            <span className="sep">·</span>
            <span><b>TAKES 2 MINUTES</b></span>
          </div>
        </header>

        {/* Progress */}
        <div className="ob-progress ob-progress-4">
          {[
            { num: "01", title: "Your Name" },
            { num: "02", title: "API Key" },
            { num: "03", title: "Model" },
            { num: "04", title: "Profile" },
          ].map((s, i) => (
            <span key={s.num} style={{ display: "contents" }}>
              {i > 0 && <div className="ob-connector" aria-hidden="true" />}
              <div className={`ob-step ${stepState(i)}`}>
                <span className="ob-num">{s.num}</span>
                <span className="ob-step-title">{s.title}</span>
                {currentStep === i && <span className="ob-tag">CURRENT</span>}
              </div>
            </span>
          ))}
        </div>

        {/* Section 01 — Your Name */}
        <section className="ob-section">
          <h2 className="sec-header">
            <span className="left"><span className="idx">01</span><span>YOUR NAME</span></span>
            <span className="hint">we'll use this in exports + pings</span>
          </h2>
          <div className="settings-field">
            <label className="settings-label" htmlFor="name">
              DISPLAY NAME
              <span className="req">REQUIRED</span>
            </label>
            <input
              id="name"
              className="settings-input"
              type="text"
              placeholder="e.g. Marcus Halloway"
              autoComplete="name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
            <p className="settings-help">How you'll appear in exported resume headers and notifications.</p>
          </div>
        </section>

        {/* Section 02 — AI Provider */}
        <section className="ob-section">
          <h2 className="sec-header">
            <span className="left"><span className="idx">02</span><span>AI PROVIDER</span></span>
            <span className="hint">powers the tailoring & QA agents</span>
          </h2>

          <div className="provider">
            <header className="ph">
              <div className="pl">
                <span className="prov-name">
                  <span className="logo">⌁</span> OPENROUTER
                </span>
                <a className="prov-url" href="https://openrouter.ai" target="_blank" rel="noopener noreferrer">
                  openrouter.ai ↗
                </a>
              </div>
              <span className={`prov-stat${validation === "ok" ? " ok" : ""}`}>
                <span className="prov-dot" />
                {validation === "ok" ? " CONNECTED" : " NOT CONNECTED"}
              </span>
            </header>

            <div className="pb">
              <div className="settings-field">
                <label className="settings-label" htmlFor="apikey">
                  API KEY
                  <span className="req">REQUIRED</span>
                </label>
                <div className="masked">
                  <input
                    id="apikey"
                    className="settings-input"
                    type={showKey ? "text" : "password"}
                    placeholder="sk-or-v1-..."
                    spellCheck={false}
                    autoComplete="off"
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      if (validation !== "idle") {
                        setValidation("idle");
                        setValidationMsg(<>Awaiting validation — paste a key and click <b>VALIDATE KEY</b>.</>);
                      }
                    }}
                  />
                  <button className="reveal" type="button" onClick={() => setShowKey(!showKey)}>
                    {showKey ? "HIDE" : "SHOW"}
                  </button>
                </div>
                <p className="settings-help">
                  Get your key from{" "}
                  <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noopener noreferrer" style={{ color: "var(--black)", textDecoration: "underline", textUnderlineOffset: 3, textDecorationThickness: 2 }}>
                    openrouter.ai/settings/keys
                  </a>{" "}
                  — free tier includes several models. Keys are stored locally; never sent to Rendure servers.
                </p>

                <div className="btn-row">
                  <button className="btn dark" type="button" onClick={handleValidate}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="square">
                      <path d="M4 12l5 5 11-11" />
                    </svg>
                    VALIDATE KEY
                  </button>
                  <a className="btn" href="https://openrouter.ai/settings/keys" target="_blank" rel="noopener noreferrer">
                    GET A KEY →
                  </a>
                </div>

                <div className={`vstatus ${validation}`}>
                  <span className="vs-dot" />
                  <span>{validationMsg}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Section 03 — Default Model */}
        <section className="ob-section">
          <h2 className="sec-header">
            <span className="left"><span className="idx">03</span><span>DEFAULT MODEL</span></span>
            <span className="hint">fallback for all agents</span>
          </h2>

          <div className="settings-field">
            <label className="settings-label" htmlFor="model">
              PREFERRED MODEL
              <span className="opt">optional</span>
            </label>
            <div className="select-wrap">
              <select
                id="model"
                className="settings-select"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={models.length === 0}
              >
                {models.length === 0 ? (
                  <option value="">
                    {modelsLoading ? "Loading models..." : modelsError ? "Failed to load" : "Validate key first"}
                  </option>
                ) : (
                  <>
                    <option value="">— use agent defaults —</option>
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>{m.id}</option>
                    ))}
                  </>
                )}
              </select>
              <span className="select-caret">▼</span>
            </div>
            {modelsError && (
              <p className="settings-help" style={{ color: "var(--red)" }}>
                {modelsError}
              </p>
            )}
            <p className="settings-help">
              Used as the fallback for any agent without a specific override below.
            </p>

            {/* Per-agent model overrides */}
            <div className="agent-models-toggle">
              <button
                type="button"
                className="agent-models-trigger"
                onClick={() => setAgentModelsOpen((o) => !o)}
                disabled={models.length === 0}
                aria-expanded={agentModelsOpen}
              >
                <span>CUSTOMIZE PER-AGENT MODELS</span>
                <span className="toggle-caret">{agentModelsOpen ? "▲" : "▼"}</span>
                <span className="opt" style={{ marginLeft: 8 }}>optional</span>
              </button>

              {agentModelsOpen && (
                <div className="agent-models-grid">
                  {AGENTS.map((agent) => (
                    <div key={agent.key} className="agent-model-row">
                      <div className="agent-model-label">
                        <span className="agent-name">{agent.label}</span>
                        <span className="agent-hint">{agent.hint}</span>
                      </div>
                      <div className="select-wrap agent-select-wrap">
                        <select
                          className="settings-select"
                          value={agentModels[agent.key]}
                          onChange={(e) => setAgentModel(agent.key, e.target.value)}
                        >
                          <option value="">— use default —</option>
                          {models.map((m) => (
                            <option key={m.id} value={m.id}>{m.id}</option>
                          ))}
                        </select>
                        <span className="select-caret">▼</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="infobox">
              <span className="info-icon">i</span>
              <span>
                MODEL PRICING VARIES · CHECK{" "}
                <a href="https://openrouter.ai/models" target="_blank" rel="noopener noreferrer">
                  openrouter.ai/models
                </a>{" "}
                FOR CURRENT RATES
              </span>
            </div>
          </div>
        </section>

        {/* Section 04 — Your Profile */}
        <section className="ob-section">
          <h2 className="sec-header">
            <span className="left"><span className="idx">04</span><span>YOUR PROFILE</span></span>
            <span className="hint">upload resume to auto-fill</span>
          </h2>

          {/* Resume upload */}
          <div
            className={`resume-dropzone${dragOver ? " drag-over" : ""}${resumeUploaded ? " uploaded" : ""}${resumeUploading ? " uploading" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => !resumeUploading && fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.md,.txt,.text"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleResumeFile(file);
                e.target.value = "";
              }}
            />

            {resumeUploading ? (
              <div className="dropzone-content">
                <span className="dropzone-icon spinning">⟳</span>
                <span className="dropzone-title">PARSING RESUME WITH AI...</span>
                <span className="dropzone-hint">Extracting your profile details</span>
              </div>
            ) : resumeUploaded ? (
              <div className="dropzone-content">
                <span className="dropzone-icon">✓</span>
                <span className="dropzone-title">
                  {resumeFile?.name ?? "RESUME UPLOADED"}
                </span>
                <span className="dropzone-hint">Click or drop to replace</span>
              </div>
            ) : (
              <div className="dropzone-content">
                <span className="dropzone-icon">↑</span>
                <span className="dropzone-title">DROP YOUR RESUME HERE</span>
                <span className="dropzone-hint">PDF, Markdown, or plain text — max 10 MB</span>
              </div>
            )}
          </div>

          {resumeError && (
            <div className="vstatus err" style={{ marginTop: 12 }}>
              <span className="vs-dot" />
              <span>{resumeError}</span>
            </div>
          )}

          {/* Profile form — always visible, auto-filled after upload */}
          <div className="profile-form">
            <div className="profile-form-header">
              <span className="profile-form-title">PROFILE DETAILS</span>
              <span className="profile-form-hint">
                {resumeUploaded
                  ? "Auto-filled from your resume — review and edit as needed"
                  : "Upload your resume above to auto-fill, or enter manually"}
              </span>
            </div>

            <div className="profile-grid">
              <div className="settings-field">
                <label className="settings-label" htmlFor="pf-name">
                  FULL NAME
                </label>
                <input
                  id="pf-name"
                  className="settings-input"
                  type="text"
                  placeholder="e.g. Marcus Halloway"
                  value={profileFullName}
                  onChange={(e) => setProfileFullName(e.target.value)}
                />
              </div>

              <div className="settings-field">
                <label className="settings-label" htmlFor="pf-email">
                  EMAIL
                </label>
                <input
                  id="pf-email"
                  className="settings-input"
                  type="email"
                  placeholder="you@example.com"
                  value={profileEmail}
                  onChange={(e) => setProfileEmail(e.target.value)}
                />
              </div>

              <div className="settings-field">
                <label className="settings-label" htmlFor="pf-phone">
                  PHONE
                </label>
                <input
                  id="pf-phone"
                  className="settings-input"
                  type="tel"
                  placeholder="+1 (555) 000-0000"
                  value={profilePhone}
                  onChange={(e) => setProfilePhone(e.target.value)}
                />
              </div>

              <div className="settings-field">
                <label className="settings-label" htmlFor="pf-location">
                  LOCATION
                </label>
                <input
                  id="pf-location"
                  className="settings-input"
                  type="text"
                  placeholder="e.g. San Francisco, CA"
                  value={profileLocation}
                  onChange={(e) => setProfileLocation(e.target.value)}
                />
              </div>

              <div className="settings-field">
                <label className="settings-label" htmlFor="pf-linkedin">
                  LINKEDIN
                </label>
                <input
                  id="pf-linkedin"
                  className="settings-input"
                  type="url"
                  placeholder="https://linkedin.com/in/..."
                  value={profileLinkedin}
                  onChange={(e) => setProfileLinkedin(e.target.value)}
                />
              </div>

              <div className="settings-field">
                <label className="settings-label" htmlFor="pf-website">
                  WEBSITE
                </label>
                <input
                  id="pf-website"
                  className="settings-input"
                  type="url"
                  placeholder="https://yoursite.com"
                  value={profileWebsite}
                  onChange={(e) => setProfileWebsite(e.target.value)}
                />
              </div>

              <div className="settings-field profile-span-2">
                <label className="settings-label" htmlFor="pf-summary">
                  PROFESSIONAL SUMMARY
                </label>
                <textarea
                  id="pf-summary"
                  className="settings-input settings-textarea"
                  placeholder="Brief professional summary..."
                  rows={3}
                  value={profileSummary}
                  onChange={(e) => setProfileSummary(e.target.value)}
                />
              </div>

              <div className="settings-field">
                <label className="settings-label" htmlFor="pf-years">
                  YEARS OF EXPERIENCE
                </label>
                <input
                  id="pf-years"
                  className="settings-input"
                  type="number"
                  min="0"
                  max="50"
                  placeholder="e.g. 8"
                  value={profileYearsExp}
                  onChange={(e) => setProfileYearsExp(e.target.value)}
                />
              </div>

              <div className="settings-field">
                <label className="settings-label" htmlFor="pf-seniority">
                  TARGET SENIORITY
                </label>
                <div className="select-wrap">
                  <select
                    id="pf-seniority"
                    className="settings-select"
                    value={profileSeniority}
                    onChange={(e) => setProfileSeniority(e.target.value)}
                  >
                    {SENIORITY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <span className="select-caret">▼</span>
                </div>
              </div>

              <div className="settings-field profile-span-2">
                <label className="settings-label" htmlFor="pf-skills">
                  KEY SKILLS
                  <span className="opt">comma-separated</span>
                </label>
                <input
                  id="pf-skills"
                  className="settings-input"
                  type="text"
                  placeholder="e.g. Python, Kubernetes, System Design, Leadership"
                  value={profileSkills}
                  onChange={(e) => setProfileSkills(e.target.value)}
                />
                <p className="settings-help">Skills you want highlighted in every tailored resume.</p>
              </div>

              <div className="settings-field profile-span-2">
                <label className="settings-label" htmlFor="pf-industries">
                  PREFERRED INDUSTRIES
                  <span className="opt">comma-separated</span>
                </label>
                <input
                  id="pf-industries"
                  className="settings-input"
                  type="text"
                  placeholder="e.g. Fintech, Healthtech, SaaS"
                  value={profileIndustries}
                  onChange={(e) => setProfileIndustries(e.target.value)}
                />
              </div>
            </div>
          </div>
        </section>

        {/* Launch */}
        <div className="launch-row">
          <button
            className="launch-btn"
            type="button"
            disabled={!canLaunch || launching}
            onClick={handleLaunch}
          >
            <span>{launching ? "SETTING UP..." : "LAUNCH RENDURE"}</span>
            <span className="arr">{launching ? "⟳" : "→"}</span>
          </button>
          {launchError && (
            <p className="launch-error">{launchError}</p>
          )}
          {!canLaunch && !launching && (
            <p className="launch-note" style={{ color: "var(--red)" }}>
              {!displayName.trim()
                ? "Enter your name to continue."
                : validation !== "ok"
                ? "Validate your API key to continue."
                : !resumeUploaded
                ? "Upload your resume to continue."
                : ""}
            </p>
          )}
          <p className="launch-note">
            Settings are stored <b>locally</b>. You can change everything later in <b>Settings</b>.
          </p>
        </div>

        {/* Footer */}
        <footer className="ob-foot">
          <span>RENDURE <b>v0.4.1</b></span>
          <span className="sep">·</span>
          <span>SELF-HOSTED</span>
          <span className="sep">·</span>
          <span>ALL DATA LOCAL</span>
        </footer>
      </main>
    </>
  );
}
