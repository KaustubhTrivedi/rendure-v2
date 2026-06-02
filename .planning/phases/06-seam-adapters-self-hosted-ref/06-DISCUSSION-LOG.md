# Phase 6: Seam Adapters (Self-hosted Reference Implementation) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-02
**Phase:** 06-seam-adapters-self-hosted-ref
**Areas discussed:** DB adapter boundary, Agent-execution adapter shape, getLlmCredentials() scope, Adapter file organization

---

## DB Adapter Boundary

### TS side — what createDb() returns

| Option | Description | Selected |
|--------|-------------|----------|
| Return pg.Pool directly | createDb() returns raw pg.Pool; all existing call sites unchanged. Minimal change. | ✓ |
| Return a thin DB interface | Define DbClient with query()/connect()/end(). More future-proof for PGlite but premature. | |
| Return pg.Pool now, extract interface in Phase 10a | Start concrete, extract shared interface when PGlite lands. | |

**User's choice:** Return pg.Pool directly
**Notes:** Keeps it minimal. Phase 10a will extract the interface when PGlite's surface is known.

### Python side — how agents get connections

| Option | Description | Selected |
|--------|-------------|----------|
| Provide get_connection() function | Reads config.db.connectionString, returns psycopg2 connection. Agents migrate to it. | ✓ |
| Leave Python DB adapter to Phase 7 | Phase 7 lifts all DB I/O out anyway — skip the intermediate step. | |
| Provide adapter but don't migrate agents yet | Create adapter, let Phase 7 do the agent migration. | |

**User's choice:** Provide get_connection() function — agents migrate now
**Notes:** Agents switch from os.environ["DATABASE_URL"] to get_connection() in this phase.

---

## Agent-Execution Adapter Shape

### Interface design

| Option | Description | Selected |
|--------|-------------|----------|
| runPipeline(url, jobId) → void | Fire-and-forget. Adapter owns full subprocess lifecycle. | ✓ |
| runPipeline(url, jobId) → { pid, cleanup } | Returns handle for tracking. Adds unused surface area. | |
| runPipeline(url, jobId, onError) | Fire-and-forget with error callback. | |

**User's choice:** Fire-and-forget void function
**Notes:** None

### Error handling location

| Option | Description | Selected |
|--------|-------------|----------|
| Inside the adapter | Adapter owns spawn + error listener + writing error pipeline_events to DB. | ✓ |
| In job-submission.ts via callback | Adapter fires callback; job-submission.ts writes pipeline_event. | |

**User's choice:** Inside the adapter
**Notes:** Clean separation — each target's adapter handles errors its own way.

---

## getLlmCredentials() Scope

### Breadth

| Option | Description | Selected |
|--------|-------------|----------|
| LLM keys only | OPENROUTER_API_KEY + Codex OAuth token. Model routing stays in orchestrator. | ✓ |
| All external service credentials | Single resolver for OPENROUTER, JINA, TELEGRAM, ENCRYPTION keys. | |
| LLM keys + model routing together | API key + resolved model name per agent. Mixes concerns. | |

**User's choice:** LLM keys only
**Notes:** JINA_API_KEY deferred to Phase 8. MODEL_* routing is config, not credentials.

### TS side needed?

| Option | Description | Selected |
|--------|-------------|----------|
| Python-only for now | Hono API doesn't call LLMs. TS config.credentials stays empty. | ✓ |
| Stub in both languages | Empty getLlmCredentials() on TS for symmetry. | |

**User's choice:** Python-only
**Notes:** TS credentials adapter deferred until Phase 10b BYOK creates a use case.

---

## Adapter File Organization

### TS file placement

| Option | Description | Selected |
|--------|-------------|----------|
| Flat alongside existing code | api/src/db-adapter.ts, api/src/execution-adapter.ts. Discoverable. | ✓ |
| adapters/ directory per runtime | api/src/adapters/db.ts. Groups adapter code. More structure. | |
| Organized by target | adapters/self-hosted/db.ts. Premature for Phase 6. | |

**User's choice:** Flat alongside existing code
**Notes:** No new directory hierarchy.

### Python adapter structure

| Option | Description | Selected |
|--------|-------------|----------|
| Single adapters.py | One file with get_connection() + get_llm_credentials(). Under 50 lines. | ✓ |
| adapters/ package | __init__.py + db.py + credentials.py. Cleaner if adapters grow. | |

**User's choice:** Single adapters.py at project root
**Notes:** Matches config.py being a single file.

---

## Claude's Discretion

- Exact function signatures and parameter types beyond the locked interface shapes
- Whether db.ts is replaced in-place or kept as a re-export from db-adapter.ts
- How config.ts/config.py seam sub-objects are extended for adapter data

## Deferred Ideas

- Abstract DB interface for PGlite compatibility → Phase 10a
- TS credentials adapter → Phase 10b (BYOK)
- JINA_API_KEY consolidation → Phase 8 (scraper endpoint)
- Retiring db.ts as a separate module → planner decides migration path
