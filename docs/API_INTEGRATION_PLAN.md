# API Integration Plan — Frontend ↔ Backend

> Replace all hardcoded/placeholder data in every frontend route with live backend API calls.

---

## Pre-requisites

Before starting any route integration:

### P1. Fix `UserProfile` type mismatch

The frontend `UserProfile` interface in `frontend/app/lib/types.ts` does not match what `GET /profile` actually returns.

**Frontend type (current):**
```typescript
interface UserProfile {
  id: number;
  name: string | null;          // ← wrong field name
  email: string | null;         // ← doesn't exist in API response
  default_seniority: string | null;  // ← wrong field name
  max_iterations: number;
  qa_pass_threshold: number;    // ← wrong field name
  notify_telegram_chat_id: string | null;
  created_at: string;
  updated_at: string;
}
```

**Backend response (actual `GET /profile` columns):**
```typescript
interface UserProfile {
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

**Action:** Rewrite `UserProfile` in `types.ts` to match the backend response exactly. This unblocks Settings and Onboarding integration.

### P2. Fix `Job` type — missing fields from `GET /jobs/:id`

The frontend `Job` type is missing fields that `GET /jobs/:id` returns:

```typescript
// Add these to the Job interface:
  updated_at: string;
  required_skills: string[] | null;    // returned by GET /jobs/:id
  nice_to_haves: string[] | null;      // returned by GET /jobs/:id
  qa_review: QAReview | null;          // nested in GET /jobs/:id response
  pipeline_events: PipelineEvent[];    // nested in GET /jobs/:id response
```

Create a `JobDetail` type that extends `Job` with these extra fields returned only by the detail endpoint.

### P3. Add missing `api.ts` methods

The frontend `api.ts` is missing these backend endpoints:

| Missing method | Backend endpoint | Purpose |
|---|---|---|
| `api.jobs.status(id)` | `GET /jobs/:id/status` | Compact polling endpoint |
| `api.profile.create(name)` | `POST /profile` | Create profile (onboarding) |
| `api.profile.setApiKey(key)` | `PUT /profile/api-key` | Store OpenRouter API key |
| `api.profile.deleteApiKey()` | `DELETE /profile/api-key` | Clear stored API key |
| `api.profile.checkApiKey()` | `GET /profile/api-key` | Check if key is configured |

### P4. Fix API URL default

`api.ts` defaults to `http://localhost:3000` but the backend runs on port `3002`. The Vite proxy also proxies `/api/*` but the api client doesn't prefix paths with `/api`. Two options:

- **Option A (recommended):** Set `VITE_API_URL=http://localhost:3002` in `frontend/.env` and continue with direct calls.
- **Option B:** Prefix all `api.ts` paths with `/api` and rely on the Vite dev proxy (`/api/* → localhost:3002`). This is cleaner for production but needs the proxy to strip the prefix.

### P5. Add `PipelineEvent` to `api.ts` imports

`PipelineEvent` is defined in `types.ts` but not imported/used in `api.ts`. It will be needed for the SSE event parsing.

---

## Route Integration Tasks

### 1. Onboarding (`routes/onboarding.tsx`)

**Priority:** Highest — gates all other routes. Must work first.

**Current state:** Form values in `useState`, validation is local regex only, "Launch" writes `localStorage.rendure_onboarded` and navigates home. No backend calls.

#### Task 1.1 — Wire profile creation on Launch

When the user clicks "Launch":

1. `POST /profile` with `{ display_name }` → creates profile row
2. `PUT /profile/api-key` with `{ api_key }` → encrypts and stores OpenRouter key
3. `PATCH /profile` with `{ preferred_model }` → sets selected model
4. On success: set `localStorage.rendure_onboarded = "1"` and navigate to `/`
5. On `409` from `POST /profile`: profile already exists — skip to step 2

**Error handling:**
- Show inline error if any step fails
- Don't navigate away on failure

#### Task 1.2 — Wire API key validation

Replace the local regex check with a real validation flow:

1. Call `PUT /profile/api-key` with the entered key
2. Then call `GET /profile/api-key` to confirm `{ configured: true }`
3. Update validation state accordingly

**Note:** There is no backend endpoint to validate the key against OpenRouter. The current local `sk-or-` prefix check is reasonable for now. Consider adding a `/profile/api-key/validate` endpoint later if needed.

