import { useState, useEffect, useCallback, useRef } from "react";
import { Nav } from "../components/Nav";
import "../styles/settings.css";
import { api, ApiError } from "~/lib/api";
import type { UserProfile, OpenRouterModel, LlmProvider, CodexAuthStatus } from "~/lib/types";

const SENIORITY_LEVELS = ["JUNIOR", "MID", "SENIOR", "LEAD", "STAFF", "PRINCIPAL"];
const SENIORITY_SHORT = ["JR", "MID", "SR", "LEAD", "STAFF", "PRIN"];

export default function Settings() {
  const [seniority, setSeniority] = useState(2);
  const [maxIters, setMaxIters] = useState(4);
  const [threshold, setThreshold] = useState(0.92);
  const [chatId, setChatId] = useState("");
  const [showChatId, setShowChatId] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [model, setModel] = useState("");
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [llmProvider, setLlmProvider] = useState<LlmProvider>("openrouter");
  const [codexStatus, setCodexStatus] = useState<CodexAuthStatus | null>(null);
  const [codexLoading, setCodexLoading] = useState(true);
  const [codexLoginPending, setCodexLoginPending] = useState(false);
  const [codexLoginError, setCodexLoginError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const SENIORITY_MAP = ['', 'junior', 'mid', 'senior', 'lead', 'staff', 'principal'];

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [profileData, apiKeyData, codexData] = await Promise.all([
          api.profile.get(),
          api.profile.checkApiKey(),
          api.codexAuth.status().catch(() => null),
        ]);
        if (cancelled) return;
        setProfile(profileData);
        setApiKeyConfigured(apiKeyData.configured);
        if (codexData) setCodexStatus(codexData);
        setCodexLoading(false);
        if (profileData.llm_provider) setLlmProvider(profileData.llm_provider);
        if (profileData.preferred_model) setModel(profileData.preferred_model);
        if (profileData.target_seniority) {
          const idx = SENIORITY_MAP.indexOf(profileData.target_seniority);
          if (idx > 0) setSeniority(idx - 1);
        }
        if (profileData.max_iterations != null) setMaxIters(profileData.max_iterations);
        if (profileData.qa_threshold != null) setThreshold(profileData.qa_threshold);
        if (profileData.notify_telegram_chat_id) setChatId(profileData.notify_telegram_chat_id);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Failed to load profile");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (loading) return;

    let cancelled = false;
    async function loadModels() {
      setModels([]);
      setModelsLoading(true);
      try {
        let fetched: OpenRouterModel[] = [];
        if (llmProvider === "codex-oauth") {
          if (!codexStatus?.connected || codexStatus.expired) return;
          fetched = await api.codexAuth.models();
        } else {
          fetched = await api.models.list();
        }

        if (cancelled) return;
        setModels(fetched);
        setModel((current) => fetched.some((m) => m.id === current) ? current : fetched[0]?.id || "");
      } catch {
        if (!cancelled) setModels([]);
      } finally {
        if (!cancelled) setModelsLoading(false);
      }
    }

    loadModels();
    return () => { cancelled = true; };
  }, [loading, llmProvider, codexStatus?.connected, codexStatus?.expired]);

  const refreshCodexStatus = useCallback(async () => {
    try {
      const status = await api.codexAuth.status();
      setCodexStatus(status);
    } catch { /* ignore */ }
  }, []);

  async function handleCodexLogin() {
    setCodexLoginError(null);
    setCodexLoginPending(true);
    try {
      const { login_id, auth_url } = await api.codexAuth.login();
      window.open(auth_url, "codex-login", "width=500,height=700,popup=yes");

      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const result = await api.codexAuth.pollLogin(login_id);
          if (result.status === "complete") {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setCodexLoginPending(false);
            await refreshCodexStatus();
          } else if (result.status === "error" || result.status === "expired") {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setCodexLoginPending(false);
            setCodexLoginError(result.error ?? "Login failed or expired.");
          }
        } catch {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setCodexLoginPending(false);
          setCodexLoginError("Failed to check login status.");
        }
      }, 2000);
    } catch (err) {
      setCodexLoginPending(false);
      setCodexLoginError(err instanceof ApiError ? err.message : "Failed to start login.");
    }
  }

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.profile.update({
        qa_threshold: threshold,
        max_iterations: maxIters,
        target_seniority: SENIORITY_MAP[seniority + 1],
        preferred_model: model || undefined,
        llm_provider: llmProvider,
        notify_telegram_chat_id: chatId || undefined,
      });
      setProfile(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  function handleProviderChange(provider: LlmProvider) {
    if (provider === llmProvider) return;
    setLlmProvider(provider);
    setModel("");
    setModels([]);
  }

  if (loading) {
    return (
      <>
        <Nav variant="settings" />
        <main className="page settings-page">
          <h1 className="page-title">SETTINGS</h1>
          <p className="settings-loading">Loading profile…</p>
        </main>
      </>
    );
  }

  return (
    <>
      <Nav variant="settings" />
      <main className="page settings-page">
        <h1 className="page-title">
          SETTINGS
          <span className="title-meta">
            PROFILE {profile?.display_name ? <b>{profile.display_name}</b> : null}
          </span>
        </h1>

        {/* Section 1: Tailoring Preferences */}
        <section className="settings-section">
          <h2 className="sec-header">
            <span><span className="idx">01</span>&nbsp;&nbsp;TAILORING PREFERENCES</span>
            <span className="hint">applies to all new tailoring runs</span>
          </h2>

          {/* Default Seniority */}
          <div className="settings-field">
            <label className="settings-label" htmlFor="seniority">
              DEFAULT SENIORITY
              <span className="opt">used when JD doesn't specify</span>
            </label>
            <div className="select-wrap">
              <select
                id="seniority"
                className="settings-select"
                value={SENIORITY_LEVELS[seniority]}
                onChange={(e) => setSeniority(SENIORITY_LEVELS.indexOf(e.target.value))}
              >
                {SENIORITY_LEVELS.map((level) => (
                  <option key={level}>{level}</option>
                ))}
              </select>
              <span className="select-caret">▼</span>
            </div>
            <div className="seniority-track" aria-hidden="true">
              {SENIORITY_SHORT.map((label, i) => (
                <div
                  key={label}
                  className={`step${seniority === i ? " on" : ""}`}
                  onClick={() => setSeniority(i)}
                >
                  {label}
                </div>
              ))}
            </div>
            <p className="settings-help">
              The tailoring agent will frame your scope, summary tone, and bullet phrasing at this level. Override per-job from the Job Detail screen.
            </p>
          </div>

          {/* Max Iterations */}
          <div className="settings-field">
            <label className="settings-label" htmlFor="iters">
              MAX ITERATIONS
              <span className="opt">per run</span>
            </label>
            <div className="number-row">
              <input
                id="iters"
                className="settings-input"
                type="number"
                min={1}
                max={8}
                step={1}
                value={maxIters}
                onChange={(e) => setMaxIters(Number(e.target.value))}
              />
              <div className="stepper" aria-hidden="true">
                <button type="button" onClick={() => setMaxIters(Math.max(1, maxIters - 1))}>−</button>
                <button type="button" onClick={() => setMaxIters(Math.min(8, maxIters + 1))}>+</button>
              </div>
            </div>
            <p className="settings-help">
              How many tailoring + QA loops the agent is allowed before giving up. Higher = better score, slower runs. <code>recommended: 4</code>
            </p>
          </div>

          {/* QA Threshold */}
          <div className="settings-field">
            <label className="settings-label" htmlFor="threshold">
              QA PASS THRESHOLD
              <span className="opt">composite score, 0.00 – 1.00</span>
            </label>
            <div className="number-row">
              <input
                id="threshold"
                className="settings-input"
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
              />
              <div className="stepper" aria-hidden="true">
                <button type="button" onClick={() => setThreshold(Math.max(0, +(threshold - 0.01).toFixed(2)))}>−</button>
                <button type="button" onClick={() => setThreshold(Math.min(1, +(threshold + 0.01).toFixed(2)))}>+</button>
              </div>
            </div>
            <p className="settings-help">
              Composite score required to stop iterating and ship a version. <code>0.92</code> is strict — drop to <code>0.85</code> if runs keep timing out.
            </p>
          </div>
        </section>

        {/* Section 2: LLM Provider */}
        <section className="settings-section">
          <h2 className="sec-header">
            <span><span className="idx">02</span>&nbsp;&nbsp;LLM PROVIDER</span>
            <span className="hint">which backend powers your agents</span>
          </h2>

          <div className="settings-field">
            <label className="settings-label">
              PROVIDER
              <span className="opt">select how LLM calls are routed</span>
            </label>
            <div className="provider-toggle">
              <button
                type="button"
                className={`provider-btn${llmProvider === "openrouter" ? " active" : ""}`}
                onClick={() => handleProviderChange("openrouter")}
              >
                <span className="provider-name">OpenRouter</span>
                <span className="provider-desc">API key, any model</span>
              </button>
              <button
                type="button"
                className={`provider-btn${llmProvider === "codex-oauth" ? " active" : ""}`}
                onClick={() => handleProviderChange("codex-oauth")}
              >
                <span className="provider-name">ChatGPT (Codex OAuth)</span>
                <span className="provider-desc">Plus/Pro subscription</span>
              </button>
            </div>
          </div>

          {llmProvider === "codex-oauth" && (
            <div className="settings-field">
              <label className="settings-label">
                CONNECTION STATUS
              </label>
              {codexLoading ? (
                <p className="settings-help">Checking Codex auth…</p>
              ) : codexStatus?.connected ? (
                <div className="codex-status connected">
                  <span className="codex-dot connected" />
                  <div>
                    <strong>Connected</strong>
                    {codexStatus.expires_at && (
                      <span className="codex-meta">
                        &nbsp;· token expires {new Date(codexStatus.expires_at).toLocaleString()}
                      </span>
                    )}
                    {codexStatus.source_path && (
                      <p className="settings-help" style={{ margin: "4px 0 0" }}>
                        Reading from <code>{codexStatus.source_path}</code>
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="codex-status disconnected">
                  <span className="codex-dot disconnected" />
                  <div>
                    <strong>{codexStatus?.expired ? "Token Expired" : "Not Connected"}</strong>
                    <div className="codex-login-row">
                      <button
                        className="btn dark codex-login-btn"
                        type="button"
                        onClick={handleCodexLogin}
                        disabled={codexLoginPending}
                      >
                        {codexLoginPending ? "WAITING FOR LOGIN…" : "LOGIN WITH CHATGPT"}
                      </button>
                    </div>
                    {codexLoginPending && (
                      <p className="settings-help" style={{ margin: "8px 0 0" }}>
                        A login window should have opened. Sign in with your ChatGPT account.
                      </p>
                    )}
                    {codexLoginError && (
                      <p className="codex-login-error">{codexLoginError}</p>
                    )}
                    <p className="settings-help" style={{ margin: "8px 0 0" }}>
                      Or run <code>npx @openai/codex login</code> in your terminal, then refresh.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="settings-field">
            <label className="settings-label" htmlFor="model">
              PREFERRED MODEL
              <span className="opt">per-agent override in settings</span>
            </label>
            <div className="select-wrap">
              <select
                id="model"
                className="settings-select"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={modelsLoading || models.length === 0}
              >
                {models.length === 0 ? (
                  <option value="">
                    {modelsLoading
                      ? "Loading models..."
                      : llmProvider === "codex-oauth"
                        ? "Connect ChatGPT first"
                        : "API key not configured"}
                  </option>
                ) : (
                  models.map((m) => (
                    <option key={m.id} value={m.id}>{m.id}</option>
                  ))
                )}
              </select>
              <span className="select-caret">▼</span>
            </div>
            <p className="settings-help">
              Primary model for all agents. Override per-agent in Advanced settings.
            </p>
          </div>
        </section>

        {/* Section 3: Telegram Notifications */}
        <section className="settings-section">
          <h2 className="sec-header">
            <span><span className="idx">03</span>&nbsp;&nbsp;TELEGRAM NOTIFICATIONS</span>
            <span className="hint">ping me when runs complete</span>
          </h2>

          <div className="settings-field">
            <label className="settings-label" htmlFor="chat">
              CHAT ID
              <span className="req">REQUIRED</span>
            </label>
            <div className="masked">
              <input
                id="chat"
                className="settings-input"
                type={showChatId ? "text" : "password"}
                value={chatId}
                onChange={(e) => setChatId(e.target.value)}
              />
              <button className="reveal" type="button" onClick={() => setShowChatId(!showChatId)}>
                {showChatId ? "HIDE" : "SHOW"}
              </button>
            </div>
            <p className="settings-help">
              Send <code>/start</code> to your bot (<code>@rendure_bot</code>) and it will reply with your chat ID. Paste it here.
            </p>

            <div className="btn-row">
              <button className="btn dark" type="button">
                <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="square">
                  <path d="M3 11l18-7-7 18-2-8z" />
                </svg>
                TEST NOTIFICATION
              </button>
              <button className="btn danger" type="button">
                <svg viewBox="0 0 24 24" fill="none" stroke="#D50000" strokeWidth="2.5" strokeLinecap="square">
                  <path d="M6 6l12 12" /><path d="M18 6L6 18" />
                </svg>
                CLEAR
              </button>
            </div>

            <div className="notif-status">
              <span className="notif-dot" />
              <span>API KEY {apiKeyConfigured ? <b>CONFIGURED</b> : <b>NOT SET</b>}</span>
            </div>
          </div>
        </section>

        {error && <div className="settings-error">{error}</div>}

        {/* Save */}
        <div className="save-row">
          <button className="save-btn" type="button" onClick={handleSave} disabled={saving}>
            <span>{saving ? 'SAVING…' : 'SAVE CHANGES'}</span>
            <span className="arr">→</span>
          </button>
          <button className="save-cancel" type="button">CANCEL</button>
        </div>

        <p className="save-note">
          Settings are stored in your profile ({profile?.display_name ?? 'profile'}). Changes take effect <b>immediately</b> — no restart required.
          <br />
          Edit <code>~/.rendure/config.toml</code> directly for advanced fields.
        </p>

        {/* Danger Zone */}
        <section className="danger-zone">
          <div>
            <div className="dz-t">DANGER ZONE</div>
            <div className="dz-s">Wipe all runs & revoke API tokens. This cannot be undone.</div>
          </div>
          <button className="btn danger" type="button">RESET PROFILE</button>
        </section>
      </main>
    </>
  );
}
