import { useState, useEffect } from "react";
import { useParams, Link } from "react-router";
import { Nav } from "../components/Nav";
import { api, ApiError } from "~/lib/api";
import type { JobDetail, PipelineEvent } from "~/lib/types";
import "../styles/job-detail.css";

const STAGE_NAMES = ["Job Scout", "Resume Tailor", "Quality Analyst", "Confirmation"];

const STAGE_ACTIVE: Record<string, number> = {
  found: 0,
  tailoring: 1,
  qa_review: 2,
  qa_failed: 2,
  approved: 3,
};

function getStages(status: string) {
  if (status === "low_match" || status === "qa_failed") {
    return STAGE_NAMES.map((title, i) => ({
      num: `0${i + 1}`,
      title,
      state: i < 2 ? "done" : i === 2 ? "fail" : "pending",
      meta: "",
    }));
  }
  if (status === "error") {
    return STAGE_NAMES.map((title, i) => ({
      num: `0${i + 1}`,
      title,
      state: "fail",
      meta: "",
    }));
  }
  const active = STAGE_ACTIVE[status] ?? 0;
  return STAGE_NAMES.map((title, i) => ({
    num: `0${i + 1}`,
    title,
    state: i < active ? "done" : i === active ? "active" : "pending",
    meta: "",
  }));
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    found: "JOB FOUND",
    tailoring: "TAILORING",
    qa_review: "QA REVIEW",
    qa_failed: "QA FAILED",
    low_match: "LOW MATCH",
    approved: "APPROVED",
    error: "ERROR",
  };
  return map[status] ?? status?.toUpperCase() ?? "UNKNOWN";
}

function formatTime(iso?: string) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-US", { hour12: false });
}

function isTerminalStatus(status: string) {
  return status === "approved" || status === "low_match" || status === "error";
}