**Alternative approach:** Keep the local format validation (`sk-or-` prefix) and only call `PUT /profile/api-key` on Launch. This avoids storing an unvalidated key.

#### Task 1.3 — Check for existing profile on mount

Add a `useEffect` that calls `GET /profile`:
- If profile exists → redirect to `/` (already onboarded)
- If 404 → show onboarding form
- This replaces the `localStorage` gate, making it backend-authoritative

---

### 2. Dashboard (`routes/_index.tsx`)

**Priority:** High — main screen after onboarding.

**Current state:** 7 `MOCK_JOBS`, hardcoded stats, hardcoded events, hardcoded agent status. Job composer input exists but isn't wired.

#### Task 2.1 — Fetch real jobs list

Replace `MOCK_JOBS` with live data:

1. Call `api.jobs.list()` on mount → returns `Job[]` from `GET /jobs`
2. Store in state, render in the jobs table
3. Add loading state (skeleton or spinner) while fetching
4. Add empty state when no jobs exist ("No jobs yet — paste a URL above to start")

**Data mapping challenge:** The mock data has a `pipeline` array `[current, total]` and `pipelineState` array. The backend returns `status` as a string enum. Map backend status to pipeline stage:

```typescript
function statusToPipeline(status: JobStatus) {
  const stages = ['found', 'tailoring', 'qa_review', 'approved'] as const;
  const stageMap: Record<JobStatus, { current: number; states: ('done'|'active'|'pending'|'err')[] }> = {
    found:      { current: 1, states: ['active', 'pending', 'pending', 'pending'] },
    tailoring:  { current: 2, states: ['done', 'active', 'pending', 'pending'] },
    qa_review:  { current: 3, states: ['done', 'done', 'active', 'pending'] },
    approved:   { current: 4, states: ['done', 'done', 'done', 'done'] },
    qa_failed:  { current: 3, states: ['done', 'done', 'err', 'pending'] },
    low_match:  { current: 3, states: ['done', 'done', 'err', 'pending'] },
    error:      { current: 1, states: ['err', 'pending', 'pending', 'pending'] },
  };
  return stageMap[status];
}
```

**Badge mapping:**

| Backend `status` | Badge label | Badge class |
|---|---|---|
| `found` | Scouting | `tailoring` |
| `tailoring` | Tailoring | `tailoring` |
| `qa_review` | QA Review | `qa` |
| `approved` | Approved | `ok` |
| `qa_failed` | QA Failed | `err` |
| `low_match` | Low Match | `err` |
| `error` | Error | `err` |

#### Task 2.2 — Wire job submission

Wire the job URL composer input:

1. On submit, call `api.jobs.submit(url)` → `POST /jobs`
2. On `202`: prepend the new job to the list (optimistic or refetch)
3. On `409`: show "Already submitted" with link to existing job
4. On `400`: show validation error
5. Clear input on success
6. Disable button while submitting (prevent double-submit)

#### Task 2.3 — Compute real stats

Replace hardcoded stats cards with computed values from the jobs list:

```typescript
const liveJobs = jobs.filter(j => ['found','tailoring','qa_review'].includes(j.status)).length;
const approvedJobs = jobs.filter(j => j.status === 'approved').length;
const failedJobs = jobs.filter(j => ['qa_failed','low_match','error'].includes(j.status)).length;
const avgScore = jobs.filter(j => j.qa_score != null).reduce(...)  // compute average
```

#### Task 2.4 — Live event feed (optional enhancement)

The dashboard currently shows a global event feed. The backend only supports per-job SSE streams (`GET /jobs/:id/events`), not a global feed.

**Options:**
1. **Remove the global feed** — simplest. Show job list only.
2. **Fan out SSE connections** — open one SSE per active (non-terminal) job. Merge events into a single feed sorted by timestamp. Close connections as jobs reach terminal states.
3. **Add a global events endpoint** — `GET /events` returning the latest N pipeline events across all jobs. This requires a backend change.

**Recommendation:** Option 1 for initial integration. The job list with status badges and scores already conveys pipeline progress. Add per-job event detail on the job detail page. Revisit global feed later if needed.

#### Task 2.5 — Agent status section

The "Local Agents Status" section shows 4 agents with run/idle status. The backend has no endpoint for agent process status.

