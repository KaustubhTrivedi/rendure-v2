# Phase 12: Career Vault Schema and API Foundation - Context

**Gathered:** 2026-06-25
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase establishes the persistent, editable **data foundation and API** for approved Career Vault evidence: source artifacts, profile/career preferences, roles, projects, achievements, normalized skills, certifications, STAR stories, and provenance. The hard constraint that shapes the whole design: **AI extraction may create only untrusted candidates; trusted Career Vault records require an explicit user-initiated approval path or a manual-write path, and trusted writes reject fabricated/unsupported claims** (GUARD-01, GUARD-02).

In scope: schema (additive migrations), trusted-write guardrail wiring, and the `/vault` API surface (CRUD + approve/reject) that backs VAULT-01 through VAULT-09.

Out of scope (later phases): the import/review UI, duplicate grouping, candidate merge logic, and tailoring's use of approved evidence (all Phase 13); application tracker, recruiter CRM, discovery, match scoring (Phases 14–17). This phase must not ship user-facing half-features from those phases.

</domain>

<decisions>
## Implementation Decisions

### Candidate vs Trusted Record Modeling
- **D-01:** Use **one table per entity** (roles, projects, achievements, skills, certifications, STAR stories, source artifacts) with a trust/approval-state column on the row. Approving a candidate flips the state **in place** — no separate trusted/staging table pair. Trusted reads must always filter on state, and every trusted write must pass through the existing guardrail.
- **D-02:** AI extraction writes **per-entity candidate rows** in the same entity tables, grouped only by a shared `source_artifact_id`. There is no separate polymorphic candidate staging table. (Analog: `database/007_discovery.sql` `discovered_jobs` staging-then-approve model, but co-located in the entity tables here.)
- **D-03:** Lifecycle states include `edited` and `superseded` beyond the minimal set. Concrete state machine to implement: `pending → approved`, `approved → edited` (user modified an approved record), `pending/approved → rejected`, `approved → superseded` (record replaced). **Only the states are reserved here** — actual merge/supersede *logic* is Phase 13. `last_user_edit` timestamp (VAULT-01) is updated on any user edit.

### Provenance Linkage (VAULT-09)
- **D-04:** Source-backed provenance uses a **shared polymorphic junction table** `record_provenance(record_type, record_id, source_artifact_id, ...)` — many-to-many across all entity types, a single place to enforce "an approved record must have provenance." `record_id` is polymorphic (no hard DB FK on it); `source_artifact_id` should FK to `source_artifacts`.
- **D-05:** Manual entry (no source artifact) is represented by a **`manual_entry` boolean + `manual_entry_reason`** directly on the entity row, exactly mirroring `assertTrustedEvidenceWriteAllowed`'s `manualEntry`/`manualEntryReason` inputs. The VAULT-09 rule to enforce: an approved record must have **≥1 `record_provenance` row OR `manual_entry = true` with a non-empty reason**. (Chosen over a synthetic "manual" `source_artifacts` row to keep the existing guardrail unchanged and avoid polluting the artifacts table.)

### API Resource Shape & Approval
- **D-06:** Routes live under a **unified `/vault` namespace**: `/vault/{roles,projects,achievements,skills,certifications,stories,sources,profile}`, mounted as its own router consistent with the per-feature route-file pattern (`jobs.ts`, `discovery.ts`, `profile.ts`).
- **D-07:** The trust transition is exposed via **dedicated action endpoints** `POST /vault/<entity>/:id/approve` and `/reject`. Manual create is a normal `POST` that sets `approved` + user-initiated. **All trusted writes route through `assertTrustedEvidenceWriteAllowed`** as the single guarded, auditable boundary (not a bare `PATCH` of the state field).
- **D-08:** Default reads are **approved-only**: `GET /vault/<entity>` returns trusted (`approved`/`edited`) records; candidates require explicit `?state=candidate` (or a `/candidates` sub-route). Prevents unapproved AI output from leaking into Phase 13 tailoring.

