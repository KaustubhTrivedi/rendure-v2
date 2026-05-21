# Phase 5: Frontend ↔ API Integration — Execution Plan

## Situation

The frontend (React Router v7 + Vite) is fully scaffolded with 6 routes, a custom CSS
design system (NeoBrutalism), an API client (`app/lib/api.ts`), and TypeScript types
(`app/lib/types.ts`). Every page renders **hardcoded mock data**. The backend (Hono on
port 3002) is complete with all endpoints live: jobs CRUD, SSE streaming, resume
retrieval + PDF, profile management, and Telegram integration.

This plan replaces mock data with real API calls, wires up SSE for live pipeline
updates, and adds error/loading/empty states throughout.

---

## Critical Mismatches to Fix First

Before wiring pages, the API client and types have contract mismatches with the actual
backend that must be resolved. These are **blockers** — pages will break if wired to
the current client as-is.

### M-1. API base URL default

| Layer | Current | Correct |
|-------|---------|---------|
| `api.ts` | `http://localhost:3000` | `http://localhost:3002` |
| `vite.config.ts` proxy target | `http://localhost:3000` | `http://localhost:3002` |

**Fix:** Update both defaults to `3002`. The Vite proxy rewrites `/api/*` → `/*`, so
the frontend `api.ts` calls `/jobs` which Vite proxies to `http://localhost:3002/jobs`.

### M-2. `UserProfile` type mismatch

The frontend `UserProfile` interface uses field names that don't match the backend
`GET /profile` response:

| Frontend type field | Backend response field | Action |
|---------------------|----------------------|--------|
| `name` | `display_name` | Rename |
| `email` | *(not returned)* | Remove |
| `default_seniority` | `target_seniority` | Rename |
| `qa_pass_threshold` | `qa_threshold` | Rename |
| *(missing)* | `api_key_configured` | Add (boolean) |
| *(missing)* | `preferred_model` | Add (string \| null) |
| *(missing)* | `highlight_skills` | Add (string[] \| null) |
| *(missing)* | `preferred_industries` | Add (string[] \| null) |
| *(missing)* | `tailor_style_notes` | Add (string \| null) |
| *(missing)* | `notify_email` | Add (string \| null) |
| *(missing)* | `notify_webhook_url` | Add (string \| null) |

**Fix:** Rewrite `UserProfile` to match backend exactly.

### M-3. `Job` type missing fields from detail endpoint

`GET /jobs/:id` returns extra fields not in the list endpoint and not in the current
`Job` type:

| Missing field | Type | Source |
|--------------|------|--------|
| `required_skills` | `string[] \| null` (JSONB) | Job detail |
| `nice_to_haves` | `string[] \| null` (JSONB) | Job detail |
| `updated_at` | `string` | Both list and detail |
| `qa_review` | `QAReview \| null` | Job detail (nested, latest only) |
| `pipeline_events` | `PipelineEvent[]` | Job detail (nested, last 20) |

**Fix:** Create a `JobDetail` type extending `Job` with the nested relations.

### M-4. `api.qa.list()` has no backend endpoint

The frontend client calls `GET /jobs/:jobId/qa` but this endpoint **does not exist**.
QA reviews are returned nested in `GET /jobs/:id` as `qa_review` (singular, latest only).

**Fix:** Remove `api.qa.list()`. QA data comes from `api.jobs.get(id).qa_review`.

### M-5. `POST /jobs` response shape

Frontend expects `Job` back from `api.jobs.submit()`. Backend returns:
```json
{ "job_id": "uuid", "status": "new", "status_url": "/jobs/{id}/status" }
```

**Fix:** Create a `JobSubmitResponse` type. After submission, either navigate to the
job detail page or add the job to the local list.

### M-6. `PipelineEvent.created_at` vs `timestamp`

Frontend type has `created_at`. Backend returns `timestamp`.

**Fix:** Rename field in `PipelineEvent` type to `timestamp`.

### M-7. SSE authentication

The SSE endpoint (`GET /jobs/:id/events`) expects `X-API-Key` header. The `EventSource`
API doesn't support custom headers. The current `api.events.connect()` passes the key
as a query param (`?key=...`), but the backend middleware reads from the header only.