**Options:**
1. **Remove section** — agents are ephemeral Docker containers; there's no persistent agent status to show.
2. **Show system info statically** — model provider (OpenRouter), runtime (Docker/self-hosted), DB status from a health endpoint.
3. **Add `/health` endpoint** — returns DB connectivity, RenderCV availability, Telegram config status.

**Recommendation:** Remove for now. The health check at `GET /` returns `{ ok: true }` which confirms API is up. Agent status is transient and visible through pipeline events.

#### Task 2.6 — Auto-refresh

Add a polling interval or SSE-based refresh for the jobs list so in-progress jobs update without manual reload:

- Poll `GET /jobs` every 10–15 seconds while any job is in a non-terminal status
- Clear interval when all jobs are terminal or component unmounts

---

### 3. Job Detail (`routes/jobs.$id.tsx`)

**Priority:** High — primary detail view.

**Current state:** All hardcoded — job metadata, 4 pipeline stages, 9 events, score breakdown, sidebar metadata, approved banner.

#### Task 3.1 — Fetch job detail

On mount, call `api.jobs.get(id)` using the `id` from `useParams()`:

1. Store full job detail (including nested `qa_review` and `pipeline_events`) in state
2. Render job header from `company_name`, `role_title`, `job_url`, `status`
3. Map `status` to pipeline stage visualization (same mapper as Task 2.1)
4. Show loading skeleton while fetching
5. Show 404 state if job not found

#### Task 3.2 — Render QA score breakdown

The job detail response includes `qa_review` with all 4 dimension scores. Map to the existing score card UI:

```typescript
// Backend qa_review fields → UI dimension cards
const dimensions = [
  { label: 'Keyword Match',    score: qa_review.keyword_match,    weight: 0.40 },
  { label: 'Experience Match', score: qa_review.experience_match, weight: 0.35 },
  { label: 'Seniority Match',  score: qa_review.seniority_match,  weight: 0.15 },
  { label: 'Structure',        score: qa_review.structure_valid ? 1.0 : 0.0, weight: 0.10 },
];
```

**Note:** The mock UI shows dimension names "Relevance, Keywords, Clarity, Length" but the actual QA dimensions are "Keyword Match, Experience Match, Seniority Match, Structure". Update the UI labels to match.

#### Task 3.3 — Render pipeline events

The `pipeline_events` array from `GET /jobs/:id` contains the last 20 events. Render in the event feed section:

```typescript
// Map backend event → UI event
events.map(e => ({
  agent: e.agent_name,
  message: e.detail,
  time: formatTimestamp(e.timestamp),
  type: e.to_status === 'error' ? 'err'
      : e.event_type === 'model_fallback' ? 'warn'
      : 'ok',
}))
```

#### Task 3.4 — Live SSE updates

For non-terminal jobs, connect to the SSE stream for real-time updates:

1. Call `api.events.connect(id)` → opens `EventSource`
2. On each `pipeline_event` message, parse and append to events list
3. Update job status and QA score as status_change events arrive
4. Close connection on terminal status or component unmount
5. Handle reconnection (EventSource does this automatically with `Last-Event-ID`)

```typescript
useEffect(() => {
  if (isTerminal(job.status)) return;

  const es = api.events.connect(id);
  es.addEventListener('pipeline_event', (e) => {
    const event = JSON.parse(e.data) as PipelineEvent;
    setEvents(prev => [...prev, event]);
    if (event.to_status) setJob(prev => ({ ...prev, status: event.to_status }));
    if (isTerminal(event.to_status)) es.close();
  });

  return () => es.close();
}, [id, job?.status]);
```

#### Task 3.5 — Iteration history

Fetch resume versions to show iteration scores:

1. Call `api.resumes.list(id)` → returns `ResumeVersion[]`
2. Show version chips with scores (requires cross-referencing QA reviews)
3. Link each version to the resume viewer: `/jobs/${id}/resume/${version_id}`

#### Task 3.6 — Render sidebar metadata

Map job detail fields to the sidebar key-value pairs:

| Sidebar label | Backend field |
|---|---|
| Company | `company_name` |
| Location | `location` |
| Seniority | `seniority_level` |
| Required Skills | `required_skills` (JSONB array) |
| Nice to Haves | `nice_to_haves` (JSONB array) |
| Iterations | `iteration_count` |
| Status | `status` |

