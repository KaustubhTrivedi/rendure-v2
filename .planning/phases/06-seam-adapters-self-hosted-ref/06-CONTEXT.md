# Phase 6: Seam Adapters (Self-hosted Reference Implementation) - Context

**Gathered:** 2026-06-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Three named adapter seams — DB, agent-execution, and secrets/keys — each with a
self-hosted implementation that wraps existing code without changing any behavior.
After this phase, `config.db`, `config.execution`, and `config.credentials` sub-objects
drive real adapter logic. Downstream phases (cloud, browser) implement alternative
adapters behind the same interfaces.

**In scope:** DB adapter (TS + Python), agent-execution adapter (TS only),
getLlmCredentials resolver (Python only), migrating existing call sites to use adapters,
full vitest + pytest green.

**Out of scope:** Cloud/browser adapter implementations (Phase 9/10), stateless agent
refactor (Phase 7 — agents keep their current structure, just source DB connections and
credentials through adapters), server-side scraper (Phase 8).

</domain>

<decisions>
## Implementation Decisions

### DB adapter boundary
- **D-01:** `createDb()` on the TS side returns a raw `pg.Pool`. It reads
  `config.db.connectionString` and constructs the Pool. All existing call sites
  (`api/src/db.ts` consumers) keep using Pool methods unchanged. The current
  `api/src/db.ts` module is replaced by the adapter — it becomes the adapter.
- **D-02:** On the Python side, a `get_connection()` function reads
  `config.db.connectionString` and returns a `psycopg2` connection. Agents migrate
  from `psycopg2.connect(os.environ["DATABASE_URL"])` to calling `get_connection()`.
  Same connection object, different source.
- **D-03:** No abstract DB interface yet — return the concrete types (`pg.Pool`,
  `psycopg2.connection`). Phase 10a will extract a minimal shared interface when
  PGlite's actual surface is known.

### Agent-execution adapter
- **D-04:** `runPipeline(url, jobId)` → `void`. Fire-and-forget. Self-hosted impl
  owns the full subprocess lifecycle: spawn `uv run python run_agents.py`, attach
  error listener, write error `pipeline_events` to DB on spawn failure.
- **D-05:** Error handling lives inside the adapter, not in `job-submission.ts`.
  The adapter takes a DB reference (pool) to write error events. `job-submission.ts`
  calls `runPipeline()` and is fully decoupled from subprocess details.
- **D-06:** This adapter is TS-only (the API spawns agents). No Python-side execution
  adapter needed — the Python orchestrator IS the execution.

### getLlmCredentials() scope
- **D-07:** `getLlmCredentials()` returns LLM API keys only: `OPENROUTER_API_KEY`
  (and Codex OAuth token when present). Model routing (`MODEL_*` env vars) stays in
  the orchestrator where it already lives — that's config, not credentials.
- **D-08:** `JINA_API_KEY` is not included — it's a service key, not an LLM key.
  Phase 8 (scraper endpoint) will consolidate it when the server-side scraper lands.
- **D-09:** Python-only. The Hono API doesn't make LLM calls. The TS
  `config.credentials` sub-object stays empty until a TS use case emerges (Phase 10b
  BYOK may add one).

### Adapter file organization
- **D-10:** TS adapters live flat in `api/src/` next to what they replace:
  `api/src/db-adapter.ts` (next to `db.ts`), `api/src/execution-adapter.ts` (next to
  `job-submission.ts`). Discoverable, no new directory hierarchy.
- **D-11:** Python adapters live in a single `adapters.py` file at project root (next
  to `config.py`). Contains `get_connection()` and `get_llm_credentials()`. Simple
  import: `from adapters import get_connection`. Matches `config.py` being a single file.
- **D-12:** When cloud/browser adapters land in later phases, the decision on whether
  to extract a directory structure is revisited then — don't pre-build it.

### Claude's Discretion
- Exact function signatures and parameter types for the adapters (beyond the interface
  shapes locked above).
- Whether `db.ts` is replaced in-place or kept as a re-export from `db-adapter.ts`
  (backwards compat for existing imports).
