import { useState, useEffect } from "react";
import { api, ApiError } from "~/lib/api";
import type { Job, JobStatus, DiscoveredJob } from "~/lib/types";
import { Link, useNavigate } from "react-router";
import { Nav } from "../components/Nav";

function getPipelineFromStatus(status: JobStatus): { states: ("done" | "active" | "pending" | "fail")[] } {
  switch (status) {
    case "found": return { states: ["active", "pending", "pending", "pending"] };
    case "tailoring": return { states: ["done", "active", "pending", "pending"] };
    case "qa_review": return { states: ["done", "done", "active", "pending"] };
    case "qa_failed": return { states: ["done", "done", "fail", "pending"] };
    case "approved": return { states: ["done", "done", "done", "done"] };
    case "submitting": return { states: ["done", "done", "done", "done"] };
    case "submitted": return { states: ["done", "done", "done", "done"] };
    case "submission_failed": return { states: ["done", "done", "done", "fail"] };
    case "low_match": return { states: ["done", "done", "fail", "pending"] };
    case "error": return { states: ["pending", "pending", "pending", "pending"] };
    default: return { states: ["pending", "pending", "pending", "pending"] };
  }
}

function getBadgeInfo(status: JobStatus): { badgeClass: string; badgeLabel: string } {
  switch (status) {
    case "new": return { badgeClass: "queued", badgeLabel: "New" };
    case "found": return { badgeClass: "queued", badgeLabel: "Scouting" };
    case "tailoring": return { badgeClass: "tailoring", badgeLabel: "Tailoring" };
    case "qa_review": return { badgeClass: "qa", badgeLabel: "QA Review" };
    case "approved": return { badgeClass: "ok", badgeLabel: "Approved" };
    case "submitting": return { badgeClass: "qa", badgeLabel: "Submitting" };
    case "submitted": return { badgeClass: "ok", badgeLabel: "Submitted" };
    case "submission_failed": return { badgeClass: "err", badgeLabel: "Submission Failed" };
    case "qa_failed": return { badgeClass: "err", badgeLabel: "QA Failed" };
    case "low_match": return { badgeClass: "err", badgeLabel: "Low Match" };
    case "error": return { badgeClass: "err", badgeLabel: "Error" };
    default: return { badgeClass: "queued", badgeLabel: status };
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + "m ago";
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + "h ago";
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  return days + "d ago";
}

const EVENTS = [
  { type: "warn", agent: "quality_analyst", msg: <><b>qa_score_0.89</b> · stripe · iter 2 above threshold</>, time: "14:02:46" },
  { type: "ok", agent: "resume_tailor", msg: <><b>tailoring_complete</b> · vercel · <em>14.2s</em></>, time: "14:02:31" },
  { type: "ok", agent: "job_scout", msg: <><b>job_found</b> · linear · parsed 22 reqs</>, time: "14:01:58" },
  { type: "ok", agent: "confirmation", msg: <><b>resume_ready</b> · anthropic · <em>mts_infra_v3.4-tailored.pdf</em></>, time: "11:48:02" },
  { type: "err", agent: "quality_analyst", msg: <><span className="err-text">qa_failed</span> · replicate · score 0.62 &lt; 0.85 · keyword gap: <em>triton, cuda</em></>, time: "09:14:21" },
  { type: "ok", agent: "job_scout", msg: <><b>job_queued</b> · supabase · added to backlog</>, time: "14:00:11" },
];

const AGENTS = [
  { name: "job_scout", role: "scrape · parse · diff", status: "run" },
  { name: "resume_tailor", role: "section rewrite · iterate", status: "run" },
  { name: "quality_analyst", role: "score · rubric · gate", status: "run" },
  { name: "confirmation", role: "render · sign · deliver", status: "idle" },
];

function fmtDiscoveredTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + "m ago";
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + "h ago";
  return d.toLocaleDateString();
}