export default function JobDetail() {
  const { id } = useParams();
  const [job, setJob] = useState<JobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [liveEvents, setLiveEvents] = useState<PipelineEvent[]>([]);

  useEffect(() => {
    if (!id) { setLoading(false); setError("No job ID provided"); return; }
    setLoading(true); setError(null);
    api.jobs.get(id)
      .then((j) => { setJob(j); setLiveEvents(j.pipeline_events ?? []); })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setError("Job not found");
        else setError(err instanceof ApiError ? err.message : "Failed to load job");
      })
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!id || !job) return;
    if (isTerminalStatus(job.status)) return;
    const es = api.events.connect(id);
    es.onmessage = (e) => {
      try { setLiveEvents((prev) => [JSON.parse(e.data) as PipelineEvent, ...prev].slice(0, 20)); }
      catch { /* skip malformed */ }
    };
    es.onerror = () => {};
    return () => es.close();
  }, [id, job?.status]);

  if (loading) return (
    <><Nav variant="back" backTo="/" backLabel="ALL JOBS" /><main className="page"><div className="loading-state">Loading job details…</div></main></>
  );

  if (error || !job) return (
    <><Nav variant="back" backTo="/" backLabel="ALL JOBS" /><main className="page"><div className="error-state">{error ?? "Job not found"}</div></main></>
  );

  const stages = getStages(job.status);
  const qa = job.qa_review;

  return (
    <>
    <Nav variant="back" backTo="/" backLabel="ALL JOBS" />
    <main className="page">
      {/* Job Header */}
      <section className="job-header">
        <div>
          <h1 className="company">{job.company_name}</h1>
          <div className="role">{job.role_title}</div>
          <a className="url mono" href={job.job_url} target="_blank" rel="noopener">
            {job.job_url?.replace(/^https?:\/\//, "")}
          </a>
        </div>
        <div className="status-badge" role="status" aria-live="polite">
          {!isTerminalStatus(job.status) && (
            <span className="pulse" aria-hidden="true" />
          )}
          {statusLabel(job.status)}
        </div>
      </section>

      {/* Pipeline Tracker */}
      <div className="section-label">Pipeline</div>
      <section className="pipeline" aria-label="Pipeline stages">
        {stages.map((s, i) => (
          <span key={s.num} style={{ display: "contents" }}>
            {i > 0 && (
              <div className={`arrow${s.state === "pending" ? " dim" : ""}`} aria-hidden="true">
                →
              </div>
            )}
            <div className={`stage ${s.state}`}>
              {s.state === "active" && <span className="badge-label">RUNNING</span>}
              <div>
                <div className="num">STAGE {s.num}</div>
                <div className="title">{s.title}</div>
              </div>
              <div className="meta">{s.meta}</div>
            </div>
          </span>
        ))}
      </section>

      {/* Iteration Chips */}
      {job.iteration_count != null && job.iteration_count > 0 && (
        <div className="iter-row" aria-label="Iteration scores">
          <span className="lbl">QA iterations</span>
          {Array.from({ length: job.iteration_count }, (_, i) => (
            <span key={i}>
              {i > 0 && <span className="arrow-mini mono">→</span>}
              <span className={`chip${i === job.iteration_count - 1 ? " current" : ""}`}>
                Iter {i + 1}: {qa ? qa.score.toFixed(3) : "—"}
              </span>
            </span>
          ))}
        </div>
      )}

      {/* Main Grid: Feed + Side */}
      <section className="main-grid">
        {/* Event Feed */}
        <div className="feed" aria-label="Live event feed">
          <div className="feed-head">
            <div className="ttl">▌ Event Feed · {isTerminalStatus(job.status) ? "complete" : "live"}</div>
            <div className="lights" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          </div>
          <div className="feed-body">
            {liveEvents.length > 0 ? liveEvents.map((ev, i) => (
              <div key={ev.event_id ?? i} className={`ev${ev.event_type === "agent_error" ? " err" : " ok"}${i === 0 && !isTerminalStatus(job.status) ? " active-now" : ""}`}>
                <span className="ball" />
                <span className="agent">{ev.agent_name ?? "system"}</span>
                <span className="msg">{ev.detail ?? ev.event_type}</span>
                <span className="time">{formatTime(ev.timestamp)}</span>
              </div>
            )) : (
              <div className="ev"><span className="msg">No events yet</span></div>
            )}
          </div>
          <div className="feed-foot">
            <span>$ tail -f rendure.log</span>
            <span className="caret" />
          </div>
        </div>

        {/* Side Stack */}
        <aside className="side-stack" aria-label="Job details">
          <div className="card score-card">
            <h3>QA Score</h3>
            <div className="score-row-card">
              <div>
                <div className="score-num mono">{qa ? qa.score.toFixed(3) : "—"}</div>
                <div className="mono" style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>
                  threshold · 0.92
                </div>
              </div>
              <span className={qa?.passed ? "pass" : "fail"}>
                {qa ? (qa.passed ? "PASS" : "FAIL") : "—"}
              </span>
            </div>
            <div className="bars">
              {[
                { label: "Keyword Match", key: "keyword_match" as const, v: qa?.keyword_match },
                { label: "Experience", key: "experience_match" as const, v: qa?.experience_match },
                { label: "Seniority", key: "seniority_match" as const, v: qa?.seniority_match },
                { label: "Structure", key: "structure_valid" as const, v: qa ? (qa.structure_valid ? 1.0 : 0.0) : undefined },
              ].map((b) => (
                <div key={b.label} className="bar">
                  <span>{b.label}</span>
                  <div className="track">
                    <div className="fill" style={{ width: b.v != null ? `${(b.v as number) * 100}%` : "0%" }} />
                  </div>
                  <span>{b.v != null ? (b.v as number).toFixed(2) : "—"}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h3>Job Meta</h3>
            <dl className="kv">
              <dt>company</dt>
              <dd>{job.company_name}</dd>
              <dt>location</dt>
              <dd>{job.location ?? "—"}</dd>
              <dt>seniority</dt>
              <dd>{job.seniority_level ?? "—"}</dd>
              <dt>status</dt>
              <dd>{statusLabel(job.status)}</dd>
              <dt>skills</dt>
              <dd><span className="ok">{job.required_skills?.length ?? 0} required</span></dd>
              <dt>qa score</dt>
              <dd>{qa ? qa.score.toFixed(3) : "—"}</dd>
            </dl>
          </div>
        </aside>
      </section>

      {/* Approved Banner */}
      {job.status === "approved" && job.active_resume_id && (
        <section className="approved" role="status" aria-label="Resume ready">
          <div className="left">
            <div className="check" aria-hidden="true">✓</div>
            <div>
              <h2>RESUME READY</h2>
              <div className="sub mono">
                approved · {job.company_name?.toLowerCase().replace(/\s+/g, "_")}_{job.role_title?.toLowerCase().replace(/\s+/g, "_")}-tailored.pdf
              </div>
            </div>
          </div>
          <Link className="cta" to={`/jobs/${job.job_id}/resume/${job.active_resume_id}`}>
            VIEW RESUME <span className="ar" aria-hidden="true">→</span>
          </Link>
        </section>
      )}

      <div className="meta-row mono">
        <span>job_id · {job.job_id}</span>
        <span>iteration {job.iteration_count ?? 1}</span>
      </div>
    </main>
    </>
  );
}