**Fix:** Either:
- (a) Update backend `apiKeyMiddleware` to also check `c.req.query('key')` for SSE routes, OR
- (b) Use `fetch()` with headers + manual SSE parsing (ReadableStream) instead of `EventSource`

Option (a) is simpler and already implied by the API client design. One-line backend change.

---

## Execution Plan

### Wave 1: Foundation (no visual changes yet)

#### Task 1.1 — Fix API base URL
**Files:** `frontend/app/lib/api.ts`, `frontend/vite.config.ts`, `frontend/.env.example`
- Change default from `3000` to `3002` in all three locations
- Verify the Vite proxy rewrites `/api/*` → `/*` on port 3002

#### Task 1.2 — Align TypeScript types with backend contracts
**File:** `frontend/app/lib/types.ts`

Update/create these types:

```typescript
// JobStatus — add "new" which the backend returns on submission
export type JobStatus =
  | "new"
  | "found"
  | "tailoring"
  | "qa_review"
  | "approved"
  | "qa_failed"
  | "low_match"
  | "error";

// Job — list endpoint shape (GET /jobs)
export interface Job {
  job_id: string;
  job_url: string;
  company_name: string | null;
  role_title: string | null;
  status: JobStatus;
  qa_score: number | null;
  iteration_count: number;
  created_at: string;
  updated_at: string;
}

// JobDetail — detail endpoint shape (GET /jobs/:id)
export interface JobDetail extends Job {
  seniority_level: string | null;
  location: string | null;
  required_skills: string[] | null;
  nice_to_haves: string[] | null;
  active_resume_id: string | null;
  qa_review: QAReview | null;
  pipeline_events: PipelineEventSummary[];
}

// PipelineEventSummary — shape from GET /jobs/:id (subset, no event_id)
export interface PipelineEventSummary {
  event_type: string;
  agent_name: string | null;
  from_status: string | null;
  to_status: string | null;
  detail: string | null;
  timestamp: string;
}

// PipelineEvent — full shape from SSE stream
export interface PipelineEvent {
  event_id: string;
  job_id: string;
  event_type: string;
  agent_name: string | null;
  from_status: string | null;
  to_status: string | null;
  model_used: string | null;
  detail: string | null;
  metadata: Record<string, unknown> | null;
  timestamp: string;
}

// JobSubmitResponse — POST /jobs response
export interface JobSubmitResponse {
  job_id: string;
  status: "new";
  status_url: string;
}

// JobSubmitConflict — POST /jobs 409 response
export interface JobSubmitConflict {
  error: string;
  job_id: string;
  status: string;
  status_url: string;
}

// ResumeVersionSummary — from GET /jobs/:id/resumes (no content)
export interface ResumeVersionSummary {
  version_id: string;
  version_number: number;
  created_at: string;
  tailoring_notes: string | null;
}

// ResumeVersion — keep as-is (full content, from getMarkdown)

// QAReview — keep as-is (matches backend exactly)

// UserProfile — rewrite to match GET /profile
export interface UserProfile {
  display_name: string | null;
  api_key_configured: boolean;
  qa_threshold: number | null;
  max_iterations: number | null;
  preferred_model: string | null;
  target_seniority: string | null;
  highlight_skills: string[] | null;
  preferred_industries: string[] | null;
  tailor_style_notes: string | null;
  notify_email: string | null;
  notify_webhook_url: string | null;
  notify_telegram_chat_id: string | null;
  created_at: string;
  updated_at: string;
}
```

#### Task 1.3 — Update API client to match backend contracts
**File:** `frontend/app/lib/api.ts`

Changes:
- `api.jobs.get(id)` returns `JobDetail` (not `Job`)
- `api.jobs.submit(url)` returns `JobSubmitResponse`
- `api.resumes.list(jobId)` returns `ResumeVersionSummary[]`
- Remove `api.qa.list()` entirely (no backend endpoint)
- `api.profile.get()` returns updated `UserProfile`
- `api.profile.update()` body keys must match backend schema (e.g. `display_name` not `name`)
- Add `api.profile.create(displayName)` for `POST /profile`
- Add `api.profile.setApiKey(key)` for `PUT /profile/api-key`
- Add `api.profile.checkApiKey()` for `GET /profile/api-key`
- Add `api.profile.deleteApiKey()` for `DELETE /profile/api-key`
- Add `api.jobs.status(id)` for `GET /jobs/:id/status` (compact polling)