#### Task 3.7 — Approved banner

When `status === 'approved'` and `active_resume_id` is set:

1. Show "Resume Ready" banner
2. Link to resume viewer: `/jobs/${id}/resume/${active_resume_id}`
3. Link to PDF download: `api.resumes.pdfUrl(id, active_resume_id)`

---

### 4. QA Report (`routes/jobs.$id_.qa.$rid.tsx`)

**Priority:** Medium — detail view accessed from job detail.

**Current state:** Hardcoded composite score (0.89), 4 dimension cards, 6 gaps, 18-line raw feedback.

#### Task 4.1 — Decide data source

The frontend route uses `/jobs/:id/qa/:rid` but there is no `GET /jobs/:id/qa/:rid` endpoint. The backend provides:

- `GET /jobs/:id` → includes `qa_review` (latest only)
- No dedicated QA endpoint per review ID

**Options:**
1. **Use `GET /jobs/:id`** — fetch job detail, extract `qa_review`. The `:rid` param is ignored (only latest review available).
2. **Add `GET /jobs/:id/qa` endpoint** — return all QA reviews for a job, let frontend filter by `:rid`.
3. **Add `GET /jobs/:id/qa/:rid` endpoint** — direct lookup by review ID.

**Recommendation:** Option 1 for now. The current API already returns the latest QA review. If historical QA reviews become important, add Option 2 later. Update the frontend route to use the job detail endpoint.

**Note:** The `api.qa.list(jobId)` method in `api.ts` calls `GET /jobs/:id/qa` which doesn't exist in the backend. This will 404. Either add the backend endpoint or remove/replace this method.

#### Task 4.2 — Render real QA dimensions

Map backend QA review to dimension cards:

```typescript
const dimensions = [
  {
    label: 'Keyword Match',
    score: qa.keyword_match,
    weight: 0.40,
    status: qa.keyword_match >= 0.85 ? 'STRONG' : qa.keyword_match >= 0.60 ? 'MODERATE' : 'WEAK',
    color: qa.keyword_match >= 0.85 ? 'green' : qa.keyword_match >= 0.60 ? 'yellow' : 'red',
  },
  // ... same for experience_match (0.35), seniority_match (0.15)
  {
    label: 'Structure',
    score: qa.structure_valid ? 1.0 : 0.0,
    weight: 0.10,
    status: qa.structure_valid ? 'PASS' : 'FAIL',
    color: qa.structure_valid ? 'green' : 'red',
    isBoolean: true,
  },
];
```

#### Task 4.3 — Render gaps

The `qa_review.gaps` field is a JSONB array of `{ category, detail, severity }`. Map directly to the gaps UI:

- Filter by severity using the existing `gapFilter` state
- Sort: severity desc (high → medium → low), then category alphabetically (matches backend contract)
- Color severity tags: HIGH=red, MED=yellow, LOW=green

#### Task 4.4 — Render raw feedback

`qa_review.raw_feedback` is a single text string. Render in the collapsible raw feedback section. Split by newlines for line-by-line display.

#### Task 4.5 — Composite score and pass/fail

Compute or display from backend data:

```typescript
const composite = qa.score;        // already computed by backend
const threshold = qa.score_threshold;
const passed = qa.passed;
const delta = composite - threshold; // positive = passed, negative = failed by
```

---

### 5. Resume Viewer (`routes/jobs.$id_.resume.$vid.tsx`)

**Priority:** Medium — accessed from job detail.

**Current state:** Hardcoded resume HTML (Marcus Halloway), version switcher, tailoring notes, keyword panel. `api.resumes.getMarkdown()` defined but never called.

#### Task 5.1 — Fetch resume content

On mount, call `api.resumes.getMarkdown(id, vid)`:

1. Returns raw Markdown/RenderCV YAML text
2. Parse and render the resume content
3. Show loading state while fetching

**Rendering challenge:** The backend stores RenderCV YAML in `latex_source`, not HTML. The frontend currently renders hardcoded HTML. Options:

1. **Render Markdown to HTML** — if the content is Markdown, use a Markdown-to-HTML library (e.g., `marked`, `react-markdown`). Apply resume-specific CSS.
2. **Render YAML as structured content** — parse the RenderCV YAML and render each section (contact, summary, experience, skills, education) as React components.
3. **Show raw source** — display the YAML/Markdown in a code block with syntax highlighting. Less pretty but accurate.

