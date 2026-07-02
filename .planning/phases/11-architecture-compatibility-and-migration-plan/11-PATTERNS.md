# Phase 11: Architecture, Compatibility, and Migration Plan - Pattern Map

**Mapped:** 2026-06-23
**Files analyzed:** 8
**Analogs found:** 8 / 8

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `api/src/job-submission.test.ts` | test | request-response + process spawn | `api/src/job-submission.test.ts` | exact |
| `api/src/routes/jobs.test.ts` | test | request-response + streaming + file-I/O | `api/src/routes/jobs.test.ts` | exact |
| `api/src/sse.ts` | utility | streaming transform | `api/src/sse.ts` | exact |
| `api/src/pg-listener.test.ts` or new migration/static test | test | pub-sub + static SQL check | `api/src/pg-listener.test.ts` | role-match |
| `database/008_compat_boundaries.sql` | migration | CRUD/schema | `database/007_discovery.sql`, `database/004_per_agent_models.sql`, `database/schema.sql` | role-match |
| `agents/audit_redaction.py` or `utils/audit_redaction.py` | utility | transform | `api/src/middleware/logger.ts`, `api/src/middleware/logger.test.ts` | partial |
| `tests/test_resume_tailor.py` | test | request-response agent + DB/LLM boundary | `tests/test_resume_tailor.py`, `agents/resume_tailor.py` | exact |
| `tests/test_quality_analyst.py` | test | request-response agent + DB/LLM boundary | `tests/test_quality_analyst.py`, `agents/quality_analyst.py` | exact |

## Pattern Assignments

### `api/src/job-submission.test.ts` (test, request-response + process spawn)

**Analog:** `api/src/job-submission.test.ts`

**Imports and boundary mocks** (lines 1-23):
```typescript
import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { submitJobUrl, statusUrl } from './job-submission.js'
import { pool } from './db.js'

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

vi.mock('./db.js', () => ({
  pool: {
    query: vi.fn(),
  },
}))
```

**Core compatibility pattern** (lines 54-108):
```typescript
it('inserts a new job, spawns the pipeline, and returns 202 with job_id, status, status_url', async () => {
  const child = mockChild()
  query
    .mockResolvedValueOnce({ rows: [] } as never)
    .mockResolvedValueOnce({ rows: [{ job_id: 'job-123' }] } as never)
    .mockResolvedValueOnce({ rows: [{ openrouter_api_key_enc: 'enc-key', preferred_model: 'anthropic/claude-3.5-sonnet', qa_threshold: 0.85, max_iterations: 3 }] } as never)

  const result = await submitJobUrl('https://example.com/job')

  expect(result.statusCode).toBe(202)
  const body = (result as { statusCode: 202; body: { job_id: string; status: string; status_url: string } }).body
  expect(body).toEqual({
    job_id: 'job-123',
    status: 'new',
    status_url: '/jobs/job-123/status',
  })
  expect(query).toHaveBeenNthCalledWith(
    2,
    `INSERT INTO jobs (job_url, status) VALUES ($1, 'new') RETURNING job_id`,
    ['https://example.com/job'],
  )
  expect(child.unref).toHaveBeenCalledOnce()
})
```

**No-profile/no-Vault fallback pattern** (lines 111-139):
```typescript
it('spawns without adding profile-derived overrides when no profile row exists', async () => {
  const child = mockChild()
  delete process.env.OPENROUTER_API_KEY
  delete process.env.OPENROUTER_MODEL
  delete process.env.QA_PASS_THRESHOLD
  delete process.env.MAX_TAILORING_ITERATIONS
  process.env.INHERITED_ONLY = 'keep-me'

  query
    .mockResolvedValueOnce({ rows: [] } as never)
    .mockResolvedValueOnce({ rows: [{ job_id: 'job-123' }] } as never)
    .mockResolvedValueOnce({ rows: [] } as never)

  const result = await submitJobUrl('https://example.com/job')

  expect(result.statusCode).toBe(202)
  const spawnEnv = spawnMock.mock.calls[0][2]?.env as Record<string, string>
  expect(spawnEnv).toMatchObject({ INHERITED_ONLY: 'keep-me' })
  expect(spawnEnv).not.toHaveProperty('OPENROUTER_API_KEY')
  expect(child.unref).toHaveBeenCalledOnce()
})
```