#### Task 1.4 — Fix SSE authentication
**File:** `api/src/middleware/apiKey.ts` (backend)

Add query param fallback for SSE routes: if `X-API-Key` header is missing, check
`c.req.query('key')`. This is safe because SSE is a read-only GET endpoint.

#### Task 1.5 — Create shared hooks
**File:** `frontend/app/hooks/use-api.ts` (new)

Create reusable hooks that wrap the API client with loading/error/data state:

```typescript
// useApiQuery<T>(fetcher, deps) — generic fetch-on-mount with refetch
// Returns { data: T | null, error: ApiError | null, loading: boolean, refetch: () => void }

// useJobPolling(jobId) — polls GET /jobs/:id/status every 5s while status is active
// Returns { status, qa_score, iteration_count, ... }

// useJobSSE(jobId) — connects to SSE stream, accumulates events
// Returns { events: PipelineEvent[], connected: boolean, error: string | null }
```

---

### Wave 2: Dashboard (`/` — `_index.tsx`)

#### Task 2.1 — Fetch and display real jobs list
**File:** `frontend/app/routes/_index.tsx`

- Remove `MOCK_JOBS` array
- Call `api.jobs.list()` on mount via `useApiQuery`
- Map backend `Job[]` to the existing table row structure
- Map `job.status` to the pipeline progress visualization (derive stage from status)
- Show loading skeleton while fetching
- Show empty state when no jobs exist ("No jobs yet — submit your first URL below")

**Status → Pipeline stage mapping:**
```
new       → stage 0/4 (submitted)
found     → stage 1/4 (scout done)
tailoring → stage 2/4 (tailor active)
qa_review → stage 3/4 (QA active)
approved  → stage 4/4 (done)
qa_failed → stage 3/4 (QA failed, looping)
low_match → stage 4/4 (terminal)
error     → whichever stage errored
```

#### Task 2.2 — Wire job submission form
**File:** `frontend/app/routes/_index.tsx`

- On "ANALYZE" click: call `api.jobs.submit(url)`
- Show submitting state (disable input + button, show spinner)
- On 202 success: add the new job to the top of the list, clear input, show success toast
- On 409 conflict: show "Already submitted" message with link to existing job
- On 400/error: show error toast with message from response body
- Validate URL format client-side before submitting (basic `https?://` check)

#### Task 2.3 — Wire activity feed
**File:** `frontend/app/routes/_index.tsx`

- Remove `EVENTS` mock array
- For each job in active status (`new`, `found`, `tailoring`, `qa_review`, `qa_failed`):
  use the pipeline_events from `GET /jobs/:id` to populate the feed
- Or: fetch events from the most recent active job only (simpler first pass)
- Format timestamps as relative ("2m ago", "just now") using `date-fns`

#### Task 2.4 — Auto-refresh active jobs
**File:** `frontend/app/routes/_index.tsx`

- If any job in the list has an active status, poll `api.jobs.list()` every 5 seconds
- Stop polling when all jobs are terminal (`approved`, `low_match`, `error`)
- Use `setInterval` + cleanup in `useEffect`

#### Task 2.5 — Wire stats cards
**File:** `frontend/app/routes/_index.tsx`

- Derive stats from the jobs list data (no separate analytics endpoint needed for dashboard):
  - Total jobs: `jobs.length`
  - Active: count of non-terminal statuses
  - Approved: count where `status === 'approved'`
  - Avg QA score: average of non-null `qa_score` values

---

### Wave 3: Job Detail (`/jobs/:id` — `jobs.$id.tsx`)

#### Task 3.1 — Fetch job detail
**File:** `frontend/app/routes/jobs.$id.tsx`

- Remove all `STAGES` and `EVENTS` mock arrays
- Call `api.jobs.get(id)` on mount
- Populate: company name, role title, URL link, status badge, seniority, location
- Show loading skeleton while fetching
- Show 404 state if job not found