### Skill Normalization (VAULT-06)
- **D-09:** Skills store a **canonical name + category**, with **uniqueness enforced on the canonical name**. Aliases (e.g. `k8s → Kubernetes`) are normalized at write/extraction time, reusing the project's existing canonicalization habit (cf. `job_skills`), but **no separate alias dictionary table** is built this phase. A full taxonomy/alias subsystem is deferred.
- **D-10:** `category` is a **CHECK-constrained enum**: `(language, framework, cloud, tooling, domain, soft_skill)` — matching the existing `seniority_level` / `discovered_jobs.status` convention. Extensible later via an additive migration (consistent with D-05/Phase-11 additive rule).

### Claude's Discretion (user said "you decide everything")
- **D-11 (profile placement):** VAULT-02 career/profile preferences (headline, summary, preferred titles, location, work authorization, remote/hybrid, relocation) go in a **new single-row `vault_profile` table (id=1)**, separate from the existing `user_profile` (which keeps tailoring config + encrypted API key). Rationale: domain separation, consistent with Phase 11 D-04 (Vault state separate from pipeline/config state); avoids mixing private career evidence with the encrypted-key row.
- **D-12 (scoping):** Vault tables stay **single-user** — no `owner`/`user_id` column — consistent with `user_profile (id=1)` and `search_preferences (id=1)`. Multi-user is explicitly out of scope per PROJECT.md.
- **D-13 (entity-to-entity links):** Inter-record links required by the requirements — achievement → optional role/project (VAULT-05), project → optional role (VAULT-04), STAR story → roles/projects/achievements, "one or more" (VAULT-08) — are modeled separately from `record_provenance` (which is record→source only). Planner may use nullable FK columns for single/optional links (achievement→role/project, project→role) and a junction table for the many-to-many STAR-story links, provided trusted-only linkage is preserved (links should reference approved records).
- **D-14 (source_artifacts fields):** Per VAULT-01, `source_artifacts` must carry: `source_type`, `source_reference`, `extracted_at` (extracted timestamp), `approval_state`, `last_user_edit` timestamp — plus id + created_at. These are requirement-locked, not gray areas.
- **Additive-migration constraint (carried from Phase 11 D-05):** all schema work is a new additive migration (next in sequence after `008_compat_boundaries.sql`); never write trigger-owned `jobs.qa_score`/`iteration_count`; never reuse/mutate `jobs.status`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase Scope and Product Constraints
- `.planning/ROADMAP.md` — Phase 12 goal, dependency (Phase 11), VAULT-01..09 + GUARD-01/02 mapping, and the 5 success criteria.
- `.planning/REQUIREMENTS.md` — VAULT-01 through VAULT-09 and GUARD-01, GUARD-02 definitions.
- `.planning/PROJECT.md` — Career Vault v1 description, single-user model, no-fabrication and approval-before-trusted non-negotiables, out-of-scope list (no multi-user, no autonomous merge/trusted creation).
- `.planning/phases/11-architecture-compatibility-and-migration-plan/11-CONTEXT.md` — Phase 11 locked decisions this phase must preserve (additive-only D-05, status separation D-04, audit redaction D-07/08/09, guardrail-test boundary D-10).
- `CLAUDE.md` / `AGENTS.md` — TDD mandate, DB integrity rules, trigger-owned columns, parameterised-query rule.

### Trusted-Write Guardrail (already built in Phase 11)
- `api/src/safety-guardrails.ts` — `assertTrustedEvidenceWriteAllowed` (user-initiated + approved + provenance), `GuardrailViolation`, manual-only allowed/blocked action sets. This phase wires real tables/routes behind it; **do not weaken it**.
- `api/src/safety-guardrails.test.ts` — guardrail behavior contract; extend, don't break.

### Schema and Migration Pattern
- `database/schema.sql` — base jobs/resume_versions/qa_reviews/pipeline_events/triggers; `uuid_generate_v4`, CHECK-constraint, and trigger conventions to mirror.
- `database/007_discovery.sql` — closest precedent: single-row config table (`search_preferences id=1`), staging table with `status` CHECK + review flow (`discovered_jobs`), `updated_at` trigger pattern.
- `database/008_compat_boundaries.sql` — most recent migration; new Vault migration is `009_*` and must be additive. Note `application_statuses` / `application_timeline_events` scaffolding already exists (do not duplicate; those are Phase 14).
- `database/001_user_profile.sql`, `database/005_profile_resume.sql` — existing `user_profile (id=1)` shape; `vault_profile` is a new sibling table, not an extension of this.

