import { useState, useEffect, useCallback } from "react";
import { api, ApiError } from "~/lib/api";
import type { DiscoveredJob } from "~/lib/types";
import { Nav } from "../components/Nav";
import "../styles/discover.css";

type FilterKey = "pending_review" | "queued" | "rejected" | "all";

type JobState = "pending_review" | "queued" | "rejected" | "approving";

const PLATFORM_LABEL: Record<string, string> = {
  greenhouse: "GREENHOUSE",
  lever: "LEVER",
  ashby: "ASHBY",
  indeed: "INDEED",
  workday: "WORKDAY",
  career: "CAREER PAGE",
};

function relClass(r: number | null): string {
  if (r === null) return "mid";
  return r >= 0.7 ? "hi" : r >= 0.4 ? "mid" : "lo";
}

function fmtScore(r: number | null): string {
  if (r === null) return "—";
  return r.toFixed(3);
}

function fmtLastScan(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return d.toLocaleDateString();
}

export default function Discover() {
  const [jobs, setJobs] = useState<DiscoveredJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterKey>("pending_review");
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState<string | null>(null);

  // Per-job UI state overrides (optimistic + animation)
  const [jobStates, setJobStates] = useState<Record<string, JobState>>({});
  const [flashingIds, setFlashingIds] = useState<Set<string>>(new Set());

  const loadJobs = useCallback(() => {
    return api.discovery.getJobs("all").then((res) => {
      setJobs(res.jobs);
      // Set lastScan from most recent discovered_at
      if (res.jobs.length > 0) {
        const latest = res.jobs.reduce((a, b) =>
          new Date(a.discovered_at) > new Date(b.discovered_at) ? a : b,
        );
        setLastScan(latest.discovered_at);
      }
    });
  }, []);

  useEffect(() => {
    loadJobs()
      .catch((e) =>
        setError(
          e instanceof ApiError
            ? String((e.body as Record<string, unknown>)?.message ?? e.body)
            : "Failed to load jobs",
        ),
      )
      .finally(() => setLoading(false));
  }, [loadJobs]);

  // Effective status: local override or API value
  function effectiveStatus(job: DiscoveredJob): JobState {
    return jobStates[job.id] ?? (job.status as JobState);
  }

  function handleApprove(job: DiscoveredJob) {
    setJobStates((prev) => ({ ...prev, [job.id]: "approving" }));
    setFlashingIds((prev) => new Set(prev).add(job.id));

    api.discovery
      .approve(job.id)
      .then(() => {
        // After flash animation (620ms), mark as queued
        setTimeout(() => {
          setJobStates((prev) => ({ ...prev, [job.id]: "queued" }));
          setFlashingIds((prev) => {
            const next = new Set(prev);
            next.delete(job.id);
            return next;
          });
        }, 620);
      })
      .catch(() => {
        // Revert on failure
        setJobStates((prev) => {
          const next = { ...prev };
          delete next[job.id];
          return next;
        });
        setFlashingIds((prev) => {
          const next = new Set(prev);
          next.delete(job.id);
          return next;
        });
      });
  }

  function handleReject(job: DiscoveredJob) {
    setJobStates((prev) => ({ ...prev, [job.id]: "rejected" }));
    api.discovery.reject(job.id).catch(() => {
      setJobStates((prev) => {
        const next = { ...prev };
        delete next[job.id];
        return next;
      });
    });
  }

  function handleRunDiscovery() {
    if (scanning) return;
    setScanning(true);
    api.discovery
      .run()
      .then(() => {
        setLastScan(new Date().toISOString());
      })
      .catch(() => {})
      .finally(() => {
        setTimeout(() => setScanning(false), 2600);
      });
  }

  // Counts
  const counts = {
    pending_review: jobs.filter(
      (j) => effectiveStatus(j) === "pending_review",
    ).length,
    queued: jobs.filter((j) => effectiveStatus(j) === "queued" || effectiveStatus(j) === "approving").length,
    rejected: jobs.filter((j) => effectiveStatus(j) === "rejected").length,
    all: jobs.length,
  };

  const pendingJobs = jobs.filter((j) => effectiveStatus(j) === "pending_review");
  const avgRelevance =
    pendingJobs.length > 0
      ? pendingJobs.reduce((s, j) => s + (j.relevance_score ?? 0), 0) /
        pendingJobs.length
      : null;

  function matchesFilter(job: DiscoveredJob): boolean {
    const s = effectiveStatus(job);
    if (activeFilter === "all") return true;
    if (activeFilter === "pending_review") return s === "pending_review";
    if (activeFilter === "queued") return s === "queued" || s === "approving";
    if (activeFilter === "rejected") return s === "rejected";
    return true;
  }

  const visibleJobs = jobs.filter(matchesFilter);

  return (
    <>
      <Nav variant="discover" pendingCount={counts.pending_review} />
      <main className="page">
        {/* Header */}
        <header className="head">
          <div>
            <h1>DISCOVER.</h1>
            <div className="sub">
              jobs found overnight · review to queue for tailoring
            </div>
          </div>
          <div className="right">
            <button
              className={`run-btn${scanning ? " scanning" : ""}`}
              onClick={handleRunDiscovery}
              disabled={scanning}
            >
              <span className="ico">{scanning ? "" : "↻"}</span>
              <span className="lbl">
                {scanning ? "SCANNING…" : "RUN DISCOVERY"}
              </span>
            </button>
          </div>
        </header>

        {/* Stats */}
        <section className="stats" aria-label="Discovery stats">
          <div className="stat active">
            <span className="corner mono">REVIEW</span>
            <div className="label">Pending</div>
            <div className="num mono">{counts.pending_review}</div>
            <div className="delta mono">found overnight</div>
          </div>
          <div className="stat approved">
            <div className="label">Queued</div>
            <div className="num mono">{counts.queued}</div>
            <div className="delta mono">▲ in pipeline</div>
          </div>
          <div className="stat failed">
            <div className="label">Rejected</div>
            <div className="num mono">{counts.rejected}</div>
            <div className="delta mono">▼ filtered out</div>
          </div>
          <div className="stat">
            <div className="label">Avg Relevance</div>
            <div className="num mono score">
              {avgRelevance !== null ? avgRelevance.toFixed(3) : "0.000"}
            </div>
            <div className="delta mono">
              {pendingJobs.length > 0
                ? `${pendingJobs.length} pending`
                : "no pending jobs"}
            </div>
          </div>
        </section>

        {/* Filters */}
        <div className="filters" aria-label="Filter discovered jobs">
          <span className="label">Filter</span>
          {(
            [
              { key: "pending_review", label: "Pending" },
              { key: "queued", label: "Queued" },
              { key: "rejected", label: "Rejected" },
              { key: "all", label: "All" },
            ] as { key: FilterKey; label: string }[]
          ).map((f) => (
            <span
              key={f.key}
              className={`pill${activeFilter === f.key ? " is-on" : ""}`}
              onClick={() => setActiveFilter(f.key)}
            >
              {f.label}
              <span className="count mono">
                ·{counts[f.key]}
              </span>
            </span>
          ))}
          <span className="spacer" />
          <span className="now mono">
            last scan · {lastScan ? fmtLastScan(lastScan) : "—"}
          </span>
        </div>

        {/* Review Table */}
        {loading ? (
          <div
            className="table"
            style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}
          >
            Loading…
          </div>
        ) : error ? (
          <div
            className="table"
            style={{ padding: "2rem", textAlign: "center", color: "var(--red)" }}
          >
            {error}
          </div>
        ) : visibleJobs.length === 0 ? (
          <section className="empty-panel" aria-label="No pending jobs">
            <div className="empty-head">
              <div className="ttl">▌ discovery · queue empty</div>
              <div className="lights" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            </div>
            <div className="empty-body">
              <span className="ln">
                <span className="p">$ rendure discover</span>
              </span>
              <span className="ln dim">
                → no {activeFilter === "all" ? "" : activeFilter.replace("_", " ")}{" "}
                jobs · run discovery to fetch new listings
                <span className="caret" />
              </span>
            </div>
          </section>
        ) : (
          <section className="discover-table" aria-label="Job review queue">
            <div className="scroll">
              <div className="d-row head-row">
                <div className="col">Job</div>
                <div className="col">Platform</div>
                <div className="col">Relevance</div>
                <div className="col">Snippet</div>
                <div className="col" style={{ textAlign: "right" }}>
                  Actions
                </div>
              </div>
              {visibleJobs.map((job) => {
                const s = effectiveStatus(job);
                const isFlashing = flashingIds.has(job.id);
                const isRejected = s === "rejected";

                return (
                  <div
                    key={job.id}
                    className={`d-row body-row${isFlashing ? " queued-flash" : ""}${isRejected ? " rejected-row" : ""}`}
                  >
                    {isFlashing ? (
                      <div className="queued-msg">→ QUEUED · entered tailoring pipeline</div>
                    ) : (
                      <>
                        <div className="col job">
                          <div className="company">
                            {job.company ?? "—"}
                          </div>
                          <div className="role">{job.title ?? "—"}</div>
                        </div>
                        <div className="col">
                          <span
                            className={`pbadge ${job.platform ?? "career"}`}
                          >
                            <span className="pd" />
                            {PLATFORM_LABEL[job.platform ?? "career"] ??
                              (job.platform?.toUpperCase() ?? "UNKNOWN")}
                          </span>
                        </div>
                        <div
                          className={`col relevance ${relClass(job.relevance_score)}`}
                        >
                          {fmtScore(job.relevance_score)}
                        </div>
                        <div className="col snippet">
                          {job.raw_snippet ?? "—"}
                        </div>
                        <div className="col">
                          {isRejected ? (
                            <div className="d-actions">
                              <span className="rej-tag">
                                <span className="pd" />
                                Rejected
                              </span>
                            </div>
                          ) : (
                            <div className="d-actions">
                              <button
                                className="act approve"
                                onClick={() => handleApprove(job)}
                                disabled={s === "approving"}
                              >
                                ✓ Approve
                              </button>
                              <button
                                className="act reject"
                                onClick={() => handleReject(job)}
                                disabled={s === "approving"}
                              >
                                ✗ Reject
                              </button>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <div className="meta-row mono">
          <span>self-hosted · all data local</span>
          <span>rendure v0.4.1 · discovery agent · cron 0 7 * * *</span>
        </div>
      </main>
    </>
  );
}