#### Task 3.2 — Pipeline stage tracker from status
**File:** `frontend/app/routes/jobs.$id.tsx`

Map `job.status` + `pipeline_events` to the 4-stage pipeline visualization:
- Stage 1 (Job Scout): done if status beyond `found`
- Stage 2 (Resume Tailor): done if status beyond `tailoring`
- Stage 3 (Quality Analyst): done if `approved`; fail if `qa_failed`/`low_match`
- Stage 4 (Confirmation): done if `approved`
- Active stage: the one currently running based on status
- Show iteration count from `job.iteration_count`

#### Task 3.3 — QA iteration chips
**File:** `frontend/app/routes/jobs.$id.tsx`

- Read `job.qa_review` for the latest score
- If `iteration_count > 1`, fetch resume versions (`api.resumes.list(id)`) to show
  iteration progression
- Each chip: "Iter N: {score}" — requires fetching all QA reviews or deriving from
  resume versions. For MVP, show latest score + iteration count.

#### Task 3.4 — Wire event feed with SSE
**File:** `frontend/app/routes/jobs.$id.tsx`

- On mount, connect to `api.events.connect(id)` for live SSE
- Render events in the feed as they arrive
- For completed jobs (terminal status), show the static `pipeline_events` from the
  job detail response instead of SSE
- Map `event_type` + `agent_name` to the existing feed item styling
- Show connection status indicator ("live" vs "disconnected")

#### Task 3.5 — Side panel: job metadata
**File:** `frontend/app/routes/jobs.$id.tsx`

- Display from `JobDetail`:
  - `required_skills` as tag chips
  - `nice_to_haves` as dimmed tag chips
  - `seniority_level`
  - `location`
  - Link to `job_url` (external)
- Show QA score card with latest `qa_review` dimensions if available

#### Task 3.6 — Navigation to sub-pages
**File:** `frontend/app/routes/jobs.$id.tsx`

- "View Resume" button → `/jobs/:id/resume/:active_resume_id` (only if `active_resume_id` set)
- "View QA Report" button → `/jobs/:id/qa/:qa_review.review_id` (only if `qa_review` exists)
- Disable/hide buttons when data not yet available

---

### Wave 4: Resume Viewer (`/jobs/:id/resume/:vid` — `jobs.$id_.resume.$vid.tsx`)

#### Task 4.1 — Fetch resume content
**File:** `frontend/app/routes/jobs.$id_.resume.$vid.tsx`

- Remove `TAILORING_NOTES` and `KEYWORDS` mock arrays
- Call `api.resumes.getMarkdown(id, vid)` to get the raw Markdown/YAML content
- Display in the existing code-viewer pane (monospace, line-numbered)
- Show loading skeleton while fetching

#### Task 4.2 — Version switcher
**File:** `frontend/app/routes/jobs.$id_.resume.$vid.tsx`

- Call `api.resumes.list(id)` to get all versions
- Populate the version selector dropdown/tabs
- On version change: navigate to `/jobs/:id/resume/:newVersionId`
- Highlight the active/approved version

#### Task 4.3 — Tailoring notes from version metadata
**File:** `frontend/app/routes/jobs.$id_.resume.$vid.tsx`

- `ResumeVersionSummary.tailoring_notes` is a string — parse and display in the notes panel
- If null, show "No tailoring notes for this version"

#### Task 4.4 — PDF download button
**File:** `frontend/app/routes/jobs.$id_.resume.$vid.tsx`

- Wire "DOWNLOAD PDF" button to `api.resumes.pdfUrl(id, vid)`
- Open in new tab or trigger download via `<a href={url} download>`
- Handle 503 (RenderCV unavailable): show message "PDF rendering not available"
- Handle 504 (timeout): show "PDF rendering timed out, try again"

#### Task 4.5 — Keyword hit/miss analysis
**File:** `frontend/app/routes/jobs.$id_.resume.$vid.tsx`

- Fetch job detail (`api.jobs.get(id)`) to get `required_skills` and `nice_to_haves`
- Compare against resume content text to compute keyword hits/misses
- Display in the existing keyword chip UI (green = hit, red = miss)

---

### Wave 5: QA Report (`/jobs/:id/qa/:rid` — `jobs.$id_.qa.$rid.tsx`)

