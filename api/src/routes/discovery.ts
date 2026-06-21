import { Hono } from 'hono'
import { z } from 'zod'
import { pool } from '../db.js'
import { httpError } from '../errors.js'
import { runDiscovery, runPipeline } from '../execution-adapter.js'
import { decrypt } from '../crypto.js'

const discovery = new Hono()

// ── Zod schemas ────────────────────────────────────────────────────────────

const indeedQuerySchema = z.object({
  q: z.string().min(1),
  l: z.string().default(''),
})

const careerPageEntrySchema = z.union([
  z.string().url(),
  z.object({ url: z.string().url(), company: z.string().min(1) }),
])

export const putPreferencesSchema = z
  .object({
    target_roles: z.array(z.string().min(1)).optional(),
    locations: z.array(z.string().min(1)).optional(),
    excluded_companies: z.array(z.string().min(1)).optional(),
    min_seniority: z
      .enum(['junior', 'mid', 'senior', 'lead', 'staff', 'principal'])
      .nullable()
      .optional(),
    keywords: z.array(z.string().min(1)).optional(),
    greenhouse_companies: z.array(z.string().min(1)).optional(),
    lever_companies: z.array(z.string().min(1)).optional(),
    ashby_companies: z.array(z.string().min(1)).optional(),
    indeed_queries: z.array(indeedQuerySchema).optional(),
    workday_urls: z.array(z.string().url()).optional(),
    career_page_urls: z.array(careerPageEntrySchema).optional(),
  })
  .strict()

// ── Helper ─────────────────────────────────────────────────────────────────

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function normalizeDiscoveredJob<T extends Record<string, unknown>>(row: T): T {
  return { ...row, relevance_score: toNumberOrNull(row.relevance_score) }
}

// ── GET /discovery/preferences ─────────────────────────────────────────────

/**
 * GET /discovery/preferences
 *
 * Returns the current search_preferences row (id = 1).
 * A row always exists (seeded by migration 007).
 */
discovery.get('/preferences', async (c) => {
  const result = await pool.query(
    `SELECT
       target_roles, locations, excluded_companies, min_seniority, keywords,
       greenhouse_companies, lever_companies, ashby_companies,
       indeed_queries, workday_urls, career_page_urls,
       updated_at
     FROM search_preferences WHERE id = 1`,
  )
  return c.json(result.rows[0] ?? {})
})

// ── PUT /discovery/preferences ─────────────────────────────────────────────

/**
 * PUT /discovery/preferences
 *
 * Replaces the search_preferences row. All fields are optional — omitted
 * fields keep their current values (COALESCE in the upsert).
 *
 * Body: subset of search_preferences columns (validated by putPreferencesSchema)
 */
discovery.put('/preferences', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return httpError(c, 400, 'bad_request', 'Request body must be a JSON object.')
  }

  const parsed = putPreferencesSchema.safeParse(body)
  if (!parsed.success) {
    return httpError(c, 422, 'validation_failed', 'Invalid search preferences.', {
      fields: parsed.error.errors.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
      })),
    })
  }

  const data = parsed.data

  // Build a COALESCE upsert so only provided fields are updated
  await pool.query(
    `INSERT INTO search_preferences (id,
       target_roles, locations, excluded_companies, min_seniority, keywords,
       greenhouse_companies, lever_companies, ashby_companies,
       indeed_queries, workday_urls, career_page_urls
     ) VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (id) DO UPDATE SET
       target_roles       = COALESCE($1::jsonb,  search_preferences.target_roles),
       locations          = COALESCE($2::jsonb,  search_preferences.locations),
       excluded_companies = COALESCE($3::jsonb,  search_preferences.excluded_companies),
       min_seniority      = COALESCE($4::text,   search_preferences.min_seniority),
       keywords           = COALESCE($5::jsonb,  search_preferences.keywords),
       greenhouse_companies = COALESCE($6::jsonb, search_preferences.greenhouse_companies),
       lever_companies    = COALESCE($7::jsonb,  search_preferences.lever_companies),
       ashby_companies    = COALESCE($8::jsonb,  search_preferences.ashby_companies),
       indeed_queries     = COALESCE($9::jsonb,  search_preferences.indeed_queries),
       workday_urls       = COALESCE($10::jsonb, search_preferences.workday_urls),
       career_page_urls   = COALESCE($11::jsonb, search_preferences.career_page_urls),
       updated_at         = NOW()`,
    [
      data.target_roles != null ? JSON.stringify(data.target_roles) : null,
      data.locations != null ? JSON.stringify(data.locations) : null,
      data.excluded_companies != null ? JSON.stringify(data.excluded_companies) : null,
      data.min_seniority !== undefined ? data.min_seniority : null,
      data.keywords != null ? JSON.stringify(data.keywords) : null,
      data.greenhouse_companies != null ? JSON.stringify(data.greenhouse_companies) : null,
      data.lever_companies != null ? JSON.stringify(data.lever_companies) : null,
      data.ashby_companies != null ? JSON.stringify(data.ashby_companies) : null,
      data.indeed_queries != null ? JSON.stringify(data.indeed_queries) : null,
      data.workday_urls != null ? JSON.stringify(data.workday_urls) : null,
      data.career_page_urls != null ? JSON.stringify(data.career_page_urls) : null,
    ],
  )

  const updated = await pool.query(
    `SELECT target_roles, locations, excluded_companies, min_seniority, keywords,
            greenhouse_companies, lever_companies, ashby_companies,
            indeed_queries, workday_urls, career_page_urls, updated_at
     FROM search_preferences WHERE id = 1`,
  )
  return c.json(updated.rows[0], 200)
})

