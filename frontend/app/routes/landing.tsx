import { useState } from "react";
import type { MetaFunction } from "react-router";
import "../styles/landing.css";

export const meta: MetaFunction = () => [
  { title: "Rendure — Tailor every resume. Apply on your terms." },
  {
    name: "description",
    content:
      "Self-hosted resume tailoring. Paste a job URL, Rendure scrapes, tailors, runs a QA pass, and stores every run in Postgres. It never submits anything — you review and apply yourself.",
  },
];

const GITHUB_URL = "https://github.com/KaustubhTrivedi/rendure-v2";
const BOOTSTRAP_COMMAND =
  "curl -fsSL https://raw.githubusercontent.com/KaustubhTrivedi/rendure-v2/main/scripts/bootstrap.sh | bash";

function Nav() {
  return (
    <nav className="nav">
      <span className="tag">
        <span className="sq"></span> SELF-HOSTED · <b>v0.4.1</b>
      </span>
      <div className="wordmark">
        <span className="dot"></span>RENDURE
      </div>
      <a className="press yellow navcta" href="#run">
        GET STARTED
      </a>
    </nav>
  );
}

function Terminal() {
  return (
    <div
      className="term"
      role="img"
      aria-label="Example pipeline run: Job Scout, Resume Tailor and Quality Analyst complete with QA score 0.94"
    >
      <div className="term-head">
        <span className="ttl">RUN · #0042</span>
        <span className="lights">
          <span></span>
          <span></span>
          <span></span>
        </span>
      </div>
      <div className="term-body">
        <div className="term-line">
          <span className="tball ok"></span>
          <span className="agent">JOB&nbsp;SCOUT</span>
          <span className="msg">
            scraped <span className="y">stripe.com/jobs</span> · senior swe
          </span>
          <span className="t">+0.0s</span>
        </div>
        <div className="term-line">
          <span className="tball ok"></span>
          <span className="agent">RESUME&nbsp;TAILOR</span>
          <span className="msg">rewrote 6 bullets · +4 keywords</span>
          <span className="t">+3.1s</span>
        </div>
        <div className="term-line">
          <span className="tball run"></span>
          <span className="agent">QUALITY&nbsp;ANALYST</span>
          <span className="msg">
            scoring composite<span className="g">…</span>
          </span>
          <span className="t">+4.8s</span>
        </div>
        <div className="term-line">
          <span className="tball idle"></span>
          <span className="agent">CONFIRMATION</span>
          <span className="msg">awaiting your review</span>
          <span className="t">—</span>
        </div>
        <div className="term-sep"></div>
        <div className="term-score">
          <span className="lab">QA COMPOSITE SCORE</span>
          <span className="val">0.94 ✓</span>
        </div>
        <div className="term-prompt">
          <span className="sym">rendure&nbsp;&gt;</span>
          <span>review v2</span>
          <span className="caret"></span>
        </div>
      </div>
    </div>
  );
}

function Hero() {
  return (
    <section className="wrap hero">
      <div>
        <span className="sec-tag mlabel">Resume tailoring · self-hosted</span>
        <h1>
          Tailor every resume.
          <br />
          <span className="mark">Apply</span> on your terms.
        </h1>
        <p className="lede">
          Paste a job URL. Rendure scrapes the posting, tailors your resume, runs an automated QA
          pass, and stores every run in Postgres. <b>It never submits anything</b> — you review the
          version and the QA notes, then apply yourself.
        </p>
        <div className="btns">
          <a className="press yellow" href="#run">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="#000"
              strokeWidth="2.5"
              strokeLinecap="square"
            >
              <path d="M4 12l5 5 11-11" />
            </svg>
            SELF-HOST IN 2 MIN
          </a>
          <a className="press" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
            <svg viewBox="0 0 24 24" fill="#000">
              <path d="M12 1.5a10.5 10.5 0 0 0-3.32 20.46c.52.1.71-.23.71-.5v-1.78c-2.92.64-3.54-1.25-3.54-1.25-.48-1.21-1.17-1.54-1.17-1.54-.95-.65.07-.64.07-.64 1.05.07 1.6 1.08 1.6 1.08.94 1.6 2.46 1.14 3.06.87.1-.68.37-1.14.67-1.4-2.33-.27-4.78-1.17-4.78-5.18 0-1.15.41-2.08 1.08-2.82-.11-.27-.47-1.34.1-2.78 0 0 .88-.28 2.88 1.07a9.96 9.96 0 0 1 5.24 0c2-1.35 2.88-1.07 2.88-1.07.57 1.44.21 2.51.1 2.78.67.74 1.08 1.67 1.08 2.82 0 4.02-2.45 4.9-4.79 5.16.38.33.71.97.71 1.96v2.9c0 .28.19.61.72.5A10.5 10.5 0 0 0 12 1.5Z" />
            </svg>
            VIEW ON GITHUB
          </a>
        </div>
        <div className="meta">
          <span>
            <span className="ok"></span> DOCKER COMPOSE UP
          </span>
          <span>
            <span className="ok"></span> YOUR KEYS, YOUR DB
          </span>
          <span>
            <span className="ok"></span> ZERO TELEMETRY
          </span>
        </div>
      </div>
      <Terminal />
    </section>
  );
}