#### Task 5.1 — Fetch QA review data
**File:** `frontend/app/routes/jobs.$id_.qa.$rid.tsx`

- Remove `DIMENSIONS`, `GAPS`, `RAW_LINES` mock arrays
- QA review data comes from `api.jobs.get(id).qa_review`
  - Note: the `:rid` param is informational — there's only one QA review in the detail
    response (the latest). If we need historical reviews, we'd need a new backend endpoint.
  - For MVP: fetch job detail, use `qa_review` field
- Populate the 4 dimension scores from `keyword_match`, `experience_match`,
  `seniority_match`, `structure_valid`
- Calculate composite score using the formula from CLAUDE.md Section 8

#### Task 5.2 — Gap analysis display
**File:** `frontend/app/routes/jobs.$id_.qa.$rid.tsx`

- Render `qa_review.gaps[]` in the gap cards
- Map `gap.severity` to color coding (high=red, medium=yellow, low=green)
- Map `gap.category` to category labels (KEYWORDS, EXPERIENCE, SENIORITY, STRUCTURE)
- Support the severity filter (all / high / medium / low)
- Show gap count per severity level

#### Task 5.3 — Raw feedback display
**File:** `frontend/app/routes/jobs.$id_.qa.$rid.tsx`

- Render `qa_review.raw_feedback` in the code-viewer pane
- If null, show "No raw feedback available"
- Keep the existing line-numbered monospace styling

---

### Wave 6: Settings (`/settings` — `settings.tsx`)

#### Task 6.1 — Fetch and populate profile
**File:** `frontend/app/routes/settings.tsx`

- Remove hardcoded initial state values
- Call `api.profile.get()` on mount
- Populate form fields from the profile response:
  - `target_seniority` → seniority selector
  - `max_iterations` → iterations slider/input
  - `qa_threshold` → threshold slider/input
  - `notify_telegram_chat_id` → Telegram chat ID field
  - `preferred_model` → model selector (if shown)
- Handle 404 (profile not created yet) → redirect to onboarding

#### Task 6.2 — Save settings
**File:** `frontend/app/routes/settings.tsx`

- Wire "SAVE CHANGES" button to `api.profile.update(changedFields)`
- Only send fields that actually changed (diff against fetched state)
- Show saving indicator on button
- On success: show success toast, update local state from response
- On 400 validation error: show field-level errors from `response.fields[]`

#### Task 6.3 — API key management
**File:** `frontend/app/routes/settings.tsx`

- Show "API Key: Configured ✓" or "API Key: Not Set" based on `api_key_configured`
- Add "Change API Key" button → shows input + "Save Key" button
- Wire to `api.profile.setApiKey(key)` on save
- Add "Remove API Key" button → confirm dialog → `api.profile.deleteApiKey()`

---

### Wave 7: Onboarding (`/onboarding` — `onboarding.tsx`)

#### Task 7.1 — Wire profile creation
**File:** `frontend/app/routes/onboarding.tsx`

- Step 1 (display name): on "continue" → `api.profile.create(displayName)`
  - Handle 409 (already exists) → skip to next step
- Step 2 (API key): on "VALIDATE KEY" → `api.profile.setApiKey(key)`
  - On success: mark step complete
  - On error: show error message
- Step 3 (model selection): on "LAUNCH" →
  `api.profile.update({ preferred_model: selectedModel })`
- Remove `localStorage.setItem("rendure_onboarded")` — derive from profile existence

#### Task 7.2 — Onboarding gate
**File:** `frontend/app/routes/_index.tsx` (or a layout wrapper)

