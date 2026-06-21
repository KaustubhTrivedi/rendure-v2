import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import type pg from 'pg'

const PROJECT_ROOT = process.env.PROJECT_ROOT ?? resolve(import.meta.dirname, '..', '..')

/**
 * Spawn the job discovery agent as a detached, fire-and-forget process.
 * Returns immediately — the discovery run continues in the background.
 */
export function runDiscovery(pipelineEnv: NodeJS.ProcessEnv = process.env): void {
  const child = spawn(
    'uv',
    ['run', 'python', 'run_discovery.py'],
    {
      cwd: pipelineEnv.PROJECT_ROOT ?? PROJECT_ROOT,
      detached: true,
      stdio: 'ignore',
      env: pipelineEnv,
    },
  )
  child.unref()
}

export function runPipeline(
  url: string,
  jobId: string,
  pool: pg.Pool,
  pipelineEnv: NodeJS.ProcessEnv,
): void {
  const child = spawn(
    'uv',
    ['run', 'python', 'run_agents.py', url, '--job-id', jobId],
    {
      cwd: pipelineEnv.PROJECT_ROOT ?? PROJECT_ROOT,
      detached: true,
      stdio: 'ignore',
      env: pipelineEnv,
    },
  )
  child.unref()

  child.on('error', async (error) => {
    try {
      await pool.query(
        `UPDATE jobs SET status = 'error', updated_at = NOW() WHERE job_id = $1`,
        [jobId],
      )
      await pool.query(
        `INSERT INTO pipeline_events (job_id, event_type, agent_name, detail, metadata)
         VALUES ($1, 'pipeline_error', 'api', $2, $3)`,
        [jobId, `Failed to spawn pipeline worker: ${error.message}`, { reason: error.message }],
      )
    } catch {
      // The request has already returned; DB write failures are not recoverable here.
    }
  })
}