Use this file for COMPAT-01 tests proving URL submission remains independent of future Vault/evidence setup.

---

### `api/src/routes/jobs.test.ts` (test, request-response + streaming + file-I/O)

**Analog:** `api/src/routes/jobs.test.ts`

**Route test imports and shared mocks** (lines 1-33):
```typescript
import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import { beforeEach, afterEach, describe, expect, it, vi, beforeAll } from 'vitest'
import jobs from './jobs.js'
import { pool } from '../db.js'
import { toPipelineEventPayload } from '../sse.js'
import * as pgListener from '../pg-listener.js'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))
vi.mock('../db.js', () => ({ pool: { query: vi.fn() } }))
vi.mock('../pg-listener.js', () => ({ listenForPipelineEvents: vi.fn() }))

const query = vi.mocked(pool.query)
```

**SSE serializer compatibility pattern** (lines 160-189):
```typescript
it('serializes a pipeline event row into the stable SSE payload shape', () => {
  const row = {
    event_id: 'evt-001',
    job_id: 'job-123',
    event_type: 'status_change',
    agent_name: 'Job Scout',
    from_status: 'new',
    to_status: 'found',
    model_used: 'gemini-3-flash',
    detail: 'Pipeline started',
    metadata: { foo: 'bar' },
    timestamp: '2026-05-13T00:00:00.000Z',
  }
  const payload = toPipelineEventPayload(row)
  expect(payload).toEqual({
    event_id: 'evt-001',
    job_id: 'job-123',
    event_type: 'status_change',
    agent_name: 'Job Scout',
    from_status: 'new',
    to_status: 'found',
    model_used: 'gemini-3-flash',
    detail: 'Pipeline started',
    metadata: { foo: 'bar' },
    timestamp: '2026-05-13T00:00:00.000Z',
  })
  expect(payload).not.toHaveProperty('created_at')
  expect(payload).not.toHaveProperty('payload')
})
```

**SSE live delivery pattern** (lines 361-399):
```typescript
it('delivers a live event when pg notification fires for the same job_id', async () => {
  const { triggerAfterRegistered } = mockListener()
  const liveRow = {
    event_id: 'e2',
    job_id: 'job-1',
    event_type: 'status_change',
    agent_name: null,
    from_status: 'qa_review',
    to_status: 'approved',
    model_used: null,
    detail: null,
    metadata: null,
    timestamp: '2026-01-01T00:00:02Z',
  }
  vi.mocked(pool.query)
    .mockResolvedValueOnce({ rows: [{ job_id: 'job-1', status: 'qa_review' }] } as never)
    .mockResolvedValueOnce({ rows: [{ event_id: 'e1', job_id: 'job-1', event_type: 'status_change', agent_name: null, from_status: 'new', to_status: 'found', model_used: null, detail: null, metadata: null, timestamp: '2026-01-01T00:00:01Z' }] } as never)
    .mockResolvedValueOnce({ rows: [] } as never)
    .mockResolvedValueOnce({ rows: [liveRow] } as never)

  const res = await jobs.request('/job-1/events')
  expect(res.status).toBe(200)
  await triggerAfterRegistered({ job_id: 'job-1', event_id: 'e2' })
  const text = await drainStream(res.body)
  expect(text).toContain('"event_id":"e2"')
  expect(text).toContain('"to_status":"approved"')
})
```

**Resume/PDF compatibility pattern** (lines 597-647, 672-713):
```typescript
it('lists all resume versions for a job ordered by version_number', async () => {
  query
    .mockResolvedValueOnce({ rows: [{ job_id: 'job-123' }] } as never)
    .mockResolvedValueOnce({ rows: [{ version_id: 'ver-1', version_number: 1, created_at: '2026-05-14T10:00:00.000Z', tailoring_notes: 'Initial tailoring' }] } as never)

  const res = await jobs.request('/job-123/resumes')

  expect(res.status).toBe(200)
  await expect(res.json()).resolves.toEqual([
    { version_id: 'ver-1', version_number: 1, created_at: '2026-05-14T10:00:00.000Z', tailoring_notes: 'Initial tailoring' },
  ])
})

it('returns tailored source with text markdown content type', async () => {
  const source = 'cv:\n  name: Test\ndesign:\n  theme: sb2nov\n'
  query.mockResolvedValueOnce({ rows: [{ latex_source: source }] } as never)

  const res = await jobs.request('/job-123/resume/ver-123')

  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toContain('text/markdown; charset=utf-8')
  await expect(res.text()).resolves.toBe(source)
})
```

