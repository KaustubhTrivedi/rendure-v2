import { pool } from './db.js'
import { decrypt } from './crypto.js'
import { runPipeline } from './execution-adapter.js'


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
 * 4. Dispatches the Python orchestrator through the execution adapter.
 * 5. Returns immediately while the detached subprocess continues in the background.
 * Returns a discriminated `JobSubmitResult` — callers should check `result.statusCode`
 * and either call `c.json(result.body, result.statusCode)` for 200-level responses or
 * `httpError(c, result.statusCode, result.errorCode, result.title)` for error responses.
 *
 * spawn failures). Unexpected errors (DB connection loss, etc.) propagate normally.
 */
export async function submitJobUrl(
  url: string,
  options: { autoApply?: boolean } = {},
): Promise<JobSubmitResult> {
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

  // 4. Fetch user profile settings to pass to the pipeline
  const profileResult = await pool.query(
    `SELECT openrouter_api_key_enc, preferred_model, qa_threshold, max_iterations,
            model_job_scout, model_resume_tailor, model_quality_analyst,
            model_confirmation, model_orchestrator
     FROM user_profile WHERE id = 1`,
  )
  const profile = profileResult.rows[0] ?? {}

  const pipelineEnv: NodeJS.ProcessEnv = { ...process.env }

  if (profile.openrouter_api_key_enc) {
    try {
      pipelineEnv.OPENROUTER_API_KEY = decrypt(profile.openrouter_api_key_enc)
    } catch {
      // Decryption failure is non-fatal — pipeline will fail with its own error
    }
  }
  if (profile.preferred_model) {
    pipelineEnv.OPENROUTER_MODEL = profile.preferred_model
  }
  if (profile.qa_threshold != null) {
    pipelineEnv.QA_PASS_THRESHOLD = String(profile.qa_threshold)
  }
  if (profile.max_iterations != null) {
    pipelineEnv.MAX_TAILORING_ITERATIONS = String(profile.max_iterations)
  }

  const agentEnvMap: Array<[string, string]> = [
    ['MODEL_JOB_SCOUT', profile.model_job_scout],
    ['MODEL_RESUME_TAILOR', profile.model_resume_tailor],
    ['MODEL_QUALITY_ANALYST', profile.model_quality_analyst],
    ['MODEL_CONFIRMATION', profile.model_confirmation],
    ['MODEL_ORCHESTRATOR', profile.model_orchestrator],
  ]
  for (const [envKey, val] of agentEnvMap) {
    if (val) pipelineEnv[envKey] = val
  }

  // 5. Dispatch the pipeline through the execution adapter — we don't wait for it to finish
  runPipeline(url, job_id, pool, pipelineEnv, { autoApply: options.autoApply === true })

  // Return immediately — pipeline runs in background
  return {
    statusCode: 202,
    body: { job_id, status: 'new', status_url: statusUrl(job_id) },
  }
}
