import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { pool } from './db.js'

/**
 * Absolute path to the project root (parent of api/).
 * api/src/job-submission.ts → api/src/ → api/ → project root via resolve('..', '..')
 */
const PROJECT_ROOT = process.env.PROJECT_ROOT ?? resolve(import.meta.dirname, '..', '..')

/**
 * Result of a job submission attempt.
 *
 * Discriminated by `statusCode` so callers can narrow with a single check:
 *   - 200-level → has `body` (JSON-serializable payload)
 *   - 400-level → has `errorCode` + `title` (for httpError mapping)
 */
export type JobSubmitSuccess = {
  statusCode: 202
  body: { job_id: string; status: 'new'; status_url: string }
}

export type JobSubmitDuplicate = {
  statusCode: 409
  body: { error: string; job_id: string; status: string; status_url: string }
}

export type JobSubmitBadRequest = {
  statusCode: 400
  errorCode: 'bad_request'
  title: string
  detail?: string
}

export type JobSubmitInternalError = {
  statusCode: 500
  errorCode: 'internal_error'
  title: string
  detail?: string
}

export type JobSubmitResult =
  | JobSubmitSuccess
  | JobSubmitDuplicate
  | JobSubmitBadRequest
  | JobSubmitInternalError

/**
 * Build a status polling URL for a given job ID.
 */
export function statusUrl(jobId: string): string {
  return `/jobs/${jobId}/status`
}

/**
 * Submit a job posting URL to the pipeline.
 *
 * 1. Validates the URL is parseable.
 * 2. Checks for an existing duplicate entry.
 * 3. Inserts a new `jobs` row with status `'new'`.
 * 4. Spawns the Python orchestrator as a detached subprocess.
 * 5. Handles spawn errors by writing error status + pipeline_event to the DB.
 *
 * Returns a discriminated `JobSubmitResult` — callers should check `result.statusCode`
 * and either call `c.json(result.body, result.statusCode)` for 200-level responses or
 * `httpError(c, result.statusCode, result.errorCode, result.title)` for error responses.
 *
 * This function never throws for expected error conditions (invalid input, duplicates,
 * spawn failures). Unexpected errors (DB connection loss, etc.) propagate normally.
 */
export async function submitJobUrl(url: string): Promise<JobSubmitResult> {
  // 1. Validate URL
  try {
    new URL(url)
  } catch {
    return { statusCode: 400, errorCode: 'bad_request', title: 'url must be a valid URL.' }
  }

  // 2. Check for duplicate — the DB has a partial unique index on job_url
  const existing = await pool.query(
    `SELECT job_id, status FROM jobs WHERE job_url = $1`,
    [url],
  )
  if (existing.rows.length > 0) {
    const existingJob = existing.rows[0]
    return {
      statusCode: 409,
      body: {
        error: 'This URL has already been submitted.',
        job_id: existingJob.job_id,
        status: existingJob.status,
        status_url: statusUrl(existingJob.job_id),
      },
    }
  }

  // 3. Pre-insert the job row so we can return a job_id immediately
  const insert = await pool.query(
    `INSERT INTO jobs (job_url, status) VALUES ($1, 'new') RETURNING job_id`,
    [url],
  )
  const job_id: string = insert.rows[0].job_id

  // 4. Spawn the pipeline detached — we don't wait for it to finish
  const child = spawn(
    'uv',
    ['run', 'python', 'run_agents.py', url, '--job-id', job_id],
    {
      cwd: PROJECT_ROOT,
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    },
  )
  child.unref()

  // 5. Handle spawn errors by recording error in DB
  child.on('error', async (error) => {
    try {
      await pool.query(
        `UPDATE jobs SET status = 'error', updated_at = NOW() WHERE job_id = $1`,
        [job_id],
      )
      await pool.query(
        `INSERT INTO pipeline_events (job_id, event_type, agent_name, detail, metadata)
         VALUES ($1, 'pipeline_error', 'api', $2, $3)`,
        [job_id, `Failed to spawn pipeline worker: ${error.message}`, { reason: error.message }],
      )
    } catch {
      // The request has already returned; DB write failures are not recoverable here.
    }
  })

  // Return immediately — pipeline runs in background
  return {
    statusCode: 202,
    body: { job_id, status: 'new', status_url: statusUrl(job_id) },
  }
}