Extend this file for COMPAT-02 route response stability, SSE event name stability, and stable content types.

---

### `api/src/sse.ts` (utility, streaming transform)

**Analog:** `api/src/sse.ts`

**Stable event constants and terminal statuses** (lines 1-10):
```typescript
export const PIPELINE_SSE_EVENT = 'pipeline_event'

export const SSE_KEEPALIVE_MS = 30_000

export const SSE_KEEPALIVE_COMMENT = ': keepalive\n\n'

export const TERMINAL_STATUSES = new Set(['approved', 'low_match', 'error'])
```

**Serialization allowlist** (lines 39-52):
```typescript
export function toPipelineEventPayload(row: PipelineEventRow): PipelineEventPayload {
  return {
    event_id: row.event_id,
    job_id: row.job_id,
    event_type: row.event_type,
    agent_name: row.agent_name,
    from_status: row.from_status,
    to_status: row.to_status,
    model_used: row.model_used,
    detail: row.detail,
    metadata: row.metadata,
    timestamp: row.timestamp,
  }
}
```

Do not serialize `pipeline_events.payload` to clients. Additive fields should be explicit and tested before changing this allowlist.

---

### `api/src/pg-listener.test.ts` or new migration/static test (test, pub-sub + static SQL check)

**Analog:** `api/src/pg-listener.test.ts`

**Static SQL migration test pattern** (lines 1-27):
```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const MIGRATION_PATH = resolve(import.meta.dirname, '..', '..', 'database', '003_pipeline_events_notify.sql')

describe('003_pipeline_events_notify migration', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf-8')

  it('calls pg_notify with pipeline_events channel', () => {
    expect(sql).toContain('pg_notify(')
    expect(sql).toContain("'pipeline_events'")
  })

  it('does not include metadata or detail in notification payload', () => {
    expect(sql).not.toContain('metadata')
    expect(sql).not.toContain('NEW.detail')
  })
})
```

**LISTEN/NOTIFY boundary pattern** (lines 67-87):
```typescript
it('creates a dedicated pg.Client, connects, and LISTENs on pipeline_events', async () => {
  const onEvent = vi.fn()
  const listener = await listenForPipelineEvents(onEvent)

  expect(pg.Client).toHaveBeenCalledTimes(1)
  const client = vi.mocked(pg.Client).mock.results[0].value
  expect(client.connect).toHaveBeenCalledTimes(1)
  expect(client.query).toHaveBeenCalledWith('LISTEN pipeline_events')

  await listener.close()
})

it('invokes callback on valid notification payload', async () => {
  const onEvent = vi.fn()
  const listener = await listenForPipelineEvents(onEvent)
  triggerNotification.fire(JSON.stringify({ job_id: 'job-123', event_id: 'evt-001' }))
  expect(onEvent).toHaveBeenCalledWith({ job_id: 'job-123', event_id: 'evt-001' })
  await listener.close()
})
```

Use this structure for additive migration/static checks: read SQL from `database/`, assert `CREATE TABLE IF NOT EXISTS`/`ADD COLUMN IF NOT EXISTS`, and assert no `UPDATE jobs SET qa_score` or `UPDATE jobs SET iteration_count` outside trigger definitions.

---

### `database/008_compat_boundaries.sql` (migration, CRUD/schema)

**Analogs:** `database/004_per_agent_models.sql`, `database/007_discovery.sql`, `database/schema.sql`

**Additive column pattern** (`database/004_per_agent_models.sql` lines 1-6):
```sql
ALTER TABLE user_profile
  ADD COLUMN IF NOT EXISTS model_job_scout        TEXT,
  ADD COLUMN IF NOT EXISTS model_resume_tailor    TEXT,
  ADD COLUMN IF NOT EXISTS model_quality_analyst  TEXT,
  ADD COLUMN IF NOT EXISTS model_confirmation     TEXT,
  ADD COLUMN IF NOT EXISTS model_orchestrator     TEXT;
```