- On app load, call `api.profile.get()`
- If 404 → redirect to `/onboarding`
- If profile exists → proceed normally
- Cache the "has profile" check in memory for the session (don't re-check every navigation)

---

### Wave 8: Error Handling & Loading States

#### Task 8.1 — Global error boundary
**File:** `frontend/app/root.tsx`

- Add React error boundary at the root level
- Catch unhandled errors and render a styled error page
- Include "Try Again" button that reloads

#### Task 8.2 — API error toast system
**File:** `frontend/app/components/Toast.tsx` (new), `frontend/app/lib/toast.ts` (new)

- Create a minimal toast notification system (no library needed given the NeoBrutalism style)
- Toast types: success (green), error (red), warning (yellow), info (neutral)
- Auto-dismiss after 5s, manual dismiss on click
- Mount toast container in root layout

#### Task 8.3 — Loading skeletons per page
**Files:** All route files

- Dashboard: skeleton table rows (3-5 shimmer rows)
- Job detail: skeleton header + stage placeholders + empty feed
- Resume viewer: skeleton code block
- QA report: skeleton dimension cards + gap list
- Settings: skeleton form fields

Use CSS animations matching the NeoBrutalism design (no shimmer library — use
`@keyframes` pulse on `.skeleton` class).

#### Task 8.4 — Empty states per page
**Files:** All route files

- Dashboard (no jobs): "Submit your first job URL to get started"
- Job detail (404): "Job not found — it may have been deleted"
- Resume viewer (no content): "Resume not yet generated — pipeline still running"
- QA report (no review): "QA review not yet available"
- Settings (no profile): redirect to onboarding

---

## File Change Summary

| File | Action | Wave |
|------|--------|------|
| `frontend/.env.example` | Update default port | 1 |
| `frontend/vite.config.ts` | Fix proxy target port | 1 |
| `frontend/app/lib/types.ts` | Rewrite types to match backend | 1 |
| `frontend/app/lib/api.ts` | Fix URL, add endpoints, fix types | 1 |
| `api/src/middleware/apiKey.ts` | Add query param fallback for SSE | 1 |
| `frontend/app/hooks/use-api.ts` | New: shared data-fetching hooks | 1 |
| `frontend/app/routes/_index.tsx` | Replace mocks with API calls | 2 |
| `frontend/app/routes/jobs.$id.tsx` | Replace mocks, add SSE | 3 |
| `frontend/app/routes/jobs.$id_.resume.$vid.tsx` | Replace mocks, wire PDF | 4 |
| `frontend/app/routes/jobs.$id_.qa.$rid.tsx` | Replace mocks, wire QA | 5 |
| `frontend/app/routes/settings.tsx` | Wire profile CRUD | 6 |
| `frontend/app/routes/onboarding.tsx` | Wire profile creation | 7 |
| `frontend/app/root.tsx` | Add error boundary | 8 |
| `frontend/app/components/Toast.tsx` | New: toast notifications | 8 |
| `frontend/app/lib/toast.ts` | New: toast state management | 8 |
| `frontend/app/app.css` | Add skeleton + toast + empty state styles | 8 |

---

## Backend Endpoint ↔ Frontend Page Matrix

| Backend Endpoint | Frontend Consumer | Wave |
|-----------------|-------------------|------|
| `GET /jobs` | Dashboard table (`_index.tsx`) | 2 |
| `POST /jobs` | Dashboard submit form (`_index.tsx`) | 2 |
| `GET /jobs/:id` | Job detail page (`jobs.$id.tsx`) | 3 |
| `GET /jobs/:id/status` | Dashboard polling (`_index.tsx`) | 2 |
| `GET /jobs/:id/events` (SSE) | Job detail live feed (`jobs.$id.tsx`) | 3 |
| `GET /jobs/:id/resumes` | Resume version list (`jobs.$id_.resume.$vid.tsx`) | 4 |
| `GET /jobs/:id/resume/:vid` | Resume content viewer (`jobs.$id_.resume.$vid.tsx`) | 4 |
| `GET /jobs/:id/resume/:vid/pdf` | PDF download button (`jobs.$id_.resume.$vid.tsx`) | 4 |
| `GET /profile` | Settings page (`settings.tsx`), onboarding gate | 6, 7 |
| `POST /profile` | Onboarding (`onboarding.tsx`) | 7 |
| `PATCH /profile` | Settings save (`settings.tsx`), onboarding model select | 6, 7 |
| `PUT /profile/api-key` | Onboarding + settings (`onboarding.tsx`, `settings.tsx`) | 6, 7 |
| `GET /profile/api-key` | Settings status indicator (`settings.tsx`) | 6 |
| `DELETE /profile/api-key` | Settings remove button (`settings.tsx`) | 6 |
| `GET /` (health) | *(not consumed by frontend)* | — |
| `POST /telegram` | *(Telegram bot only, not frontend)* | — |

---

## Dependency Graph

```
Wave 1 (Foundation)
  ├── Task 1.1 (URL fix)
  ├── Task 1.2 (Types) ─────────────────────────┐
  ├── Task 1.3 (API client) ← depends on 1.2    │
  ├── Task 1.4 (SSE auth) — backend change       │
  └── Task 1.5 (Hooks) ← depends on 1.3         │
                                                  │
Wave 2 (Dashboard) ← depends on Wave 1           │
  ├── Task 2.1 (Jobs list)                        │
  ├── Task 2.2 (Submit form)                      │
  ├── Task 2.3 (Activity feed)                    │
  ├── Task 2.4 (Auto-refresh) ← depends on 2.1   │
  └── Task 2.5 (Stats cards) ← depends on 2.1    │
                                                  │
Wave 3 (Job Detail) ← depends on Wave 1          │
  ├── Task 3.1 (Fetch detail)                     │
  ├── Task 3.2 (Pipeline stages) ← 3.1           │
  ├── Task 3.3 (QA iterations) ← 3.1             │
  ├── Task 3.4 (SSE feed) ← 1.4                  │
  ├── Task 3.5 (Metadata panel) ← 3.1            │
  └── Task 3.6 (Navigation) ← 3.1                │
                                                  │
Wave 4 (Resume) ← depends on Wave 1              │
  ├── Task 4.1 (Fetch content)                    │
  ├── Task 4.2 (Version switcher)                 │
  ├── Task 4.3 (Tailoring notes) ← 4.2           │
  ├── Task 4.4 (PDF download)                     │
  └── Task 4.5 (Keyword analysis) ← 4.1          │
                                                  │
Wave 5 (QA Report) ← depends on Wave 1           │
  ├── Task 5.1 (Fetch QA data)                    │
  ├── Task 5.2 (Gap analysis) ← 5.1              │
  └── Task 5.3 (Raw feedback) ← 5.1              │
                                                  │
Wave 6 (Settings) ← depends on Wave 1            │
  ├── Task 6.1 (Fetch profile)                    │
  ├── Task 6.2 (Save settings) ← 6.1             │
  └── Task 6.3 (API key mgmt) ← 6.1              │
                                                  │
Wave 7 (Onboarding) ← depends on Wave 1          │
  ├── Task 7.1 (Wire creation)                    │
  └── Task 7.2 (Onboarding gate)                  │
                                                  │
Wave 8 (Error/Loading) ← can start after Wave 1  │
  ├── Task 8.1 (Error boundary)                   │
  ├── Task 8.2 (Toast system)                     │
  ├── Task 8.3 (Loading skeletons)                │
  └── Task 8.4 (Empty states)                     │
```

**Parallelism:** Waves 2–5 can be executed in parallel after Wave 1 completes.
Waves 6–8 can also run in parallel with 2–5. The only hard dependency chain is
Wave 1 → everything else.

---

## Testing Strategy

Each wave should be verified by:
1. Starting the full stack (`docker compose -f docker-compose.dev.yml up`)
2. Checking the frontend loads without console errors
3. Submitting a real job URL and watching the pipeline run end-to-end
4. Verifying each page renders real data (not mock data)

Type-checking: `cd frontend && npm run typecheck` after every wave.

---

## Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| SSE auth doesn't work through Vite proxy | Medium | Test early in Wave 1; proxy may strip query params. If so, configure proxy to forward them. |
| RenderCV not available in dev (PDF 503) | High | Show graceful "unavailable" message; PDF is a nice-to-have for dev. |
| CORS issues between frontend:5173 and API:3002 | Low | Vite proxy handles this in dev. Verify `CORS_ORIGIN` in API `.env` includes frontend origin for production. |
| Profile not created causes 404 cascade | Medium | Onboarding gate (Task 7.2) must be implemented early or pages need to handle 404 on profile gracefully. |
| Backend returns `timestamp` but SSE uses different field name | Low | Verify SSE payload shape matches `toPipelineEventPayload()` in backend `sse.ts`. |
