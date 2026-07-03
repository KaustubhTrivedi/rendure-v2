import { EventEmitter } from 'node:events'
import { spawn, type ChildProcess } from 'node:child_process'
import type pg from 'pg'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runPipeline } from './execution-adapter.js'

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

const spawnMock = vi.mocked(spawn)

type MockChild = EventEmitter & {
  unref: () => void
}

function mockChild(): MockChild {
  const child = new EventEmitter() as MockChild
  child.unref = vi.fn()
  spawnMock.mockReturnValue(child as unknown as ChildProcess)
  return child
}

function createPool(): pg.Pool {
  return { query: vi.fn() } as unknown as pg.Pool
}

const originalProjectRoot = process.env.PROJECT_ROOT

describe('runPipeline', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env.PROJECT_ROOT = '/tmp/project'
  })

  afterEach(() => {
    if (originalProjectRoot === undefined) {
      delete process.env.PROJECT_ROOT
      return
    }

    process.env.PROJECT_ROOT = originalProjectRoot
  })

  it('spawns uv detached with the provided pipeline env and unreferences the child', () => {
    const child = mockChild()
    const pool = createPool()
    const pipelineEnv = { PROJECT_ROOT: '/tmp/project', OPENROUTER_API_KEY: 'secret' }

    runPipeline('https://example.com/job', 'job-123', pool, pipelineEnv)

    expect(spawnMock).toHaveBeenCalledOnce()
    expect(spawnMock).toHaveBeenCalledWith(
      'uv',
      ['run', 'python', 'run_agents.py', 'https://example.com/job', '--job-id', 'job-123'],
      {
        cwd: '/tmp/project',
        detached: true,
        stdio: 'ignore',
        env: pipelineEnv,
      },
    )
    expect(child.unref).toHaveBeenCalledOnce()
  })

  it('does not pass --auto-apply by default', () => {
    mockChild()
    const pool = createPool()

    runPipeline('https://example.com/job', 'job-123', pool, {})

    const args = spawnMock.mock.calls[0][1] as string[]
    expect(args).not.toContain('--auto-apply')
  })

  it('appends --auto-apply when the autoApply option is true', () => {
    mockChild()
    const pool = createPool()

    runPipeline('https://example.com/job', 'job-123', pool, {}, { autoApply: true })

    expect(spawnMock).toHaveBeenCalledWith(
      'uv',
      ['run', 'python', 'run_agents.py', 'https://example.com/job', '--job-id', 'job-123', '--auto-apply'],
      expect.objectContaining({ detached: true }),
    )
  })

  it('updates the job and records a pipeline event when the child emits an error', async () => {
    const child = mockChild()
    const pool = createPool()
    const query = vi.mocked(pool.query)
    query.mockResolvedValue({ rows: [] } as never)

    runPipeline('https://example.com/job', 'job-123', pool, {})
    child.emit('error', new Error('uv not found'))
    await Promise.resolve()

    expect(query).toHaveBeenNthCalledWith(
      1,
      `UPDATE jobs SET status = 'error', updated_at = NOW() WHERE job_id = $1`,
      ['job-123'],
    )
    expect(query).toHaveBeenNthCalledWith(
      2,
      `INSERT INTO pipeline_events (job_id, event_type, agent_name, detail, metadata)
         VALUES ($1, 'pipeline_error', 'api', $2, $3)`,
      ['job-123', 'Failed to spawn pipeline worker: uv not found', { reason: 'uv not found' }],
    )
  })

  it('swallows a failed job status update in the error handler', async () => {
    const child = mockChild()
    const pool = createPool()
    const query = vi.mocked(pool.query)
    query.mockRejectedValueOnce(new Error('update failed'))

    runPipeline('https://example.com/job', 'job-123', pool, {})

    expect(() => child.emit('error', new Error('uv not found'))).not.toThrow()
    await Promise.resolve()
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('swallows a failed pipeline event insert in the error handler', async () => {
    const child = mockChild()
    const pool = createPool()
    const query = vi.mocked(pool.query)
    query
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockRejectedValueOnce(new Error('insert failed'))

    runPipeline('https://example.com/job', 'job-123', pool, {})

    expect(() => child.emit('error', new Error('uv not found'))).not.toThrow()
    await Promise.resolve()
    expect(query).toHaveBeenCalledTimes(2)
  })
})