**Separate future-domain table/status pattern** (`database/007_discovery.sql` lines 49-66):
```sql
CREATE TABLE IF NOT EXISTS discovered_jobs (
    id              UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_url         TEXT    NOT NULL,
    title           TEXT    NOT NULL,
    company         TEXT    NOT NULL,
    location        TEXT,
    platform        TEXT    NOT NULL,
    raw_snippet     TEXT,
    relevance_score NUMERIC(4,3),
    status          TEXT    NOT NULL DEFAULT 'pending_review'
                            CHECK (status IN ('pending_review','queued','rejected','duplicate')),
    job_id          UUID    REFERENCES jobs(job_id) ON DELETE SET NULL,
    discovered_at   TIMESTAMPTZ DEFAULT NOW(),
    reviewed_at     TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS discovered_jobs_url_unique ON discovered_jobs (job_url);
```

**Trigger-owned columns source of truth** (`database/schema.sql` lines 149-185):
```sql
CREATE OR REPLACE FUNCTION update_iteration_count()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE jobs
    SET iteration_count = (
        SELECT COUNT(*)
        FROM resume_versions
        WHERE job_id = NEW.job_id
    )
    WHERE job_id = NEW.job_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_iteration_count
AFTER INSERT ON resume_versions
FOR EACH ROW
EXECUTE FUNCTION update_iteration_count();

CREATE OR REPLACE FUNCTION update_qa_score()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE jobs
    SET qa_score = NEW.score
    FROM resume_versions rv
    WHERE rv.version_id = NEW.version_id
    AND jobs.job_id = rv.job_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

Any Phase 11 migration should be additive and separate application workflow status from `jobs.status`.

---

### `agents/audit_redaction.py` or `utils/audit_redaction.py` (utility, transform)

**Analogs:** `api/src/middleware/logger.ts`, `api/src/middleware/logger.test.ts`, unsafe current prompt traces in `agents/resume_tailor.py` and `agents/quality_analyst.py`

**Allowlist logging pattern** (`api/src/middleware/logger.ts` lines 24-63):
```typescript
const JOB_ID_RE = /^\/jobs\/([^/]+)/

export function loggerMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const request_id = randomUUID()
    c.set('request_id', request_id)
    const start = performance.now()
    let threw: unknown
    try {
      await next()
    } catch (err) {
      threw = err
    }
    const duration_ms = Math.round(performance.now() - start)
    const path = c.req.path
    const match = path.match(JOB_ID_RE)
    const job_id = match ? match[1] : undefined

    const fields: Record<string, unknown> = {
      request_id,
      method: c.req.method,
      path,
      status: c.res.status,
      duration_ms,
    }
    if (job_id !== undefined) fields.job_id = job_id
    logger.info(fields)
  }
}
```

**Redaction-by-omission test pattern** (`api/src/middleware/logger.test.ts` lines 71-80):
```typescript
it('does not log X-API-Key header value or request body', async () => {
  const app = await makeApp()
  await app.request('/profile', {
    headers: { 'X-API-Key': 'super-secret-key' },
  })
  const logged = JSON.stringify(infoSpy.mock.calls[0][0])
  expect(logged).not.toContain('super-secret-key')
  expect(logged).not.toContain('X-API-Key')
  expect(logged).not.toContain('x-api-key')
})
```

**Current unsafe prompt trace to replace** (`agents/resume_tailor.py` lines 312-330):
```python
cur.execute(
    """
    INSERT INTO pipeline_events
        (job_id, event_type, agent_name, model_used, detail, payload)
    VALUES (%s, 'llm_prompt_trace', 'resume_tailor', %s, %s, %s::jsonb)
    """,
    (
        job_id,
        model,
        f"Tailoring prompt sent to LLM (iteration {iteration_number})",
        json.dumps({
            "direction": "resume_tailor→llm",
            "iteration": iteration_number,
            "prompt_length": len(prompt),
            "prompt": prompt,
        }),
    ),
)
```

**Current unsafe QA prompt trace to replace** (`agents/quality_analyst.py` lines 532-550):
```python
json.dumps({
    "direction": "quality_analyst→llm",
    "iteration": iteration_number,
    "version_id": version_id,
    "prompt_length": len(prompt),
    "prompt": prompt,
})
```

Target Python helper should produce allowlisted metadata such as `direction`, `iteration`, `version_id`, `prompt_length`, `prompt_sha256`, and `redacted: True`, never raw prompt, full resume, recruiter contact, private notes, or generated content.

---

### `tests/test_resume_tailor.py` (test, request-response agent + DB/LLM boundary)

**Analog:** `tests/test_resume_tailor.py`, `agents/resume_tailor.py`

**Pytest agent boundary pattern** (`tests/test_resume_tailor.py` lines 1-15):
```python
from unittest.mock import MagicMock

