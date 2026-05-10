import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import jobs from './jobs.js'
import { pool } from '../db.js'

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

vi.mock('../db.js', () => ({
  pool: {
    query: vi.fn(),
  },
}))

const query = vi.mocked(pool.query)
const spawnMock = vi.mocked(spawn)

function mockChild() {
  const child = new EventEmitter() as EventEmitter & { unref: () => void }
  child.unref = vi.fn()
  spawnMock.mockReturnValue(child as ReturnType<typeof spawn>)
  return child
}

describe('jobs routes', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockChild()
  })

  it('creates a job, spawns the worker, and returns a polling URL', async () => {
    query
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ job_id: 'job-123' }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)

    const res = await jobs.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/job' }),
    })

    expect(res.status).toBe(202)
    await expect(res.json()).resolves.toEqual({
      job_id: 'job-123',
      status: 'new',
      status_url: '/jobs/job-123/status',
    })
    expect(query).toHaveBeenNthCalledWith(
      2,
      `INSERT INTO jobs (job_url, status) VALUES ($1, 'new') RETURNING job_id`,
      ['https://example.com/job'],
    )
    expect(spawnMock).toHaveBeenCalledWith(
      'uv',
      ['run', 'python', 'run_agents.py', 'https://example.com/job', '--job-id', 'job-123'],
      expect.objectContaining({ detached: true, stdio: 'ignore' }),
    )
  })

  it('returns 409 with a polling URL for duplicate URLs', async () => {
    query.mockResolvedValueOnce({ rows: [{ job_id: 'job-123', status: 'tailoring' }] } as never)

    const res = await jobs.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/job' }),
    })

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({
      error: 'This URL has already been submitted.',
      job_id: 'job-123',
      status: 'tailoring',
      status_url: '/jobs/job-123/status',
    })
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('rejects invalid URLs', async () => {
    const res = await jobs.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'not-a-url' }),
    })

    expect(res.status).toBe(400)
    expect(query).not.toHaveBeenCalled()
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('returns compact job status for polling', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          job_id: 'job-123',
          status: 'qa_review',
          qa_score: '0.875',
          iteration_count: 2,
          company_name: 'Acme',
          role_title: 'Engineer',
          active_resume_id: 'resume-123',
          updated_at: '2026-05-09T00:00:00.000Z',
        },
      ],
    } as never)

    const res = await jobs.request('/job-123/status')

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      job_id: 'job-123',
      status: 'qa_review',
      qa_score: '0.875',
      iteration_count: 2,
      company_name: 'Acme',
      role_title: 'Engineer',
      active_resume_id: 'resume-123',
      updated_at: '2026-05-09T00:00:00.000Z',
    })
  })

  it('returns 404 when polling a missing job', async () => {
    query.mockResolvedValueOnce({ rows: [] } as never)

    const res = await jobs.request('/missing/status')

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ error: 'Job not found.' })
  })
})