**Recommendation:** Option 2 is the most polished. Parse the RenderCV YAML structure and render each section. This gives full control over styling and matches the existing resume preview design.

#### Task 5.2 — Version switcher

Fetch all versions with `api.resumes.list(id)`:

1. Render version pills (V1, V2, V3, etc.) from `resume_versions`
2. On version click, navigate to `/jobs/${id}/resume/${version_id}` or refetch content
3. Highlight current version based on URL param `vid`

#### Task 5.3 — Tailoring notes

Each `ResumeVersion` has a `tailoring_notes` text field. Render in the sidebar:

- Parse tailoring notes (they may be structured text or free-form)
- Display as a list of changes made in this version

#### Task 5.4 — PDF download

Wire the download button to `api.resumes.pdfUrl(id, vid)`:

```typescript
<a href={api.resumes.pdfUrl(id, vid)} download>Download PDF</a>
```

This triggers the backend's `GET /jobs/:id/resume/:vid/pdf` which renders via RenderCV and returns the PDF with caching headers.

#### Task 5.5 — Keyword panel

The keyword panel currently shows hardcoded hit/miss data. The backend doesn't return per-keyword hit/miss data — only `keyword_match` as a score.

**Options:**
1. **Remove keyword panel** — the data isn't available from the API
2. **Derive from `required_skills` + resume content** — fetch `required_skills` from the job detail, check which appear in the resume text. This is client-side approximation.
3. **Add keyword detail to QA review** — extend the backend to return per-keyword results

**Recommendation:** Option 2 as a quick approximation. Fetch `required_skills` from the job, do a case-insensitive search in the resume content. Mark each as hit/miss.

---

### 6. Settings (`routes/settings.tsx`)

**Priority:** Medium — needed for configuration changes after onboarding.

**Current state:** Form values in `useState` with hardcoded defaults. No backend calls on load or save.

#### Task 6.1 — Load profile on mount

On mount, call `api.profile.get()`:

1. Populate form fields from response:

| Form field | Backend field |
|---|---|
| Seniority track | `target_seniority` |
| Max iterations | `max_iterations` |
| QA threshold | `qa_threshold` |
| Telegram chat ID | `notify_telegram_chat_id` |
| Display name (header) | `display_name` |

2. Show loading state while fetching
3. If 404 → redirect to `/onboarding`

#### Task 6.2 — Wire Save Changes

On "Save Changes" click, call `api.profile.update(data)` with `PATCH /profile`:

```typescript
const handleSave = async () => {
  await api.profile.update({
    target_seniority: SENIORITY_OPTIONS[seniority],
    max_iterations: maxIters,
    qa_threshold: threshold,
    notify_telegram_chat_id: chatId || null,
  });
  // Show success toast
};
```

Handle validation errors (`400` with `fields[]` array) by showing inline field errors.

#### Task 6.3 — Wire Telegram test/clear