type SpecRow = { k: string; v: string };

const SPEC: SpecRow[] = [
  { k: "Runtime", v: "Python 3.12" },
  { k: "Storage", v: "PostgreSQL" },
  { k: "Models", v: "via OpenRouter" },
  { k: "Interface", v: "Web + SSE" },
  { k: "Export", v: "RenderCV PDF" },
  { k: "Deploy", v: "Docker Compose" },
  { k: "License", v: "MIT" },
];

function About() {
  return (
    <section className="band" id="about">
      <div className="wrap">
        <span className="sec-tag mlabel">What is Rendure</span>
        <h2 className="band-title" style={{ marginBottom: 32 }}>
          A tailoring pipeline you actually own.
        </h2>
        <div className="about">
          <div className="prose">
            <p className="lead">
              Rendure turns a job posting into a tailored resume — and a paper trail you can audit.
            </p>
            <p>
              Point it at a job URL and a chain of small, single-purpose agents takes over: one
              scrapes the posting, one rewrites your resume against it, one grades the result, and a
              final one hands you a version to review. Each agent does exactly one job, writes what
              it learned to the database, and steps aside for the next.
            </p>
            <p>
              There's no shared cloud and no account to create. It runs on <b>your</b> machine, talks
              to language models through <b>your own</b> OpenRouter key, and records every job,
              resume version, QA score, and pipeline event in a Postgres database you control —
              nothing tucked away in a vendor's backend.
            </p>
            <p>
              Crucially, it stops at the resume. Rendure never clicks "apply." It does the tedious
              tailoring and quality checks, then leaves the judgment — and the submit button — to
              you.
            </p>
          </div>
          <div className="speccard" aria-label="Rendure technical specification">
            <div className="sc-head">SPEC</div>
            <dl>
              {SPEC.map((row) => (
                <div className="scrow" key={row.k}>
                  <dt>{row.k}</dt>
                  <dd>{row.v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </section>
  );
}

type Step = { n: string; t: string; d: string; a: boolean };

const STEPS: Step[] = [
  {
    n: "01",
    t: "Paste URL",
    d: "Drop a job-posting link into the composer. Job Scout scrapes the title, requirements, and keywords.",
    a: false,
  },
  {
    n: "02",
    t: "Tailor",
    d: "Resume Tailor rewrites bullets, surfaces matching skills, and aligns seniority language to the role.",
    a: true,
  },
  {
    n: "03",
    t: "QA pass",
    d: "Quality Analyst scores the draft against the JD across 4 weighted dimensions, gated at 0.92.",
    a: false,
  },
  {
    n: "04",
    t: "Review & export",
    d: "You read the version + gap notes, then export a clean RenderCV PDF. You decide where it goes.",
    a: false,
  },
];

function HowItWorks() {
  return (
    <section className="band" id="how">
      <div className="wrap">
        <span className="sec-tag mlabel">The pipeline</span>
        <h2>How it works</h2>
        <p className="blurb">
          A four-agent loop runs the whole thing — streamed to your screen over server-sent events.
          No black box: every step is logged, scored, and stored.
        </p>
        <div className="steps">
          {STEPS.map((s, i) => (
            <div className={"stepcard" + (s.a ? " accent" : "")} key={s.n}>
              <span className="n">{s.n}</span>
              {i < STEPS.length - 1 && <span className="arrow">→</span>}
              <span className="st">{s.t}</span>
              <span className="sd">{s.d}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

type Dimension = { label: string; weight: string; desc: string; fill: number; tag: string; gate?: boolean };

const DIMENSIONS: Dimension[] = [
  {
    label: "Keyword match",
    weight: "0.40",
    desc: "Fraction of the JD's keywords and required skills that actually appear in the resume.",
    fill: 40,
    tag: "Weight · 0.40",
  },
  {
    label: "Experience match",
    weight: "0.35",
    desc: "How many of the role's responsibilities are backed by real bullet points.",
    fill: 35,
    tag: "Weight · 0.35",
  },
  {
    label: "Seniority match",
    weight: "0.15",
    desc: "Whether the tone and scope of the resume align with the role's level.",
    fill: 15,
    tag: "Weight · 0.15",
  },
  {
    label: "Structure",
    weight: "GATE",
    desc: "All required sections present, no placeholders. A break here forces the whole score to zero.",
    fill: 100,
    tag: "Gate · +0.10",
    gate: true,
  },
];

function QAScoring() {
  return (
    <section className="band" id="scoring">
      <div className="wrap">
        <span className="sec-tag mlabel">The QA pass, in detail</span>
        <h2 className="band-title">Every draft is scored, not guessed.</h2>
        <p className="blurb">
          The Quality Analyst grades each tailored resume against the job description across four
          dimensions. A draft only passes when the weighted composite clears the threshold and the
          structure check holds — otherwise it loops back for another tailoring pass.
        </p>
        <div className="qa-grid">
          {DIMENSIONS.map((d) => (
            <div className={"qacard" + (d.gate ? " gate" : "")} key={d.label}>
              <span className="ql">{d.label}</span>
              <span className="qw">{d.weight}</span>
              <p className="qd">{d.desc}</p>
              <div className="meter">
                <span style={{ width: d.fill + "%" }}></span>
              </div>
              <span className="qtag">{d.tag}</span>
            </div>
          ))}
        </div>
        <div className="formula" aria-label="Composite score formula">
          <span className="c"># structure_valid = false forces composite to 0.000</span>
          {"\n"}
          composite = keyword<span className="k">·0.40</span> + experience<span className="k">·0.35</span>
          {" "}+ seniority<span className="k">·0.15</span> + <span className="k">0.10</span>
          {"\n"}
          pass = composite <span className="g">≥ 0.92</span> <span className="c">AND</span>{" "}
          structure_valid
        </div>
      </div>
    </section>
  );
}

type Stat = { label: string; num: string; sub: string; corner: string; active: boolean };

const STATS: Stat[] = [
  { label: "QA THRESHOLD", num: "0.92", sub: "composite gate", corner: "GATED", active: false },
  { label: "SELF-HOSTED", num: "100%", sub: "your machine", corner: "LOCAL", active: true },
  {
    label: "AUTO-SUBMITS",
    num: "0",
    sub: "you always decide",
    corner: "BY DESIGN",
    active: false,
  },
  {
    label: "AGENT PIPELINE",
    num: "4",
    sub: "scout · tailor · qa · confirm",
    corner: "PYTHON",
    active: false,
  },
];

function Stats() {
  return (
    <section className="band" id="stats">
      <div className="wrap">
        <span className="sec-tag mlabel">By the numbers</span>
        <h2 className="band-title" style={{ marginBottom: 36 }}>
          Built to be boring &amp; honest.
        </h2>
        <div className="stats">
          {STATS.map((s) => (
            <div className={"stat" + (s.active ? " active" : "")} key={s.label}>
              <span className="corner">{s.corner}</span>
              <div className="label">{s.label}</div>
              <div className="num">{s.num}</div>
              <div className="sub">{s.sub}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Trust() {
  return (
    <section className="band" id="trust">
      <div className="wrap">
        <div className="trust">
          <div className="big">
            0<small>auto-submits</small>
          </div>
          <div className="tx">
            <h3>Rendure never applies for you.</h3>
            <p>
              This is the boundary, and it's deliberate. Rendure prepares{" "}
              <b>tailored resume versions</b> and<b> QA notes</b> — nothing leaves your machine, and
              nothing gets submitted to an employer. You read the diff, you check the gaps, you
              decide where and when to apply. The robot does the busywork; the judgment stays yours.
            </p>
            <div className="pillrow">
              <span className="pill">
                <span className="x">✕</span> NO AUTO-APPLY
              </span>
              <span className="pill">
                <span className="x">✕</span> NO HIDDEN UPLOADS
              </span>
              <span className="pill">
                <span className="c">✓</span> YOU REVIEW EVERY VERSION
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

type Feature = { t: string; d: string; tags: string[]; icon: React.ReactNode };

const FEATURES: Feature[] = [
  {
    t: "Encrypted key storage",
    d: "Your OpenRouter API key is encrypted at rest. It powers the agents and never leaves your host.",
    tags: ["OPENROUTER", "AES"],
    icon: <path d="M5 11V8a7 7 0 0 1 14 0v3M4 11h16v9H4z" />,
  },
  {
    t: "Postgres audit trail",
    d: "Every run, version, score, and gap is written to Postgres. Full history, queryable, yours forever.",
    tags: ["POSTGRES", "AUDIT"],
    icon: (
      <g>
        <ellipse cx="12" cy="6" rx="8" ry="3" />
        <path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
      </g>
    ),
  },
  {
    t: "Live SSE progress",
    d: "Watch each agent work in real time over server-sent events — the same feed that streams to the dashboard.",
    tags: ["SSE", "REALTIME"],
    icon: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  },
  {
    t: "RenderCV PDF export",
    d: "Approved versions render to clean, ATS-safe PDFs via RenderCV. Typeset like a document, not a webpage.",
    tags: ["RENDERCV", "PDF"],
    icon: (
      <g>
        <path d="M6 2h9l5 5v15H6z" />
        <path d="M15 2v5h5" />
        <path d="M9 13h6M9 17h6" />
      </g>
    ),
  },
  {
    t: "Telegram notifications",
    d: "Optional pings when a run finishes or a QA pass fails. Send /start to your bot and paste the chat ID.",
    tags: ["TELEGRAM", "OPT-IN"],
    icon: <path d="M21 4L3 11l6 2 2 6 3-4 5 4z" />,
  },
  {
    t: "Multi-agent pipeline",
    d: "Scout, Tailor, Quality Analyst, and Confirmation — a Python pipeline you can read, fork, and extend.",
    tags: ["PYTHON", "4 AGENTS"],
    icon: (
      <g>
        <circle cx="6" cy="6" r="3" />
        <circle cx="18" cy="6" r="3" />
        <circle cx="12" cy="18" r="3" />
        <path d="M6 9v3h12V9M12 12v3" />
      </g>
    ),
  },
];

function Features() {
  return (
    <section className="band" id="features">
      <div className="wrap">
        <span className="sec-tag mlabel">What's inside</span>
        <h2 className="band-title" style={{ marginBottom: 36 }}>
          Everything runs on your box.
        </h2>
        <div className="features">
          {FEATURES.map((f) => (
            <div className="feat" key={f.t}>
              <div className="ico">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#000"
                  strokeWidth="2.2"
                  strokeLinecap="square"
                  strokeLinejoin="miter"
                >
                  {f.icon}
                </svg>
              </div>
              <h4>{f.t}</h4>
              <p>{f.d}</p>
              <div className="tags">
                {f.tags.map((tg) => (
                  <span key={tg}>{tg}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

type QA = { q: string; a: React.ReactNode };

const FAQS: QA[] = [
  {
    q: "Does Rendure submit applications for me?",
    a: (
      <>
        No — and it never will. It prepares <b>tailored resume versions</b> and QA notes; you review
        the diff and apply yourself. That boundary is deliberate, not a missing feature.
      </>
    ),
  },
  {
    q: "Where does my data live?",
    a: (
      <>
        On your machine. Jobs, resume versions, QA reviews, and pipeline events are written to{" "}
        <b>your own Postgres instance</b>, and your OpenRouter API key is encrypted at rest. There is
        no hosted backend and no telemetry.
      </>
    ),
  },
  {
    q: "Which language models does it use?",
    a: (
      <>
        Whatever you point it at through <b>OpenRouter</b>. Each agent — Scout, Tailor, Quality
        Analyst, Confirmation — ships with a sensible default model, and you can override any of them
        from Settings or environment variables.
      </>
    ),
  },
  {
    q: "Will it fabricate experience to match the job?",
    a: (
      <>
        No. The Resume Tailor rewrites and re-emphasizes what's <b>already in your base resume</b> —
        it won't invent skills, employers, or dates. Gaps it can't close honestly are surfaced as QA
        gaps rather than faked away.
      </>
    ),
  },
  {
    q: "How do I run it?",
    a: (
      <>
        Paste the bootstrap command into your terminal, then open the local web app and complete
        onboarding. No waitlist, no signup, no hosted tier to wait for.
      </>
    ),
  },
];

function FAQ() {
  return (
    <section className="band" id="faq">
      <div className="wrap">
        <span className="sec-tag mlabel">Questions</span>
        <h2 className="band-title" style={{ marginBottom: 36 }}>
          The short version.
        </h2>
        <div className="faq">
          {FAQS.map((item) => (
            <details key={item.q}>
              <summary>
                {item.q}
                <span className="pm" aria-hidden="true"></span>
              </summary>
              <div className="ans">{item.a}</div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCTA() {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard
      ?.writeText(BOOTSTRAP_COMMAND)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      })
      .catch(() => {});
  }
  return (
    <section className="band" id="run">
      <div className="wrap">
        <div className="finalcta">
          <h2>Clone it. Run it. Own it.</h2>
          <p className="p">
            No accounts, no SaaS dashboard, no waitlist. Pull the repo, set your key, and bring the
            whole pipeline up with one command.
          </p>
          <div>
            <div className="codeblock">
              <span className="sym">$</span>
              <span className="cmd">{BOOTSTRAP_COMMAND}</span>
              <button className="copy" onClick={copy} aria-label="Copy command">
                {copied ? "COPIED ✓" : "COPY"}
              </button>
            </div>
          </div>
          <div>
            <a className="press dark" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
              <svg viewBox="0 0 24 24" fill="#fff">
                <path d="M12 1.5a10.5 10.5 0 0 0-3.32 20.46c.52.1.71-.23.71-.5v-1.78c-2.92.64-3.54-1.25-3.54-1.25-.48-1.21-1.17-1.54-1.17-1.54-.95-.65.07-.64.07-.64 1.05.07 1.6 1.08 1.6 1.08.94 1.6 2.46 1.14 3.06.87.1-.68.37-1.14.67-1.4-2.33-.27-4.78-1.17-4.78-5.18 0-1.15.41-2.08 1.08-2.82-.11-.27-.47-1.34.1-2.78 0 0 .88-.28 2.88 1.07a9.96 9.96 0 0 1 5.24 0c2-1.35 2.88-1.07 2.88-1.07.57 1.44.21 2.51.1 2.78.67.74 1.08 1.67 1.08 2.82 0 4.02-2.45 4.9-4.79 5.16.38.33.71.97.71 1.96v2.9c0 .28.19.61.72.5A10.5 10.5 0 0 0 12 1.5Z" />
              </svg>
              CLONE AND RUN WITH DOCKER
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="wm">
        <span className="dot"></span>RENDURE
      </div>
      <div className="r">
        <span>
          SELF-HOSTED · <b>MIT LICENSE</b>
        </span>
        <span>·</span>
        <span>NO TELEMETRY</span>
        <span>·</span>
        <span>
          <b>v0.4.1</b>
        </span>
      </div>
    </footer>
  );
}

export default function Landing() {
  return (
    <div className="lp">
      <Nav />
      <main>
        <Hero />
        <About />
        <HowItWorks />
        <QAScoring />
        <Stats />
        <Trust />
        <Features />
        <FAQ />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