### API Route Pattern
- `api/src/routes/discovery.ts` + `api/src/routes/discovery.test.ts` — closest analog for a new domain router with review/approve actions and Vitest + mocked `pool.query` tests.
- `api/src/routes/profile.ts`, `api/src/routes/jobs.ts` — per-feature router registration and HTTP-semantics conventions.
- `api/src/db.ts` / `api/src/db-adapter.ts` — DB access boundary used by routes (parameterised queries; respects DEPLOY_TARGET adapter seam).
- `api/src/index.ts` / `api/src/app.ts` — where routers are mounted.

### Audit / Redaction
- `api/src/compat-boundaries.test.ts` — asserts pipeline/application separation; new Vault audit surfaces must respect Phase 11 D-07/08/09 (IDs/counts/hashes/redacted snippets, not raw private evidence).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `assertTrustedEvidenceWriteAllowed(input)` in `api/src/safety-guardrails.ts`: the exact gate for every trusted Vault write — its `TrustedEvidenceWriteInput` (`initiatedBy`, `approvalState`, `sourceArtifactIds[]`, `manualEntry`, `manualEntryReason`) is the contract the schema and routes must satisfy. The approval-state column, provenance junction, and `manual_entry`/`manual_entry_reason` fields are designed to feed it directly.
- `GuardrailViolation` (code + message) in `safety-guardrails.ts`: map to a structured 4xx in the route layer.
- `discovered_jobs` staging→review pattern in `database/007_discovery.sql`: template for candidate state + review action, but co-located in entity tables per D-01/D-02.
- `search_preferences` single-row + `updated_at` trigger pattern: template for `vault_profile (id=1)`.

### Established Patterns
- Hono per-feature route files with Vitest + mocked `pool.query` (see `discovery.test.ts`); TDD is mandatory (RED→GREEN→REFACTOR, vertical slices).
- CHECK constraints for enumerated columns (`seniority_level`, `discovered_jobs.status`); `uuid_generate_v4()` PKs; `TIMESTAMPTZ DEFAULT NOW()`; `IF NOT EXISTS` idempotent migrations.
- API ↔ pipeline communicate only through Postgres; `jobs.status` is pipeline-lifecycle-only and must not be touched.
- DB access goes through `db.ts`/`db-adapter.ts` (DEPLOY_TARGET adapter seam — self-hosted / cloud / browser PGlite must all work; keep SQL portable).

### Integration Points
- New `009_*` additive migration after `008_compat_boundaries.sql`.
- New `/vault` router mounted in `api/src/index.ts` / `app.ts` alongside `jobs`, `discovery`, `profile`.
- Phase 13 will read approved Vault records (ranked) for tailoring and must never see candidates — D-08 default-approved-reads is the enabling contract.

</code_context>

<specifics>
## Specific Ideas

- Prefer default-safe semantics throughout: approved-only reads, guardrail on every trusted write, reject-rather-than-store for unsupported claims.
- Keep the schema portable across the three DEPLOY_TARGET backends (Postgres + PGlite); avoid Postgres-only features that PGlite can't run.
- Reserve lifecycle states (`edited`, `superseded`) now; defer the behavior (merge/supersede) to Phase 13.
- Reuse the existing canonicalization habit for skills without building a taxonomy subsystem this phase.

</specifics>

<deferred>
## Deferred Ideas

- **Full skill taxonomy / alias dictionary** (`skills_canonical` + `skill_aliases` mapping table, cross-user reuse) — heavier than a foundation phase needs; revisit if Phase 13 tailoring shows dedup gaps.
- **Candidate merge logic, duplicate grouping, import/review UI** — Phase 13 (states reserved here, behavior there).
- **Multi-user / ownership scoping** — out of scope per PROJECT.md; single-user `id=1` model retained.

</deferred>

---

*Phase: 12-Career Vault Schema and API Foundation*
*Context gathered: 2026-06-25*