- "Clear" button → `api.profile.update({ notify_telegram_chat_id: null })`
- "Test Notification" → needs a new backend endpoint (doesn't exist yet). For now, disable or remove this button.

#### Task 6.4 — Wire danger zone

"Reset Profile" is a destructive action. The backend doesn't have a `DELETE /profile` endpoint.

**Options:**
1. Remove the button for now
2. Add `DELETE /profile` to the backend

**Recommendation:** Remove for now. Profile deletion is a rare operation that can be done via DB directly.

---

## Type & API Client Changes (Summary)

### `frontend/app/lib/types.ts`

```typescript
// 1. Fix UserProfile to match backend
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

// 2. Add JobDetail extending Job
export interface JobDetail extends Job {
  updated_at: string;
  required_skills: string[] | null;
  nice_to_haves: string[] | null;
  qa_review: QAReview | null;
  pipeline_events: PipelineEvent[];
}

// 3. Add JobStatus 'new' (it's a valid status but missing from the union)
export type JobStatus =
  | "new"       // ← add this
  | "found"
  | "tailoring"
  // ...
```

### `frontend/app/lib/api.ts`

```typescript
// 1. Fix default URL
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3002";

// 2. Add missing methods
export const api = {
  jobs: {
    list: () => request<Job[]>("/jobs"),
    get: (id: string) => request<JobDetail>(`/jobs/${id}`),
    status: (id: string) => request<JobStatusResponse>(`/jobs/${id}/status`),
    submit: (url: string) => request<{ job_id: string; status: string; status_url: string }>("/jobs", {
      method: "POST",
      body: JSON.stringify({ url }),
    }),
  },
  // ... existing resumes + events stay the same
  profile: {
    get: () => request<UserProfile>("/profile"),
    create: (display_name: string) => request<{ ok: true }>("/profile", {
      method: "POST",
      body: JSON.stringify({ display_name }),
    }),
    update: (data: Partial<UserProfile>) => request<UserProfile>("/profile", {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
    setApiKey: (api_key: string) => request<{ ok: true }>("/profile/api-key", {
      method: "PUT",
      body: JSON.stringify({ api_key }),
    }),
    deleteApiKey: () => request<{ ok: true }>("/profile/api-key", {
      method: "DELETE",
    }),
    checkApiKey: () => request<{ configured: boolean }>("/profile/api-key"),
  },
};
```

---

## Backend Gaps (Endpoints Needed)

| Frontend needs | Existing endpoint | Gap |
|---|---|---|
| QA reviews list | None (`api.qa.list()` calls `/jobs/:id/qa` which 404s) | Add `GET /jobs/:id/qa` returning all `qa_reviews` for the job, or remove `api.qa.list()` and use `GET /jobs/:id` |
| Validate OpenRouter key | None | Optional: add `POST /profile/api-key/validate` |
| Delete profile | None | Optional: add `DELETE /profile` for settings reset |
| Global event feed | None (`GET /events` doesn't exist) | Optional: add `GET /events?limit=N` for dashboard feed |
| Telegram test ping | None | Optional: add `POST /profile/telegram/test` |

**Minimum required backend change:** Add `GET /jobs/:id/qa` or update the frontend to not call it.

---

## Execution Order

```
Phase 1: Foundation (do first)
  P1. Fix UserProfile type
  P2. Fix Job/JobDetail types
  P3. Add missing api.ts methods
  P4. Fix API URL default

Phase 2: Onboarding (gates everything)
  1.3  Check for existing profile on mount
  1.1  Wire profile creation on Launch
  1.2  Wire API key validation

Phase 3: Dashboard (main screen)
  2.1  Fetch real jobs list
  2.2  Wire job submission
  2.3  Compute real stats
  2.5  Remove/simplify agent status section
  2.6  Auto-refresh polling

Phase 4: Job Detail (primary detail view)
  3.1  Fetch job detail
  3.2  Render QA score breakdown
  3.3  Render pipeline events
  3.6  Render sidebar metadata
  3.7  Approved banner
  3.4  Live SSE updates
  3.5  Iteration history

Phase 5: QA Report
  4.1  Decide data source (add backend endpoint or use GET /jobs/:id)
  4.2  Render real QA dimensions
  4.3  Render gaps
  4.4  Render raw feedback
  4.5  Composite score and pass/fail

Phase 6: Resume Viewer
  5.1  Fetch resume content
  5.2  Version switcher
  5.3  Tailoring notes
  5.4  PDF download
  5.5  Keyword panel (approximation)

Phase 7: Settings
  6.1  Load profile on mount
  6.2  Wire Save Changes
  6.3  Wire Telegram clear
  6.4  Remove danger zone (no backend support)

Phase 8: Polish (optional)
  2.4  Dashboard global event feed
  Cross-route error handling (toast/notification system)
  Loading skeletons for all routes
  Optimistic updates for job submission
```

---

## Shared Patterns to Implement

### Loading & Error States

Create reusable hooks/patterns used across all routes:

```typescript
// Custom hook for API calls
function useApi<T>(fetcher: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    setLoading(true);
    fetcher()
      .then(setData)
      .catch(setError)
      .finally(() => setLoading(false));
  }, deps);

  return { data, loading, error };
}
```

### Terminal status check

```typescript
const TERMINAL_STATUSES: JobStatus[] = ['approved', 'low_match', 'error'];
const isTerminal = (s: JobStatus) => TERMINAL_STATUSES.includes(s);
```

### Timestamp formatting

All backend timestamps are ISO strings. Create a shared formatter:

```typescript
function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' · today';
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' · ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
```