function discRelClass(r: number | null): string {
  if (r === null) return "mid";
  return r >= 0.7 ? "hi" : r >= 0.4 ? "mid" : "lo";
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [activeFilter, setActiveFilter] = useState("all");
  const [jobUrl, setJobUrl] = useState("");
  const [autoApply, setAutoApply] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [health, setHealth] = useState<{ ok: boolean; version: string } | null>(null);
  const [recentDiscovered, setRecentDiscovered] = useState<DiscoveredJob[]>([]);

  useEffect(() => {
    if (!localStorage.getItem("rendure_onboarded")) {
      navigate("/onboarding", { replace: true });
    }
  }, [navigate]);

  useEffect(() => {
    api.jobs.list()
      .then(setJobs)
      .catch((e) => setError(e instanceof ApiError ? String((e.body as Record<string, unknown>)?.error ?? e.body) : "Failed to load jobs"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    api.health.check()
      .then(setHealth)
      .catch(() => {});
  }, []);

  useEffect(() => {
    api.discovery.getRecentJobs(10)
      .then((res) => setRecentDiscovered(res.jobs))
      .catch(() => {});
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!jobUrl.trim()) return;
    setSubmitting(true);
    setSubmitSuccess(null);
    setError(null);
    api.jobs.submit(jobUrl.trim(), { autoApply })
      .then(() => {
        setSubmitSuccess(
          autoApply
            ? "Job submitted successfully. Auto-apply will run only after QA approval."
            : "Job submitted successfully",
        );
        setJobUrl("");
        return api.jobs.list();
      })
      .then(setJobs)
      .catch((e) => setError(e instanceof ApiError ? String((e.body as Record<string, unknown>)?.error ?? e.body) : "Failed to submit job"))
      .finally(() => setSubmitting(false));
  }

  const terminalStates: JobStatus[] = ["approved", "low_match", "error", "submitted", "submission_failed"];
  const inProgress = jobs.filter((j) => !terminalStates.includes(j.status)).length;
  const approvedCount = jobs.filter((j) => j.status === "approved" || j.status === "submitted").length;
  const failedCount = jobs.filter((j) => j.status === "low_match" || j.status === "error" || j.status === "submission_failed").length;
  const scores = jobs.map((j) => j.qa_score).filter((s): s is number => s !== null);
  const avgScore = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(3) : "—";

  const filterCounts = {
    all: jobs.length,
    active: inProgress,
    approved: approvedCount,
    failed: failedCount,
  };

  return (
    <>
    <Nav variant="dashboard" />
    <main className="page">
      {/* Header */}
      <header className="head">
        <div>
          <h1>JOBS.</h1>
          <div className="sub">
            self-hosted resume tailoring · 4 agents running locally
          </div>
        </div>
        <div className="right">
          <span className="health">
            <span className="dot" />
            SYSTEM HEALTHY
          </span>
        </div>
      </header>

      {/* Stats */}
      <section className="stats" aria-label="Pipeline stats">
        <div className="stat active">
          <span className="corner mono">LIVE</span>
          <div className="label">In Progress</div>
          <div className="num mono">{inProgress}</div>
          <div className="delta mono">{jobs.length} total in pipeline</div>
        </div>
        <div className="stat approved">
          <div className="label">Approved</div>
          <div className="num mono">{approvedCount}</div>
          <div className="delta mono">{approvedCount > 0 ? "▲ ready to apply" : "—"}</div>
        </div>
        <div className="stat failed">
          <div className="label">Failed</div>
          <div className="num mono">{failedCount}</div>
          <div className="delta mono">{failedCount > 0 ? "▼ needs attention" : "—"}</div>
        </div>
        <div className="stat">
          <div className="label">Avg QA Score</div>
          <div className="num mono">{avgScore}</div>
          <div className="delta mono">{scores.length} scored</div>
        </div>
      </section>

      {/* Composer */}
      <form className="composer" aria-label="Add a new job" onSubmit={handleSubmit}>
        <span className="prompt">$ rendure add</span>
        <input
          type="text"
          placeholder="paste a job listing URL  ·  e.g. https://company.com/jobs/12345"
          value={jobUrl}
          onChange={(e) => setJobUrl(e.target.value)}
        />
        <button className="go" type="submit" disabled={submitting}>
          {submitting ? "SUBMITTING…" : "ANALYZE →"}
        </button>
        <label className="auto-apply-toggle">
          <input
            type="checkbox"
            checked={autoApply}
            onChange={(e) => setAutoApply(e.target.checked)}
          />
          Auto-apply after QA approval — submits to the employer (Greenhouse/Lever/Ashby only)
        </label>
        {submitSuccess && <span className="success-msg">{submitSuccess}</span>}
        {error && <span className="error-msg">{error}</span>}
      </form>

      {/* Filters */}
      <div className="filters" aria-label="Filter jobs">
        <span className="label">Filter</span>
        {[
          { key: "all", label: "All", count: filterCounts.all },
          { key: "active", label: "Active", count: filterCounts.active },
          { key: "approved", label: "Approved", count: filterCounts.approved },
          { key: "failed", label: "Failed", count: filterCounts.failed },
        ].map((f) => (
          <span
            key={f.key}
            className={`pill${activeFilter === f.key ? " is-on" : ""}`}
            onClick={() => setActiveFilter(f.key)}
          >
            {f.label}
            <span className="count mono">·{f.count}</span>
          </span>
        ))}
        <span className="spacer" />
        <div className="search mono">
          <span style={{ color: "var(--muted)" }}>⌕</span>
          <input type="text" placeholder="search by company, role, keyword…" />
        </div>
      </div>

      {/* Jobs Table */}
      <section className="table" aria-label="Jobs list">
        <div className="row head-row">
          <div className="col">Job</div>
          <div className="col">URL</div>
          <div className="col">Pipeline</div>
          <div className="col">Status</div>
          <div className="col">Score</div>
          <div className="col">Updated</div>
          <div className="col" />
        </div>

        {loading && <div className="row"><div className="col" style={{ gridColumn: "1 / -1", textAlign: "center", padding: "2rem", color: "var(--muted)" }}>Loading jobs…</div></div>}
        {!loading && error && jobs.length === 0 && <div className="row"><div className="col" style={{ gridColumn: "1 / -1", textAlign: "center", padding: "2rem", color: "var(--red)" }}>{error}</div></div>}
        {!loading && !error && jobs.length === 0 && <div className="row"><div className="col" style={{ gridColumn: "1 / -1", textAlign: "center", padding: "2rem", color: "var(--muted)" }}>No jobs yet. Submit a URL to get started.</div></div>}
        {!loading && jobs.filter((j) => {
          if (activeFilter === "all") return true;
          if (activeFilter === "active") return !terminalStates.includes(j.status);
          if (activeFilter === "failed") return j.status === "low_match" || j.status === "error" || j.status === "submission_failed";
          if (activeFilter === "approved") return j.status === "approved" || j.status === "submitted";
          return j.status === activeFilter;
        }).map((job) => {
          const pipeline = getPipelineFromStatus(job.status);
          const badge = getBadgeInfo(job.status);
          const scoreClass = job.qa_score !== null && job.qa_score < 0.7 ? "fail" : job.qa_score === null ? "dim" : "";
          return (
          <Link key={job.job_id} className="row job" to={`/jobs/${job.job_id}`}>
            <div className="col">
              <div className="company">{job.company_name ?? "—"}</div>
              <div className="role">{job.role_title ?? "—"}</div>
            </div>
            <div className="col url">{job.job_url}</div>
            <div className="col">
              <div className="mini-pipeline">
                {pipeline.states.map((state, i) => (
                  <span key={i}>
                    {i > 0 && (
                      <span
                        className={`seg${state === "pending" || pipeline.states[i - 1] === "pending" ? " dim" : ""}`}
                        style={{ display: "inline-block", marginRight: 6 }}
                      />
                    )}
                    <span className={`step ${state}`}>
                      {state === "fail" ? "!" : i + 1}
                    </span>
                  </span>
                ))}
              </div>
            </div>
            <div className="col">
              <span className={`badge ${badge.badgeClass}`}>
                <span className="bdot" />
                {badge.badgeLabel}
              </span>
            </div>
            <div className={`col score ${scoreClass}`}>
              {job.qa_score !== null ? job.qa_score.toFixed(3) : "—"}
            </div>
            <div className="col time">{formatTime(job.created_at)}</div>
            <div className="col go-arrow">→</div>
          </Link>
          );
        })}
      </section>

      {/* Discovered Jobs Sub-table */}
      <section className="discovered-section" aria-label="Recently discovered jobs">
        <div className="discovered-section-head">
          <span className="ttl">▌ Recently Discovered · {recentDiscovered.length} newest</span>
          <Link to="/discover" className="view-all">VIEW ALL →</Link>
        </div>
        <div className="discovered-mini-table">
          {recentDiscovered.length === 0 ? (
            <div className="dm-empty mono">
              no discovered jobs · run discovery or configure companies in settings
            </div>
          ) : (
            <>
              <div className="dm-row dm-head">
                <div className="col">Job</div>
                <div className="col">Platform</div>
                <div className="col">Relevance</div>
                <div className="col">Status</div>
                <div className="col">Found</div>
              </div>
              {recentDiscovered.map((job) => (
                <div key={job.id} className="dm-row dm-body">
                  <div className="dm-job">
                    <div className="dm-company">{job.company ?? "—"}</div>
                    <div className="dm-role">{job.title ?? "—"}</div>
                  </div>
                  <div className="col">
                    <span className="mono" style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                      {job.platform ?? "—"}
                    </span>
                  </div>
                  <div className={`dm-score ${discRelClass(job.relevance_score)}`}>
                    {job.relevance_score !== null ? job.relevance_score.toFixed(3) : "—"}
                  </div>
                  <div className="col">
                    <span className={`dm-status-badge ${job.status === "pending_review" ? "pending" : job.status === "queued" ? "queued" : "rejected"}`}>
                      {job.status === "pending_review" ? "PENDING" : job.status.toUpperCase()}
                    </span>
                  </div>
                  <div className="dm-time">{fmtDiscoveredTime(job.discovered_at)}</div>
                </div>
              ))}
            </>
          )}
        </div>
      </section>

      {/* Bottom: Activity + Agents */}
      <section className="bottom">
        {/* Activity feed */}
        <div className="feed" aria-label="Global activity feed">
          <div className="feed-head">
            <div className="ttl">▌ Global Activity · live</div>
            <div className="lights" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          </div>
          <div className="feed-body">
            {EVENTS.map((ev, i) => (
              <div key={i} className={`ev ${ev.type}`}>
                <span className="ball" />
                <span className="agent">{ev.agent}</span>
                <span className="msg">{ev.msg}</span>
                <span className="time">{ev.time}</span>
              </div>
            ))}
          </div>
          <div className="feed-foot">
            <span>$ tail -f rendure.log</span>
            <span className="caret" />
          </div>
        </div>

        {/* Agents */}
        <aside className="agents" aria-label="Local agents status">
          <h3>Local Agents</h3>
          {AGENTS.map((a) => (
            <div key={a.name} className="agent-row">
              <div className="name">
                {a.name}
                <span className="role">{a.role}</span>
              </div>
              <span className={`agent-status ${a.status}`}>
                <span className="d" />
                {a.status === "run" ? "RUNNING" : a.status === "idle" ? "IDLE" : "OK"}
              </span>
            </div>
          ))}
          <dl className="system">
            <dt>model</dt>
            <dd>openrouter</dd>
            <dt>runtime</dt>
            <dd>self-hosted · docker</dd>
            <dt>api</dt>
            <dd>
              {health ? <span className={health.ok ? "ok" : "err"}>{health.ok ? "healthy" : "unhealthy"}</span> : <span className="dim">checking…</span>}
            </dd>
            <dt>version</dt>
            <dd>{health?.version ?? "—"}</dd>
          </dl>
        </aside>
      </section>

      <div className="meta-row mono">
        <span>self-hosted · all data local</span>
        <span>rendure v0.4.1</span>
      </div>
    </main>
    </>
  );
}
