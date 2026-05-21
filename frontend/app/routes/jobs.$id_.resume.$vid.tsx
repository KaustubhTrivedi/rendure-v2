import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, ApiError } from "~/lib/api";
import type { ResumeVersionSummary, JobDetail } from "~/lib/types";
import { Nav } from "../components/Nav";
import "../styles/resume-viewer.css";

export default function ResumeView() {
  const navigate = useNavigate();
  const { id, vid } = useParams();
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [versions, setVersions] = useState<ResumeVersionSummary[]>([]);
  const [job, setJob] = useState<JobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(true);
  const [zoom, setZoom] = useState(100);

  const ZSTEPS = [50, 75, 90, 100, 110, 125, 150, 175, 200];

  useEffect(() => {
    if (!id || !vid) return;
    setLoading(true);
    setError(null);
    Promise.all([
      api.resumes.getMarkdown(id, vid),
      api.resumes.list(id),
      api.jobs.get(id) as Promise<JobDetail>,
    ])
      .then(([md, vers, j]) => {
        setMarkdown(md);
        setVersions(vers);
        setJob(j);
      })
      .catch((e) => {
        if (e instanceof ApiError) {
          setError(e.status === 404 ? "Resume not found" : `Error ${e.status}`);
        } else {
          setError("Failed to load resume");
        }
      })
      .finally(() => setLoading(false));
  }, [id, vid]);

  const activeVersion = versions.find((v) => v.version_id === vid);
  const activeVersionNumber = activeVersion?.version_number ?? 0;
  const sortedVersions = [...versions].sort((a, b) => a.version_number - b.version_number);

  const tailoringNotes = activeVersion?.tailoring_notes
    ? activeVersion.tailoring_notes.split("\n").filter(Boolean)
    : [];

  const qaReview = job?.qa_review ?? null;
  const keywordGaps = qaReview?.gaps?.filter((g) => g.category === "skills") ?? [];
  const matchScore = qaReview ? Math.round(qaReview.score * 100) : null;

  const zoomIn = () => {
    const next = ZSTEPS.find((z) => z > zoom);
    if (next) setZoom(next);
  };
  const zoomOut = () => {
    const prev = [...ZSTEPS].reverse().find((z) => z < zoom);
    if (prev) setZoom(prev);
  };

  if (loading) {
    return (
      <>
        <Nav variant="back" backTo={id ? `/jobs/${id}` : "/jobs"} backLabel="JOB DETAIL" />
        <main className="page resume-page">
          <div className="loading-state">Loading resume…</div>
        </main>
      </>
    );
  }

  if (error || !markdown) {
    return (
      <>
        <Nav variant="back" backTo={id ? `/jobs/${id}` : "/jobs"} backLabel="JOB DETAIL" />
        <main className="page resume-page">
          <div className="error-state">{error ?? "Resume not available"}</div>
        </main>
      </>
    );
  }

  return (
    <>
      <Nav variant="back" backTo={`/jobs/${id}`} backLabel="JOB DETAIL" />
      <main className="page resume-page">
        {/* Page Header */}
        <header className="page-header">
          <div>
            <h1>RESUME</h1>
            <div className="subtitle">
              V{activeVersionNumber} — <b>{job?.company_name ?? "COMPANY"}</b> · {job?.role_title ?? "ROLE"} · TAILORED {activeVersion?.created_at ? new Date(activeVersion.created_at).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }).toUpperCase() : ""}
            </div>
          </div>
          <div className="actions">
            <a href={api.resumes.pdfUrl(id!, vid!)} className="btn primary" download>
              <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="square">
                <path d="M12 3v13" /><path d="M6 11l6 6 6-6" /><path d="M4 21h16" />
              </svg>
              DOWNLOAD PDF
            </a>
            <button className="btn">
              <svg viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="square">
                <path d="M4 6h16" /><path d="M4 12h10" /><path d="M4 18h16" />
              </svg>
              RAW MARKDOWN
            </button>
          </div>
        </header>

        {/* Version Switcher */}
        <div className="version-row">
          <div className="version-label">VERSIONS</div>
          <div className="version-pills">
            {sortedVersions.map((v) => (
              <button
                key={v.version_id}
                className={`rv-pill${v.version_id === vid ? " active" : ""}`}
                onClick={() => navigate(`/jobs/${id}/resume/${v.version_id}`)}
              >
                V{v.version_number} {v.version_id === vid && <span className="check">✓</span>}
              </button>
            ))}
          </div>
          <div className="version-meta">
            {sortedVersions.length} VERSION{sortedVersions.length !== 1 ? "S" : ""}
          </div>
        </div>

        {/* Two Column */}
        <div className="rv-grid">
          {/* Left: PDF Viewer */}
          <section className="viewer" aria-label="Resume PDF preview">
            <div className="viewer-toolbar">
              <div className="vt-group">
                <button className="vt-btn" aria-label="Previous page" disabled>
                  <svg viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="square"><path d="M15 6l-6 6 6 6" /></svg>
                </button>
                <div className="vt-pageinput">
                  <input className="field" defaultValue="1" />
                  <span className="total">/ 1</span>
                </div>
                <button className="vt-btn" aria-label="Next page" disabled>
                  <svg viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="square"><path d="M9 6l6 6-6 6" /></svg>
                </button>
                <span className="vt-divider" />
                <div className="vt-zoom" role="group" aria-label="Zoom">
                  <button onClick={zoomOut} aria-label="Zoom out">−</button>
                  <span className="level">{zoom}%</span>
                  <button onClick={zoomIn} aria-label="Zoom in">+</button>
                </div>
                <button className="vt-btn" aria-label="Fit to width">
                  <svg viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="square">
                    <path d="M4 8V4h4" /><path d="M20 8V4h-4" /><path d="M4 16v4h4" /><path d="M20 16v4h-4" />
                  </svg>
                </button>
              </div>

              <div className="vt-filename">
                <span style={{ width: 12, height: 14, background: "var(--white)", border: "2px solid var(--black)", display: "inline-block" }} />
                resume.v{activeVersionNumber}.pdf
              </div>

              <div className="vt-group right">
                <button className="vt-btn" aria-label="Search">
                  <svg viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="square"><circle cx="11" cy="11" r="6" /><path d="M20 20l-4-4" /></svg>
                </button>
                <button className="vt-btn" aria-label="Print">
                  <svg viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="square"><path d="M7 9V3h10v6" /><rect x="4" y="9" width="16" height="9" /><path d="M7 14h10v7H7z" /></svg>
                </button>
                <button className="vt-btn" aria-label="Download">
                  <svg viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="square"><path d="M12 3v13" /><path d="M6 11l6 6 6-6" /><path d="M4 21h16" /></svg>
                </button>
              </div>
            </div>

            {/* Dark stage with paper */}
            <div className="viewer-stage">
              <article
                className="paper"
                style={{
                  transform: `scale(${zoom / 100})`,
                  transformOrigin: "top center",
                  transition: "transform .15s ease",
                }}
              >
                <div className="markdown-content">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
                </div>
              </article>
            </div>

            <div className="viewer-status">
              <div className="group">
                <span><span className="dot-ok" /> RENDERED OK</span>
                <span>FILE · <b>resume.v{activeVersionNumber}.pdf</b></span>
                <span>VERSION <b>{activeVersionNumber}</b></span>
              </div>
              <div className="group">
                <span>{activeVersion ? new Date(activeVersion.created_at).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }).toUpperCase() : ""}</span>
              </div>
            </div>
          </section>

          {/* Right: Sidebar */}
          <aside className="rv-sidebar">
            <section className={`panel${notesOpen ? "" : " collapsed"}`}>
              <header className="panel-head" onClick={() => setNotesOpen(!notesOpen)}>
                <div className="panel-title">
                  TAILORING NOTES <span className="panel-count">{tailoringNotes.length.toString().padStart(2, "0")}</span>
                </div>
                <div className="chev" aria-hidden="true">▼</div>
              </header>
              <div className="panel-body">
                <div className="note-meta">
                  <span>VERSION <b>V{activeVersionNumber}</b></span>
                  <span>GENERATED {activeVersion ? new Date(activeVersion.created_at).toLocaleDateString("en-US", { day: "numeric", month: "short" }).toUpperCase() : ""}</span>
                </div>
                <ul className="notes">
                  {tailoringNotes.map((note, i) => {
                    const tag = note.startsWith("ADD") ? "add" : note.startsWith("CUT") || note.startsWith("RM") ? "rm" : "edit";
                    const label = tag === "add" ? "ADD" : tag === "rm" ? "CUT" : "EDIT";
                    return (
                      <li key={i}>
                        <span className={`tag ${tag}`}>{label}</span>
                        {note}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </section>

            <div className="score-row">
              <div className="score-cell">
                <div className="k">JD Match</div>
                <div className="v">{matchScore !== null ? matchScore : "—"}</div>
              </div>
              <div className="score-cell">
                <div className="k">Keywords</div>
                <div className="v">{qaReview ? `${Math.round((qaReview.keyword_match ?? 0) * 100)}%` : "—"}</div>
              </div>
            </div>

            <div className="keyword-panel">
              <div className="kh">
                KEYWORDS
                <span className="legend">HIT · MISS</span>
              </div>
              <div className="kb">
                {keywordGaps.length === 0 && <span className="kw miss">No keyword data</span>}
                {keywordGaps.map((g) => (
                  <span key={g.detail} className={`kw ${g.severity === "low" ? "hit" : "miss"}`}>
                    {g.detail}
                  </span>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </main>
    </>
  );
}
