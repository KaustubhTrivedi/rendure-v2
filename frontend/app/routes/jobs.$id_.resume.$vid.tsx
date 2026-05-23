import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router";
import { api, ApiError } from "~/lib/api";
import type { ResumeVersionSummary, JobDetail } from "~/lib/types";
import { Nav } from "../components/Nav";
import "../styles/resume-viewer.css";

export default function ResumeView() {
  const navigate = useNavigate();
  const { id, vid } = useParams();
  const [versions, setVersions] = useState<ResumeVersionSummary[]>([]);
  const [job, setJob] = useState<JobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(true);
  const [pdfError, setPdfError] = useState(false);
  const [showRawSource, setShowRawSource] = useState(false);
  const [rawSource, setRawSource] = useState<string | null>(null);

  useEffect(() => {
    if (!id || !vid) return;
    setLoading(true);
    setError(null);
    setPdfError(false);
    Promise.all([
      api.resumes.list(id),
      api.jobs.get(id) as Promise<JobDetail>,
    ])
      .then(([vers, j]) => {
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

  const pdfUrl = id && vid ? api.resumes.pdfUrl(id, vid) : "";

  const handleShowRaw = async () => {
    if (showRawSource) {
      setShowRawSource(false);
      return;
    }
    if (!id || !vid) return;
    if (!rawSource) {
      try {
        const src = await api.resumes.getMarkdown(id, vid);
        setRawSource(src);
      } catch {
        setRawSource("Failed to load source.");
      }
    }
    setShowRawSource(true);
  };

  if (loading) {
    return (
      <>
        <Nav variant="back" backTo={id ? `/jobs/${id}` : "/jobs"} backLabel="JOB DETAIL" />
        <main className="page resume-page">
          <div className="loading-state">Loading resume...</div>
        </main>
      </>
    );
  }

  if (error) {
    return (
      <>
        <Nav variant="back" backTo={id ? `/jobs/${id}` : "/jobs"} backLabel="JOB DETAIL" />
        <main className="page resume-page">
          <div className="error-state">{error}</div>
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
            <a href={pdfUrl} className="btn primary" download>
              <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="square">
                <path d="M12 3v13" /><path d="M6 11l6 6 6-6" /><path d="M4 21h16" />
              </svg>
              DOWNLOAD PDF
            </a>
            <button className="btn" onClick={handleShowRaw}>
              <svg viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="square">
                <path d="M4 6h16" /><path d="M4 12h10" /><path d="M4 18h16" />
              </svg>
              {showRawSource ? "SHOW PDF" : "RAW SOURCE"}
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
                V{v.version_number} {v.version_id === vid && <span className="check">&#10003;</span>}
              </button>
            ))}
          </div>
          <div className="version-meta">
            {sortedVersions.length} VERSION{sortedVersions.length !== 1 ? "S" : ""}
          </div>
        </div>

        {/* Two Column */}
        <div className="rv-grid">
          {/* Left: PDF Viewer or Raw Source */}
          <section className="viewer" aria-label="Resume PDF preview">
            <div className="viewer-toolbar">
              <div className="vt-group">
                <span className="vt-divider" />
                <div className="vt-filename">
                  <span style={{ width: 12, height: 14, background: "var(--white)", border: "2px solid var(--black)", display: "inline-block" }} />
                  resume.v{activeVersionNumber}.pdf
                </div>
              </div>

              <div className="vt-group right">
                <a className="vt-btn" href={pdfUrl} target="_blank" rel="noopener noreferrer" aria-label="Open in new tab">
                  <svg viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="square">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                </a>
                <a className="vt-btn" href={pdfUrl} download aria-label="Download">
                  <svg viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="square"><path d="M12 3v13" /><path d="M6 11l6 6 6-6" /><path d="M4 21h16" /></svg>
                </a>
              </div>
            </div>

            {/* Content area */}
            {showRawSource ? (
              <div className="viewer-stage">
                <pre className="raw-source">{rawSource ?? "Loading..."}</pre>
              </div>
            ) : pdfError ? (
              <div className="viewer-stage">
                <div className="pdf-error">
                  <div className="pdf-error-icon">PDF</div>
                  <p>PDF preview unavailable.</p>
                  <p className="pdf-error-detail">RenderCV may not be installed on the server. Use the download button to try downloading directly.</p>
                  <button className="btn" onClick={handleShowRaw}>VIEW RAW SOURCE</button>
                </div>
              </div>
            ) : (
              <div className="viewer-stage pdf-stage">
                <iframe
                  src={pdfUrl}
                  className="pdf-iframe"
                  title={`Resume V${activeVersionNumber} PDF`}
                  onError={() => setPdfError(true)}
                  onLoad={(e) => {
                    try {
                      const iframe = e.target as HTMLIFrameElement;
                      const ct = iframe.contentDocument?.contentType;
                      if (ct && !ct.includes("pdf")) {
                        setPdfError(true);
                      }
                    } catch {
                      // Cross-origin — PDF loaded from API, can't inspect. That's fine.
                    }
                  }}
                />
              </div>
            )}

            <div className="viewer-status">
              <div className="group">
                <span><span className={`dot-${pdfError ? "err" : "ok"}`} /> {pdfError ? "PDF UNAVAILABLE" : "RENDERCV"}</span>
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
                <div className="chev" aria-hidden="true">&#9660;</div>
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