import agents.resume_tailor as resume_tailor


def test_resume_tailor_loads_base_resume_from_profile():
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__ = MagicMock(return_value=cursor)
    conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
    cursor.fetchone.return_value = ("cv:\n  name: Test Candidate\n\ndesign:\n  theme: sb2nov\n",)

    result = resume_tailor._load_base_resume_from_profile(conn)

    assert result == "cv:\n  name: Test Candidate\n\ndesign:\n  theme: sb2nov"
```

**Missing input error pattern** (`tests/test_resume_tailor.py` lines 18-30):
```python
def test_resume_tailor_reports_missing_profile_resume():
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__ = MagicMock(return_value=cursor)
    conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
    cursor.fetchone.return_value = None

    try:
        resume_tailor._load_base_resume_from_profile(conn)
    except resume_tailor.AgentError as exc:
        assert "No resume found" in str(exc)
    else:
        raise AssertionError("expected AgentError for missing profile resume")
```

**Resume Tailor DB/write pattern to preserve** (`agents/resume_tailor.py` lines 355-400):
```python
with conn.cursor() as cur:
    cur.execute(
        "SELECT 1 FROM allowed_transitions WHERE from_status = 'tailoring' AND to_status = 'qa_review'",
    )
    if not cur.fetchone():
        raise AgentError("Transition tailoring→qa_review not allowed.")

    cur.execute(
        """
        INSERT INTO resume_versions
            (job_id, version_number, git_branch, git_commit, latex_source, tailoring_notes)
        VALUES (%s, %s, NULL, NULL, %s, %s)
        RETURNING version_id
        """,
        (job_id, version_number, tailored_resume, tailoring_notes),
    )
    cur.execute(
        "UPDATE jobs SET status = 'qa_review', updated_at = NOW() WHERE job_id = %s",
        (job_id,),
    )
    cur.execute(
        """
        INSERT INTO pipeline_events
            (job_id, event_type, agent_name, from_status, to_status, model_used, detail)
        VALUES (%s, 'status_change', 'resume_tailor', 'tailoring', 'qa_review', %s, %s)
        """,
        (job_id, model, f"Resume tailored (iteration {iteration_number}). Version: {version_id}."),
    )
```

Use this file for no-Vault fallback and Resume Tailor prompt-redaction guardrails. Mock only DB/LLM boundaries.

---

### `tests/test_quality_analyst.py` (test, request-response agent + DB/LLM boundary)

**Analog:** `tests/test_quality_analyst.py`, `agents/quality_analyst.py`

**No-table fallback pattern** (lines 4-14):
```python
class ExplodingConnection:
    def cursor(self, *args, **kwargs):
        raise AssertionError("hard constraints should be loaded from disk, not user_profiles")


def test_quality_analyst_loads_hard_constraints_without_profile_table(tmp_path, monkeypatch):
    constraints_path = tmp_path / "hard_constraints.md"
    constraints_path.write_text("[DO NOT CLAIM]\n- Kubernetes\n", encoding="utf-8")
    monkeypatch.setattr(quality_analyst, "HARD_CONSTRAINTS_PATH", constraints_path)

    assert quality_analyst._get_hard_constraints(ExplodingConnection()) == "[DO NOT CLAIM]\n- Kubernetes"
```

**SQL column compatibility pattern** (lines 17-52):
```python
class RecordingCursor:
    def __init__(self):
        self.sql = ""
        self.params = ()

    def execute(self, sql, params):
        self.sql = sql
        self.params = params

    def fetchone(self):
        return ("review-123",)