- How `config.ts` / `config.py` seam sub-objects are extended to carry the data the
  adapters need (e.g. adding `connectionString` to `config.db` was done in Phase 5;
  adding execution/credentials fields is planner's call).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements
- `.planning/ROADMAP.md` §"Phase 6: Seam Adapters (Self-hosted Reference Implementation)"
  — goal, success criteria, requirement mapping (SEAM-01 through SEAM-04).
- `.planning/REQUIREMENTS.md` §"SEAM — Adapter boundaries" — authoritative requirement
  statements for SEAM-01/02/03/04.

### Config foundation (Phase 5 — this phase builds on it)
- `api/src/config.ts` — TS config singleton with `resolve()` function, `ConfigSeamSettings`
  type, and frozen `config.db`/`config.execution`/`config.credentials` sub-objects.
- `config.py` — Python config singleton with `resolve()` function and frozen `Config`
  dataclass.
- `.planning/phases/05-deploy-target-foundation/05-CONTEXT.md` — Phase 5 decisions
  (D-01 through D-12) that this phase inherits.

### Current code to wrap (adapter insertion points)
- `api/src/db.ts` — current `pg.Pool` export; becomes the DB adapter.
- `api/src/job-submission.ts:145-167` — subprocess spawn site; becomes the execution adapter.
- `api/src/crypto.ts:17` — `PROFILE_ENCRYPTION_KEY` read (NOT in scope for credentials
  adapter, but note for awareness).
- `agents/orchestrator.py:44-61` — `MODEL_*` env reads + `AGENT_MODELS` dict (stays here,
  not moved to credentials adapter).
- `agents/orchestrator.py:72`, `agents/job_scout.py:70`, `agents/quality_analyst.py:364`,
  `agents/confirmation.py:31` — `psycopg2.connect(os.environ["DATABASE_URL"])` sites to
  migrate to `get_connection()`.
- `utils/llm.py:130` — `OPENROUTER_API_KEY` read (moves to `get_llm_credentials()`).

### Project-level constraints
- `.planning/PROJECT.md` §"The three seams" + §"Constraints" — one-switch /
  no-scattered-conditionals constraint, self-hosted-stays-green rule.
- `CLAUDE.md` §12 "Environment Variables Reference" — canonical var list.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `api/src/config.ts` already exports `config.db.connectionString` for self-hosted —
  the DB adapter can read it directly without any config changes.
- `config.py` already exports `config.db["connectionString"]` — same story for Python.
- `api/src/job-submission.ts` subprocess spawn logic (lines 145-167) is self-contained
  and can be extracted almost verbatim into the execution adapter.

### Established Patterns
- TS modules use `import { pool } from './db.js'` — the adapter must preserve this
  import path or provide a clean migration.
- Python agents all follow the same pattern: `load_dotenv()` then
  `psycopg2.connect(os.environ["DATABASE_URL"])` in a helper function — migration to
  `get_connection()` is mechanical.
- `utils/llm.py` centralizes LLM client construction via `load_llm()` — credentials
  adapter feeds into this existing function.

### Integration Points
- `api/src/db.ts` is imported by: `job-submission.ts`, `sse.ts`, `pg-listener.ts`,
  `telegram-notifier.ts`, and route handlers. All must work after the adapter swap.
- `job-submission.ts` is the single pipeline-spawn site — the execution adapter wraps
  exactly this one call path.
- Python `adapters.py` will be imported by all four agent modules + `utils/llm.py`.

</code_context>

<specifics>
## Specific Ideas

- The TS DB adapter should be a drop-in replacement for `db.ts` — existing `import { pool }`
  statements should continue to work, either by replacing `db.ts` in-place or re-exporting.
- `runPipeline()` receives the DB pool as a parameter so it can write error events without
  importing `db.ts` directly (avoids circular dependency if `job-submission.ts` imports the
  execution adapter which imports the DB adapter).

</specifics>

<deferred>
## Deferred Ideas

- **Abstract DB interface for PGlite compatibility** — defer to Phase 10a when PGlite's
  actual query surface is known; extract the minimal shared interface then.
- **TS credentials adapter** — defer until Phase 10b (BYOK) creates a TS-side need for
  credential resolution.
- **JINA_API_KEY consolidation** — defer to Phase 8 (server-side scraper) which moves
  Jina usage server-side.
- **Retiring `db.ts` as a separate module** — if the adapter replaces it in-place, the old
  module may become redundant. Planner decides the cleanest migration path.

</deferred>

---

*Phase: 6-seam-adapters-self-hosted-ref*
*Context gathered: 2026-06-02*
