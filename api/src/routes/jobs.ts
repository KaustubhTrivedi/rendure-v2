import { Hono } from 'hono'
import { spawn } from 'child_process'
import { resolve } from 'path'
import { pool } from '../db.js'

const jobs = new Hono()

// Absolute path to project root (api/ is one level down)
const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..', '..')

function statusUrl(jobId: string) {
  return `/jobs/${jobId}/status`
}

/**
 * POST /jobs
 *
 * Submit a job posting URL to the pipeline.
 * Spawns the Python orchestrator as a detached subprocess and returns immediately.
 *
 * Body: { "url": "https://..." }
 * Response 202: { "job_id": "<uuid>", "status": "new" }
 * Response 409: URL already submitted
 */
jobs.post('/', async (c) => {
  const body = await c.req.json().catch(() => null)

  if (!body || typeof body.url !== 'string' || !body.url.trim()) {
    return c.json({ error: 'url is required and must be a non-empty string.' }, 400)
  }

  const url = body.url.trim()

  // Basic URL validation
  try {
    new URL(url)
  } catch {
    return c.json({ error: 'url must be a valid URL.' }, 400)
  }

  // Check for duplicate — the DB has a partial unique index on job_url
  const existing = await pool.query(
    `SELECT job_id, status FROM jobs WHERE job_url = $1`,
    [url]
  )
  if (existing.rows.length > 0) {
    const existingJob = existing.rows[0]
    return c.json(
      {
        error: 'This URL has already been submitted.',
        job_id: existingJob.job_id,
        status: existingJob.status,
        status_url: statusUrl(existingJob.job_id),
      },
      409
    )
  }

  // Pre-insert the job row so we can return a job_id immediately.
  // The orchestrator will pick up from status='new' and advance from there.
  const insert = await pool.query(
    `INSERT INTO jobs (job_url, status) VALUES ($1, 'new') RETURNING job_id`,
    [url]
  )
  const job_id: string = insert.rows[0].job_id

  // Spawn the pipeline detached — we don't wait for it to finish
  const child = spawn(
    'uv',
    ['run', 'python', 'run_agents.py', url, '--job-id', job_id],
    {
      cwd: PROJECT_ROOT,
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    }
  )
  child.unref()

  child.on('error', async (error) => {
    try {
      await pool.query(
        `UPDATE jobs SET status = 'error', updated_at = NOW() WHERE job_id = $1`,
        [job_id]
      )
      await pool.query(
        `INSERT INTO pipeline_events (job_id, event_type, agent_name, detail, metadata)
         VALUES ($1, 'pipeline_error', 'api', $2, $3)`,
        [job_id, `Failed to spawn pipeline worker: ${error.message}`, { reason: error.message }]
      )
    } catch {
      // The request has already returned; DB write failures are not recoverable here.
    }
  })

  return c.json({ job_id, status: 'new', status_url: statusUrl(job_id) }, 202)
})

/**
 * GET /jobs
 *
 * List all jobs, most recent first.
 *
 * Response 200: array of job summary objects
 */
jobs.get('/', async (c) => {
  const result = await pool.query(
    `SELECT
       job_id,
       job_url,
       company_name,
       role_title,
       status,
       qa_score,
       iteration_count,
       created_at,
       updated_at
     FROM jobs
     ORDER BY created_at DESC`
  )
  return c.json(result.rows)
})

/**
 * GET /jobs/:id/status
 *
 * Compact polling endpoint for the frontend.
 */
jobs.get('/:id/status', async (c) => {
  const id = c.req.param('id')

  const result = await pool.query(
    `SELECT
       job_id,
       status,
       qa_score,
       iteration_count,
       company_name,
       role_title,
       active_resume_id,
       updated_at
     FROM jobs
     WHERE job_id = $1`,
    [id]
  )

  if (result.rows.length === 0) {
    return c.json({ error: 'Job not found.' }, 404)
  }

  return c.json(result.rows[0])
})

/**
 * GET /jobs/:id
 *
 * Return the full status of a single job, including the latest QA review if any.
 *
 * Response 200: job object with optional qa_review and pipeline_events
 * Response 404: job not found
 */
jobs.get('/:id', async (c) => {
  const id = c.req.param('id')

  const jobResult = await pool.query(
    `SELECT
       j.job_id,
       j.job_url,
       j.company_name,
       j.role_title,
       j.seniority_level,
       j.location,
       j.required_skills,
       j.nice_to_haves,
       j.status,
       j.qa_score,
       j.iteration_count,
       j.active_resume_id,
       j.created_at,
       j.updated_at
     FROM jobs j
     WHERE j.job_id = $1`,
    [id]
  )

  if (jobResult.rows.length === 0) {
    return c.json({ error: 'Job not found.' }, 404)
  }

  const job = jobResult.rows[0]

  // Latest QA review for this job (if any)
  const qaResult = await pool.query(
    `SELECT
       qr.review_id,
       qr.score,
       qr.passed,
       qr.keyword_match,
       qr.experience_match,
       qr.seniority_match,
       qr.structure_valid,
       qr.gaps,
       qr.raw_feedback,
       qr.created_at
     FROM qa_reviews qr
     JOIN resume_versions rv ON rv.version_id = qr.version_id
     WHERE rv.job_id = $1
     ORDER BY qr.created_at DESC
     LIMIT 1`,
    [id]
  )

  // Recent pipeline events for this job (last 20)
  const eventsResult = await pool.query(
    `SELECT
       event_type,
       agent_name,
       from_status,
       to_status,
       detail,
       timestamp
     FROM pipeline_events
     WHERE job_id = $1
     ORDER BY timestamp DESC
     LIMIT 20`,
    [id]
  )

  return c.json({
    ...job,
    qa_review: qaResult.rows[0] ?? null,
    pipeline_events: eventsResult.rows,
  })
})

export default jobs