def test_quality_analyst_inserts_only_columns_present_in_qa_reviews_schema():
    cursor = RecordingCursor()

    review_id = quality_analyst._insert_qa_review(
        cursor,
        version_id="version-123",
        composite_score=0.83,
        passed=False,
        pass_threshold=0.92,
        keyword_match=0.85,
        experience_match=0.75,
        seniority_match=0.85,
        structure_valid=True,
        gaps=[],
        raw_feedback="Needs stronger impact bullets.",
    )

    assert review_id == "review-123"
    assert "ats_parseable" not in cursor.sql
    assert "bullet_impact" not in cursor.sql
    assert len(cursor.params) == 10
```

**QA review insert pattern** (`agents/quality_analyst.py` lines 45-80):
```python
def _insert_qa_review(...):
    cur.execute(
        """
        INSERT INTO qa_reviews (
            version_id, score, passed, score_threshold,
            keyword_match, experience_match, seniority_match,
            structure_valid, gaps, raw_feedback
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s)
        RETURNING review_id
        """,
        (
            version_id,
            composite_score,
            passed,
            pass_threshold,
            keyword_match,
            experience_match,
            seniority_match,
            structure_valid,
            json.dumps(gaps),
            raw_feedback,
        ),
    )
    return str(cur.fetchone()[0])
```

Use this file for QA audit-redaction tests and schema compatibility assertions. Keep tests behavior-oriented and avoid mocking internal collaborators beyond DB/LLM/file boundaries.

## Shared Patterns

### TDD and Test Shape
**Source:** `.agents/skills/tdd/SKILL.md`
**Apply to:** All production changes in Phase 11

Use one behavior test at a time, then minimal implementation, then refactor. Do not write a broad horizontal batch of tests before implementation. Tests should verify behavior through public interfaces and mock only outer boundaries such as DB, subprocesses, HTTP, file, and LLM calls.

### API Compatibility
**Source:** `api/src/routes/jobs.ts`, `api/src/routes/jobs.test.ts`
**Apply to:** `POST /jobs`, `GET /jobs`, `GET /jobs/:id`, `GET /jobs/:id/status`, `GET /jobs/:id/events`, resume, PDF, and QA routes

Preserve existing route paths, status codes, response fields, content types, SSE event name `pipeline_event`, and omission of `pipeline_events.payload` from SSE.

### SQL Additive Migration
**Source:** `database/004_per_agent_models.sql`, `database/007_discovery.sql`, `database/schema.sql`
**Apply to:** Any Phase 11 schema scaffolding

Use `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE UNIQUE INDEX IF NOT EXISTS`, and guarded `ALTER TABLE ... ADD CONSTRAINT`. Keep application workflow statuses in separate tables. Do not add application statuses to `allowed_transitions` or `jobs.status`.

### Audit Redaction
**Source:** `api/src/middleware/logger.ts`, `agents/resume_tailor.py`, `agents/quality_analyst.py`
**Apply to:** Pipeline events, application timeline scaffolding, LLM metadata

Follow allowlist metadata: IDs, counts, status, bounded summaries, hashes, lengths, and `redacted: true`. Remove raw prompts from `llm_prompt_trace` payloads.

### Pipeline State
**Source:** `database/schema.sql`, `agents/resume_tailor.py`, `agents/quality_analyst.py`
**Apply to:** Agent status writes and tests

Validate transitions through `allowed_transitions` where existing agent code does so. Never write `jobs.qa_score` or `jobs.iteration_count` directly in application code or migrations; those are trigger-owned.

## No Analog Found

No planned file is completely without an analog. The weakest match is the Python audit redaction helper because the closest current safe pattern is the TypeScript logger allowlist; implement the Python helper by copying the allowlist/redaction-by-omission concept, not the middleware mechanics.

## Metadata

**Analog search scope:** `api/src/**/*.ts`, `api/src/**/*.test.ts`, `agents/**/*.py`, `tests/**/*.py`, `database/*.sql`, `.agents/skills/*/SKILL.md`
**Files scanned:** 18 primary files plus project skill indexes
**Pattern extraction date:** 2026-06-23
