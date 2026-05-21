import { useState, useMemo } from "react";
import { useNavigate } from "react-router";
import { api, ApiError } from "~/lib/api";
import type { OpenRouterModel } from "~/lib/types";
import "../styles/settings.css";
import "../styles/onboarding.css";

type ValidationState = "idle" | "ok" | "err";

export default function Onboarding() {
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState("");
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [validation, setValidation] = useState<ValidationState>("idle");
  const [validating, setValidating] = useState(false);
  const [validationMsg, setValidationMsg] = useState(
    <>Awaiting validation — paste a key and click <b>VALIDATE KEY</b>.</>
  );

  const currentStep = useMemo(() => {
    if (!displayName.trim()) return 0;
    if (validation !== "ok") return 1;
    return 2;
  }, [displayName, validation]);

  const canLaunch = displayName.trim().length > 0 && validation === "ok" && !modelsLoading;

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

  const handleLaunch = async () => {
    if (!canLaunch) return;
    setLaunching(true);
    setLaunchError(null);
    try {
      await api.profile.create({ display_name: displayName.trim() });
      await api.profile.saveApiKey(apiKey.trim());
      if (model) await api.profile.update({ preferred_model: model });
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
            <span>CONNECT YOUR AI PROVIDER TO GET STARTED</span>
            <span className="sep">·</span>
            <span><b>TAKES 30 SECONDS</b></span>
          </div>
        </header>

        {/* Progress */}
        <div className="ob-progress">
          {[
            { num: "01", title: "Your Name" },
            { num: "02", title: "API Key" },
            { num: "03", title: "Model" },
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
            <span className="hint">override per-agent later</span>
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
                  models.map((m) => (
                    <option key={m.id} value={m.id}>{m.id}</option>
                  ))
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
              Used as the primary model for all agents. Each agent can be overridden individually in Settings later.
            </p>

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
