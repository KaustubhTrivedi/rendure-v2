import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { submitJobUrl, statusUrl } from './job-submission.js'
import { pool } from './db.js'

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

vi.mock('./db.js', () => ({
  pool: {
    query: vi.fn(),
  },
}))

vi.mock('./crypto.js', () => ({
  decrypt: vi.fn((val: string) => `decrypted:${val}`),
  encrypt: vi.fn((val: string) => `encrypted:${val}`),
}))

const query = vi.mocked(pool.query)
const spawnMock = vi.mocked(spawn)

const originalEnv = { ...process.env }

function mockChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    kill: ReturnType<typeof vi.fn>
    unref: () => void
  }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn()
  child.unref = vi.fn()
  spawnMock.mockReturnValue(child as ReturnType<typeof spawn>)
  return child
}

describe('statusUrl', () => {
  it('returns the status URL path for a given job ID', () => {
    expect(statusUrl('job-123')).toBe('/jobs/job-123/status')
  })
})

describe('submitJobUrl', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env = { ...originalEnv }
  })

  it('inserts a new job, spawns the pipeline, and returns 202 with job_id, status, status_url', async () => {
    const child = mockChild()
    query
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ job_id: 'job-123' }] } as never)
      .mockResolvedValueOnce({
        rows: [{
          openrouter_api_key_enc: 'enc-key',
          preferred_model: 'anthropic/claude-3.5-sonnet',
          qa_threshold: 0.85,
          max_iterations: 3,
        }],
      } as never)

    const result = await submitJobUrl('https://example.com/job')

    expect(result.statusCode).toBe(202)

    // TypeScript discriminant: statusCode === 202 → body present
    const body = (result as { statusCode: 202; body: { job_id: string; status: string; status_url: string } }).body
    expect(body).toEqual({
      job_id: 'job-123',
      status: 'new',
      status_url: '/jobs/job-123/status',
    })

    expect(query).toHaveBeenNthCalledWith(
      1,
      `SELECT job_id, status FROM jobs WHERE job_url = $1`,
      ['https://example.com/job'],
    )
    expect(query).toHaveBeenNthCalledWith(
      2,
      `INSERT INTO jobs (job_url, status) VALUES ($1, 'new') RETURNING job_id`,
      ['https://example.com/job'],
    )
    expect(query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('openrouter_api_key_enc'),
    )
    expect(spawnMock).toHaveBeenCalledWith(
      'uv',
      ['run', 'python', 'run_agents.py', 'https://example.com/job', '--job-id', 'job-123'],
      expect.objectContaining({
        detached: true,
        stdio: 'ignore',
        env: expect.objectContaining({
          OPENROUTER_API_KEY: 'decrypted:enc-key',
          OPENROUTER_MODEL: 'anthropic/claude-3.5-sonnet',
          QA_PASS_THRESHOLD: '0.85',
          MAX_TAILORING_ITERATIONS: '3',
        }),
      }),
    )
    expect(child.unref).toHaveBeenCalledOnce()
  })

  it('spawns without adding profile-derived overrides when no profile row exists', async () => {
    const child = mockChild()
    delete process.env.OPENROUTER_API_KEY
    delete process.env.OPENROUTER_MODEL
    delete process.env.QA_PASS_THRESHOLD
    delete process.env.MAX_TAILORING_ITERATIONS
    process.env.INHERITED_ONLY = 'keep-me'

    query
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ job_id: 'job-123' }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)

    const result = await submitJobUrl('https://example.com/job')

    expect(result.statusCode).toBe(202)
    expect(spawnMock).toHaveBeenCalledWith(
      'uv',
      expect.any(Array),
      expect.objectContaining({ detached: true }),
    )
    const spawnEnv = spawnMock.mock.calls[0][2]?.env as Record<string, string>
    expect(spawnEnv).toMatchObject({ INHERITED_ONLY: 'keep-me' })
    expect(spawnEnv).not.toHaveProperty('OPENROUTER_API_KEY')
    expect(spawnEnv).not.toHaveProperty('OPENROUTER_MODEL')
    expect(spawnEnv).not.toHaveProperty('QA_PASS_THRESHOLD')
    expect(spawnEnv).not.toHaveProperty('MAX_TAILORING_ITERATIONS')
    expect(child.unref).toHaveBeenCalledOnce()
  })

  it('does not pass --auto-apply by default', async () => {
    mockChild()
    query
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ job_id: 'job-123' }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)

    await submitJobUrl('https://example.com/job')

    const args = spawnMock.mock.calls[0][1] as string[]
    expect(args).not.toContain('--auto-apply')
  })

  it('passes --auto-apply when autoApply option is true', async () => {
    mockChild()
    query
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ job_id: 'job-123' }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)

    await submitJobUrl('https://example.com/job', { autoApply: true })

    const args = spawnMock.mock.calls[0][1] as string[]
    expect(args).toContain('--auto-apply')
  })

  it('returns 409 for duplicate URL without spawning', async () => {
    query.mockResolvedValueOnce({ rows: [{ job_id: 'job-123', status: 'tailoring' }] } as never)

    const result = await submitJobUrl('https://example.com/job')

    expect(result.statusCode).toBe(409)

    const body = (result as { statusCode: 409; body: { error: string; job_id: string; status: string; status_url: string } }).body
    expect(body).toEqual({
      error: 'This URL has already been submitted.',
      job_id: 'job-123',
      status: 'tailoring',
      status_url: '/jobs/job-123/status',
    })

    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid URL without querying DB or spawning', async () => {
    const result = await submitJobUrl('not-a-url')

    expect(result.statusCode).toBe(400)
    if (result.statusCode === 400) {
      expect(result.errorCode).toBe('bad_request')
      expect(result.title).toBe('url must be a valid URL.')
    }
    expect(query).not.toHaveBeenCalled()
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('writes error status and pipeline_event when spawn errors', async () => {
    const child = mockChild()
    query
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ job_id: 'job-123' }] } as never)
      // Profile fetch
      .mockResolvedValueOnce({ rows: [] } as never)
      // Two more for the error handler UPDATE + INSERT
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)

    const result = await submitJobUrl('https://example.com/job')
    expect(result.statusCode).toBe(202)

    // Emit the spawn error asynchronously
    child.emit('error', new Error('uv not found'))

    // Give the async error handler time to settle
    await new Promise((r) => setTimeout(r, 10))

    // The error handler should have updated job status and written pipeline_events
    expect(query).toHaveBeenNthCalledWith(
      4,
      `UPDATE jobs SET status = 'error', updated_at = NOW() WHERE job_id = $1`,
      ['job-123'],
    )
    expect(query).toHaveBeenNthCalledWith(
      5,
      `INSERT INTO pipeline_events (job_id, event_type, agent_name, detail, metadata)
         VALUES ($1, 'pipeline_error', 'api', $2, $3)`,
      ['job-123', 'Failed to spawn pipeline worker: uv not found', { reason: 'uv not found' }],
    )
  })

  it('returns 400 for empty string URL without querying or spawning', async () => {
    const result = await submitJobUrl('')

    expect(result.statusCode).toBe(400)
    if (result.statusCode === 400) {
      expect(result.errorCode).toBe('bad_request')
      expect(result.title).toBe('url must be a valid URL.')
    }
    expect(query).not.toHaveBeenCalled()
    expect(spawnMock).not.toHaveBeenCalled()
  })
})
