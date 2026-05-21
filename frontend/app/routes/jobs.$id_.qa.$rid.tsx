import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { Nav } from "../components/Nav";
import "../styles/qa-report.css";
import { api, ApiError } from "~/lib/api";
import type { QAReview, Job } from "~/lib/types";

function dimScore(score: number) {
  if (score >= 0.85) return { color: "green", ribbon: "STRONG" };
  if (score >= 0.70) return { color: "yellow", ribbon: "MODERATE" };
  return { color: "red", ribbon: "WEAK" };
}

export default function QAReport() {
  const { id = "", rid = "" } = useParams();
  const [job, setJob] = useState<Job | null>(null);
  const [review, setReview] = useState<QAReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [gapFilter, setGapFilter] = useState("all");
  const [rawOpen, setRawOpen] = useState(true);

  useEffect(() => {
    if (!id || !rid) return;
    setLoading(true);
    setError(null);
    setNotFound(false);
    Promise.all([api.jobs.get(id), api.qa.list(id)])
      .then(([jobData, reviews]) => {
        const found = reviews.find((r) => r.review_id === rid);
        if (!found) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        setJob(jobData);
        setReview(found);
        setLoading(false);
      })
      .catch((e) => {
        setError(e instanceof ApiError ? `API error ${e.status}` : "Network error");
        setLoading(false);
      });
  }, [id, rid]);

  if (loading) {
    return (
      <>
        <Nav variant="back" backTo={`/jobs/${id}`} backLabel="JOB DETAIL" />
        <main className="page qa-page">
          <div className="loading-state">Loading QA review...</div>
        </main>
      </>
    );
  }

  if (error) {
    return (
      <>
        <Nav variant="back" backTo={`/jobs/${id}`} backLabel="JOB DETAIL" />
        <main className="page qa-page">
          <div className="error-state">{error}</div>
        </main>
      </>
    );
  }

  if (notFound || !review) {
    return (
      <>
        <Nav variant="back" backTo={`/jobs/${id}`} backLabel="JOB DETAIL" />
        <main className="page qa-page">
          <div className="error-state">QA review not found</div>
        </main>
      </>
    );
  }

  const dimensions = [
    { name: "Keyword Match", desc: "overlap of JD required + preferred terms", score: review.keyword_match.toFixed(3), ...dimScore(review.keyword_match), weight: "0.40", delta: review.keyword_match.toFixed(3), pct: `${Math.round(review.keyword_match * 100)}%` },
    { name: "Experience Match", desc: "years & relevance vs JD requirements", score: review.experience_match.toFixed(3), ...dimScore(review.experience_match), weight: "0.35", delta: review.experience_match.toFixed(3), pct: `${Math.round(review.experience_match * 100)}%` },
    { name: "Seniority Match", desc: "title, scope & tone vs JD level", score: review.seniority_match.toFixed(3), ...dimScore(review.seniority_match), weight: "0.15", delta: review.seniority_match.toFixed(3), pct: `${Math.round(review.seniority_match * 100)}%` },
    { name: "Structure", desc: "1 page · standard sections · ATS-safe", score: review.structure_valid ? "✓" : "✕", color: review.structure_valid ? "green" : "red", ribbon: review.structure_valid ? "PASS" : "FAIL", weight: "0.10", delta: "GATE", pct: review.structure_valid ? "100%" : "0%", isCheck: true },
  ];

  const gaps = review.gaps;
  const gapCount = gaps.length;
  const highCount = gaps.filter((g) => g.severity === "high").length;
  const medCount = gaps.filter((g) => g.severity === "medium").length;
  const lowCount = gaps.filter((g) => g.severity === "low").length;
  const filteredGaps = gapFilter === "all" ? gaps : gaps.filter((g) => g.severity === gapFilter || (g.severity === "medium" && gapFilter === "med"));

  const rawLines = review.raw_feedback
    ? review.raw_feedback.split("\n").map((line, i) => ({
        ln: String(i + 1).padStart(3, "0"),
        tx: line,
      }))
    : [];

  const passed = review.passed;
  const score = review.score;
  const threshold = review.score_threshold;
  const companyName = job?.company_name ?? "Company";
  const roleTitle = job?.role_title ?? "Role";
  const dateStr = new Date(review.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).replace(",", "").toUpperCase();

  return (
    <>
      <Nav variant="back" backTo={`/jobs/${id}`} backLabel="JOB DETAIL" />
      <main className="page qa-page">
        {/* Page Header */}
        <header className="page-header">
          <div>
            <h1>QA REPORT</h1>
            <div className="subtitle">
              <b>{companyName}</b> · {roleTitle} · {dateStr}
            </div>
          </div>
          <div className={passed ? "pass-badge" : "fail-badge"}>
            <span className="x">{passed ? "✓" : "✕"}</span>
            {passed ? "PASS" : "FAIL"}
          </div>
        </header>

        {/* Composite Score */}
        <section className="composite" aria-label="Composite score">
          <div className="comp-label">COMPOSITE SCORE</div>
          <div className="comp-score">{score.toFixed(3)}</div>
          <div className="threshold">/ THRESHOLD <b>{threshold.toFixed(3)}</b></div>
          <div className={`comp-delta${passed ? " pass" : ""}`}>
            {passed ? `PASSED AT ${score.toFixed(3)}` : `FAILED BY ${(threshold - score).toFixed(3)}`}
          </div>
          <div className="comp-bar" aria-hidden="true">
            <div className="fill" style={{ width: `${Math.min(Math.round(score * 100), 100)}%` }} />
            <div className="tmark" style={{ left: `${Math.round(threshold * 100)}%` }} title={`threshold ${threshold}`} />
          </div>
          <div className="bar-axis">
            <span>0.00</span>
            <span><b>SCORE {score.toFixed(3)}</b></span>
            <span><b>THRESHOLD {threshold.toFixed(3)}</b></span>
            <span>1.00</span>
          </div>
        </section>

        {/* Dimension Cards */}
        <div className="section-label">Dimensions <span className="count">04</span></div>
        <div className="dims">
          {dimensions.map((d) => (
            <div key={d.name} className={`dim ${d.color}`} style={{ "--p": d.pct } as React.CSSProperties}>
              <span className="ribbon">{d.ribbon}</span>
              <div className="dim-name">{d.name}</div>
              <div className="dim-desc">{d.desc}</div>
              <div className={`dim-score${d.isCheck ? " check" : ""}`}>{d.score}</div>
              <div className="meter"><div className="f" /></div>
              <div className="dim-footer">
                <span>× <b>{d.weight}</b> weight</span>
                <span>{d.isCheck ? "Gate + bonus" : d.delta}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Gaps */}
        <div className="section-label">Gaps <span className="count">{String(gapCount).padStart(2, "0")}</span></div>
        <section className="gaps-card">
          <header className="gaps-head">
            <div className="gaps-title">GAPS <span className="gaps-count">{String(gapCount).padStart(2, "0")}</span></div>
            <div className="gaps-filters">
              {[
                { key: "all", label: `ALL · ${gapCount}` },
                { key: "high", label: `HIGH · ${highCount}` },
                { key: "med", label: `MED · ${medCount}` },
                { key: "low", label: `LOW · ${lowCount}` },
              ].map((f) => (
                <button
                  key={f.key}
                  className={`gap-filter${gapFilter === f.key ? " on" : ""}`}
                  onClick={() => setGapFilter(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </header>
          {filteredGaps.map((g, i) => {
            const sev = g.severity === "medium" ? "med" : g.severity;
            const catDisplay = g.category === "skills" ? "KEYWORDS" : g.category.toUpperCase();
            return (
              <div key={i} className="gap">
                <span className={`sev ${sev}`}>{sev === "med" ? "MED" : sev.toUpperCase()}</span>
                <span className="cat">{catDisplay}</span>
                <div className="detail">{g.detail}</div>
                <span className={`gap-dot ${sev}`} aria-hidden="true" />
              </div>
            );
          })}
        </section>

        {/* Raw Feedback */}
        <div className="section-label">Raw feedback</div>
        <section className={`raw${rawOpen ? "" : " collapsed"}`}>
          <header className="raw-head" onClick={() => setRawOpen(!rawOpen)}>
            <div className="raw-t">RAW FEEDBACK <span className="raw-meta">/ EVALUATOR TRANSCRIPT · <b>{rawLines.length} LINES</b></span></div>
            <div className="chev">▼</div>
          </header>
          <div className="raw-body">
            {rawLines.map((line, i) =>
              line.tx === "" || line.tx === null ? (
                <div key={i} className="row empty" />
              ) : (
                <div key={i} className="row">
                  <span className="ln">{line.ln}</span>
                  <span className="tx">{line.tx}</span>
                </div>
              )
            )}
          </div>
          <div className="raw-actions">
            <button className="a">COPY TRANSCRIPT</button>
            <button className="a">DOWNLOAD .JSON</button>
            <button className="a">RE-RUN EVAL</button>
          </div>
        </section>

        {/* Bottom CTA */}
        <div className="next-row">
          <div>
            <div className="next-t">{highCount > 0 ? `${highCount} HIGH-SEVERITY GAPS BLOCKING PASS` : "ALL GAPS RESOLVED"}</div>
            <div className="next-sub">
              {highCount > 0
                ? `FIX THEM AND RE-RUN — COMPOSITE ${score.toFixed(3)}`
                : passed
                  ? `PASSED AT ${score.toFixed(3)} — READY FOR REVIEW`
                  : `COMPOSITE ${score.toFixed(3)} AGAINST THRESHOLD ${threshold.toFixed(3)}`}
            </div>
          </div>
          <div className="btns">
            <button className="btn">REGENERATE</button>
            <button className="btn primary">FIX GAPS & RE-RUN →</button>
          </div>
        </div>
      </main>
    </>
  );
}
