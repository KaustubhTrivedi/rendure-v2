import { Hono } from 'hono'
import { spawn } from 'child_process'
import { resolve } from 'path'
import { streamSSE } from 'hono/streaming'
import { pool } from '../db.js'
import { httpError } from '../errors.js'
import {
  RenderCvFailedError,
  RenderCvTimeoutError,
  RenderCvUnavailableError,
  getOrRenderPdf,
} from '../resume-render.js'
import { PIPELINE_SSE_EVENT, isTerminalStatus, toPipelineEventPayload, SSE_KEEPALIVE_COMMENT, SSE_KEEPALIVE_MS } from '../sse.js'
import { listenForPipelineEvents } from '../pg-listener.js'

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
    return httpError(c, 400, 'bad_request', 'url is required and must be a non-empty string.')
  }

  const url = body.url.trim()

  // Basic URL validation
  try {
    new URL(url)
  } catch {
    return httpError(c, 400, 'bad_request', 'url must be a valid URL.')
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
 * GET /jobs/:id/events
 *
 * SSE stream of pipeline events for a job.
 * Replays all prior events ordered by timestamp ASC, event_id ASC.
 * Supports Last-Event-ID cursor for reconnection.
 * Closes cleanly when a terminal row is replayed.
 */
jobs.get('/:id/events', async (c) => {
  const id = c.req.param('id')

  const jobResult = await pool.query(
    `SELECT job_id, status FROM jobs WHERE job_id = $1`,
    [id],
  )
  if (jobResult.rows.length === 0) {
    return httpError(c, 404, 'not_found', 'Job not found.')
  }

  const lastEventId = c.req.header('Last-Event-ID')

  let cursorClause = ''
  let cursorParams: unknown[] = [id]
  if (lastEventId) {
    const cursorResult = await pool.query(
      `SELECT event_id, timestamp FROM pipeline_events WHERE job_id = $1 AND event_id = $2`,
      [id, lastEventId],
    )
    if (cursorResult.rows.length > 0) {
      const cursor = cursorResult.rows[0]
      cursorClause = `AND (timestamp, event_id) > ($2::timestamptz, $3::uuid)`
      cursorParams = [id, cursor.timestamp, cursor.event_id]
    }
    // Unknown Last-Event-ID falls back to full replay per D-10
  }

  const replayResult = await pool.query(
    `SELECT event_id, job_id, event_type, agent_name, from_status, to_status, model_used, detail, metadata, timestamp
     FROM pipeline_events
     WHERE job_id = $1 ${cursorClause}
     ORDER BY timestamp ASC, event_id ASC`,
    cursorParams,
  )

  return streamSSE(c, async (stream) => {
    let lastSentTimestamp: string | null = null
    let lastSentEventId: string | null = null
    let closed = false
    let keepalive: ReturnType<typeof setInterval> | undefined
    // listener is the PipelineEventListener returned by listenForPipelineEvents
    let listener: Awaited<ReturnType<typeof listenForPipelineEvents>> | undefined
    let flushing = false
    let flushAgain = false
    let resolveClose: () => void
    const closePromise = new Promise<void>((r) => { resolveClose = r })

    async function sendRowsAfterCursor() {
      if (closed) return
      if (flushing) { flushAgain = true; return }
      flushing = true
      flushAgain = false
      try {
        const result = lastSentTimestamp && lastSentEventId
          ? await pool.query(
              `SELECT event_id, job_id, event_type, agent_name, from_status, to_status, model_used, detail, metadata, timestamp
               FROM pipeline_events
               WHERE job_id = $1 AND (timestamp, event_id) > ($2::timestamptz, $3::uuid)
               ORDER BY timestamp ASC, event_id ASC`,
              [id, lastSentTimestamp, lastSentEventId],
            )
          : await pool.query(
              `SELECT event_id, job_id, event_type, agent_name, from_status, to_status, model_used, detail, metadata, timestamp
               FROM pipeline_events
               WHERE job_id = $1
               ORDER BY timestamp ASC, event_id ASC`,
              [id],
            )
        for (const row of result.rows) {
          if (closed) return
          await stream.writeSSE({
            id: row.event_id,
            event: PIPELINE_SSE_EVENT,
            data: JSON.stringify(toPipelineEventPayload(row)),
          })
          lastSentTimestamp = row.timestamp
          lastSentEventId = row.event_id
          if (isTerminalStatus(row.to_status)) {
            closed = true
            clearInterval(keepalive)
            // listener.close() cleans up the pg LISTEN subscription
            if (listener) await listener.close()
            resolveClose!()
            return
          }
        }
      } catch {
        // Stream may have closed
      } finally {
        flushing = false
        if (flushAgain && !closed) await sendRowsAfterCursor()
      }
    }

    // Emit replay rows
    for (const row of replayResult.rows) {
      await stream.writeSSE({
        id: row.event_id,
        event: PIPELINE_SSE_EVENT,
        data: JSON.stringify(toPipelineEventPayload(row)),
      })
      lastSentTimestamp = row.timestamp
      lastSentEventId = row.event_id
      if (isTerminalStatus(row.to_status)) {
        closed = true
        // Terminal during replay — no listener yet, return early
        return
      }
    }

    // Start keepalive interval
    keepalive = setInterval(() => {
      void stream.write(SSE_KEEPALIVE_COMMENT)
    }, SSE_KEEPALIVE_MS)

    // Register listener BEFORE catch-up query to close the race window:
    // rows inserted after replay but before active LISTEN registration
    // are caught by the immediate catch-up below.
    try {
      listener = await listenForPipelineEvents((notification) => {
        if (notification.job_id === id) void sendRowsAfterCursor()
      })
    } catch {
      if (!closed) {
        await stream.writeSSE({
          event: 'stream_error',
          data: JSON.stringify({ error: 'Stream failed.' }),
        })
      }
      clearInterval(keepalive)
      resolveClose!()
      return
    }

    // Immediate catch-up query (closes replay → LISTEN race)
    await sendRowsAfterCursor()

    // If catch-up already closed the stream (terminal row), return
    if (closed) return

    stream.onAbort(() => {
      closed = true
      clearInterval(keepalive)
      void listener?.close()
      resolveClose!()
    })

    // Wait until the stream is closed (terminal row or client abort)
    await closePromise
  })
})

/**
 * GET /jobs/:id/resumes
 *
 * List stored resume versions for a job, ordered by iteration.
 */
jobs.get('/:id/resumes', async (c) => {
  const id = c.req.param('id')

  const jobResult = await pool.query(
    `SELECT job_id FROM jobs WHERE job_id = $1`,
    [id],
  )
  if (jobResult.rows.length === 0) {
    return httpError(c, 404, 'not_found', 'Job not found.')
  }

  const result = await pool.query(
    `SELECT version_id, version_number, created_at, tailoring_notes
     FROM resume_versions
     WHERE job_id = $1
     ORDER BY version_number ASC`,
    [id],
  )

  return c.json(result.rows)
})

/**
 * GET /jobs/:id/resume/:version_id
 *
 * Return raw stored tailored source text for a resume version owned by the job.
 */
jobs.get('/:id/resume/:version_id', async (c) => {
  const id = c.req.param('id')
  const versionId = c.req.param('version_id')

  const result = await pool.query(
    `SELECT latex_source FROM resume_versions WHERE job_id = $1 AND version_id = $2`,
    [id, versionId],
  )
  if (result.rows.length === 0) {
    return httpError(c, 404, 'not_found', 'Resume version not found.')
  }

  return c.text(result.rows[0].latex_source, 200, {
    'Content-Type': 'text/markdown; charset=utf-8',
  })
})

/**
 * GET /jobs/:id/resume/:version_id/pdf
 *
 * Return a RenderCV-rendered PDF for a resume version owned by the job.
 */
jobs.get('/:id/resume/:version_id/pdf', async (c) => {
  const id = c.req.param('id')
  const versionId = c.req.param('version_id')

  const result = await pool.query(
    `SELECT latex_source FROM resume_versions WHERE job_id = $1 AND version_id = $2`,
    [id, versionId],
  )
  if (result.rows.length === 0) {
    return httpError(c, 404, 'not_found', 'Resume version not found.')
  }

  try {
    const pdf = await getOrRenderPdf({ versionId, source: result.rows[0].latex_source })
    return c.body(pdf, 200, {
      'Content-Type': 'application/pdf',
      'Content-Length': String(pdf.byteLength),
      'Cache-Control': 'private, max-age=31536000, immutable',
    })
  } catch (error) {
    if (error instanceof RenderCvUnavailableError) {
      return httpError(c, 503, 'internal_error', 'RenderCV unavailable.', {
        type: 'rendercv_unavailable',
        detail: 'RenderCV is not available on this host.',
      })
    }
    if (error instanceof RenderCvTimeoutError) {
      return httpError(c, 504, 'internal_error', 'RenderCV render timed out.', {
        type: 'render_timeout',
        detail: 'Resume PDF rendering timed out.',
      })
    }
    if (error instanceof RenderCvFailedError) {
      return httpError(c, 500, 'internal_error', 'Resume PDF render failed.', {
        type: 'render_failed',
        detail: 'Resume PDF rendering failed.',
      })
    }
    throw error
  }
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
    return httpError(c, 404, 'not_found', 'Job not found.')
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
    return httpError(c, 404, 'not_found', 'Job not found.')
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