// ── GET /discovery/jobs ────────────────────────────────────────────────────

/**
 * GET /discovery/jobs
 *
 * List discovered jobs, sorted by relevance score desc then discovered_at desc.
 *
 * Query params:
 *   status   – filter by status (default: pending_review). Pass "all" for no filter.
 *   limit    – max rows (default 50, max 200)
 *   offset   – pagination offset (default 0)
 */
discovery.get('/jobs', async (c) => {
  const rawStatus = c.req.query('status') ?? 'pending_review'
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200)
  const offset = Number(c.req.query('offset') ?? 0)
  const sort = c.req.query('sort') ?? 'relevance'

  const validStatuses = ['pending_review', 'queued', 'rejected', 'duplicate', 'all']
  if (!validStatuses.includes(rawStatus)) {
    return httpError(c, 400, 'bad_request',
      `status must be one of: ${validStatuses.join(', ')}.`)
  }

  const orderClause = sort === 'recent'
    ? 'ORDER BY discovered_at DESC'
    : 'ORDER BY relevance_score DESC NULLS LAST, discovered_at DESC'

  const whereClause = rawStatus === 'all' ? '' : `WHERE status = $3`
  const params: unknown[] = rawStatus === 'all' ? [limit, offset] : [limit, offset, rawStatus]

  const result = await pool.query(
    `SELECT
       id, job_url, title, company, location, platform,
       raw_snippet, relevance_score, status, job_id,
       discovered_at, reviewed_at
     FROM discovered_jobs
     ${whereClause}
     ${orderClause}
     LIMIT $1 OFFSET $2`,
    params,
  )

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM discovered_jobs ${whereClause}`,
    rawStatus === 'all' ? [] : [rawStatus],
  )

  return c.json({
    jobs: result.rows.map(normalizeDiscoveredJob),
    total: countResult.rows[0].total,
    limit,
    offset,
  })
})

// ── GET /discovery/jobs/:id ────────────────────────────────────────────────

/**
 * GET /discovery/jobs/:id
 *
 * Return a single discovered job by its UUID.
 */
discovery.get('/jobs/:id', async (c) => {
  const id = c.req.param('id')
  const result = await pool.query(
    `SELECT id, job_url, title, company, location, platform,
            raw_snippet, relevance_score, status, job_id,
            discovered_at, reviewed_at
     FROM discovered_jobs WHERE id = $1`,
    [id],
  )
  if (result.rows.length === 0) {
    return httpError(c, 404, 'not_found', 'Discovered job not found.')
  }
  return c.json(normalizeDiscoveredJob(result.rows[0]))
})

// ── POST /discovery/jobs/:id/approve ──────────────────────────────────────

/**
 * POST /discovery/jobs/:id/approve
 *
 * Approve a discovered job:
 *  1. Inserts a row into jobs (status = 'new').
 *  2. Marks discovered_jobs row as 'queued' and links the job_id.
 *  3. Spawns the pipeline subprocess.
 *
 * Response 200: { job_id, status_url }
 * Response 404: discovered job not found
 * Response 409: already approved / queued
 */
discovery.post('/jobs/:id/approve', async (c) => {
  const id = c.req.param('id')

  const djResult = await pool.query(
    `SELECT id, job_url, title, company, status, job_id
     FROM discovered_jobs WHERE id = $1`,
    [id],
  )
  if (djResult.rows.length === 0) {
    return httpError(c, 404, 'not_found', 'Discovered job not found.')
  }

  const dj = djResult.rows[0]

  if (dj.status === 'queued') {
    return c.json({
      message: 'Already queued.',
      job_id: dj.job_id,
      status_url: `/jobs/${dj.job_id}/status`,
    }, 409 as 200)
  }

  // Insert into pipeline; ON CONFLICT handles re-approvals of the same URL
  const insertResult = await pool.query(
    `INSERT INTO jobs (job_url, status)
     VALUES ($1, 'new')
     ON CONFLICT (job_url) WHERE job_url IS NOT NULL AND job_url != ''
     DO UPDATE SET updated_at = NOW()
     RETURNING job_id`,
    [dj.job_url],
  )
  const jobId: string = insertResult.rows[0].job_id

  await pool.query(
    `UPDATE discovered_jobs
     SET status = 'queued', job_id = $1, reviewed_at = NOW()
     WHERE id = $2`,
    [jobId, id],
  )

  // Fetch profile settings for the pipeline environment
  const profileResult = await pool.query(
    `SELECT openrouter_api_key_enc, preferred_model, qa_threshold, max_iterations,
            model_job_scout, model_resume_tailor, model_quality_analyst,
            model_confirmation, model_orchestrator
     FROM user_profile WHERE id = 1`,
  )
  const profile = profileResult.rows[0] ?? {}
  const pipelineEnv: NodeJS.ProcessEnv = { ...process.env }

  if (profile.openrouter_api_key_enc) {
    try { pipelineEnv.OPENROUTER_API_KEY = decrypt(profile.openrouter_api_key_enc) } catch { /* non-fatal */ }
  }
  if (profile.preferred_model) pipelineEnv.OPENROUTER_MODEL = profile.preferred_model
  if (profile.qa_threshold != null) pipelineEnv.QA_PASS_THRESHOLD = String(profile.qa_threshold)
  if (profile.max_iterations != null) pipelineEnv.MAX_TAILORING_ITERATIONS = String(profile.max_iterations)

  for (const [envKey, col] of [
    ['MODEL_JOB_SCOUT', 'model_job_scout'],
    ['MODEL_RESUME_TAILOR', 'model_resume_tailor'],
    ['MODEL_QUALITY_ANALYST', 'model_quality_analyst'],
    ['MODEL_CONFIRMATION', 'model_confirmation'],
    ['MODEL_ORCHESTRATOR', 'model_orchestrator'],
  ] as const) {
    if (profile[col]) pipelineEnv[envKey] = profile[col]
  }

  runPipeline(dj.job_url, jobId, pool, pipelineEnv)

  return c.json({ job_id: jobId, status_url: `/jobs/${jobId}/status` }, 200)
})

// ── POST /discovery/jobs/:id/reject ───────────────────────────────────────

/**
 * POST /discovery/jobs/:id/reject
 *
 * Mark a discovered job as rejected.
 * Idempotent — rejecting an already-rejected job is a no-op.
 */
discovery.post('/jobs/:id/reject', async (c) => {
  const id = c.req.param('id')

  const result = await pool.query(
    `UPDATE discovered_jobs
     SET status = 'rejected', reviewed_at = NOW()
     WHERE id = $1 AND status != 'queued'
     RETURNING id`,
    [id],
  )

  if (result.rowCount === 0) {
    // Either doesn't exist or is already queued (pipeline running — can't reject)
    const existing = await pool.query(
      `SELECT status FROM discovered_jobs WHERE id = $1`, [id],
    )
    if (existing.rows.length === 0) {
      return httpError(c, 404, 'not_found', 'Discovered job not found.')
    }
    return httpError(c, 409, 'conflict',
      'Cannot reject a job that is already queued in the pipeline.')
  }

  return c.json({ id, status: 'rejected' }, 200)
})

// ── DELETE /discovery/jobs/:id ────────────────────────────────────────────

/**
 * DELETE /discovery/jobs/:id
 *
 * Hard-delete a discovered job from the staging table.
 * Blocked if the job has been queued (pipeline already running).
 */
discovery.delete('/jobs/:id', async (c) => {
  const id = c.req.param('id')

  // Block delete on queued jobs — pipeline is running, deleting would orphan it
  const existing = await pool.query(
    `SELECT status FROM discovered_jobs WHERE id = $1`, [id],
  )
  if (existing.rows.length === 0) {
    return httpError(c, 404, 'not_found', 'Discovered job not found.')
  }
  if (existing.rows[0].status === 'queued') {
    return httpError(c, 409, 'conflict',
      'Cannot delete a job that is already queued in the pipeline.')
  }

  await pool.query(`DELETE FROM discovered_jobs WHERE id = $1`, [id])
  return c.body(null, 204)
})

// ── POST /discovery/run ───────────────────────────────────────────────────

/**
 * POST /discovery/run
 *
 * Trigger an immediate discovery run in the background.
 * Returns 202 immediately — the run continues as a detached subprocess.
 *
 * Callers should poll GET /discovery/jobs to see new results appear.
 */
discovery.post('/run', async (c) => {
  runDiscovery()
  return c.json({ message: 'Discovery run started.' }, 202)
})

export default discovery
