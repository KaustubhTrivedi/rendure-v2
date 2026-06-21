import { beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../index.js'
import { pool } from '../db.js'
import * as executionAdapter from '../execution-adapter.js'

vi.mock('../db.js', () => ({ pool: { query: vi.fn() } }))
vi.mock('../execution-adapter.js', () => ({
  runPipeline: vi.fn(),
  runDiscovery: vi.fn(),
}))
vi.mock('node:child_process', () => ({ spawn: vi.fn() }))

const query = vi.mocked(pool.query)
const runPipelineMock = vi.mocked(executionAdapter.runPipeline)
const runDiscoveryMock = vi.mocked(executionAdapter.runDiscovery)

const API_KEY = 'test-rendure-key'
const AUTH = { 'X-API-Key': API_KEY }

function makeReq(method: string, path: string, body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...AUTH },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

const PREFS_ROW = {
  target_roles: ['Software Engineer'],
  locations: ['Remote'],
  excluded_companies: [],
  min_seniority: null,
  keywords: ['Python'],
  greenhouse_companies: ['stripe'],
  lever_companies: [],
  ashby_companies: [],
  indeed_queries: [],
  workday_urls: [],
  career_page_urls: [],
  updated_at: new Date().toISOString(),
}

const DJ_ROW = {
  id: 'aaaaaaaa-0000-0000-0000-000000000001',
  job_url: 'https://jobs.greenhouse.io/stripe/jobs/1001',
  title: 'Senior Backend Engineer',
  company: 'stripe',
  location: 'Remote',
  platform: 'greenhouse',
  raw_snippet: 'Build distributed systems…',
  relevance_score: '0.800',
  status: 'pending_review',
  job_id: null,
  discovered_at: new Date().toISOString(),
  reviewed_at: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.RENDURE_API_KEY = API_KEY
})

// ── GET /discovery/preferences ─────────────────────────────────────────────

describe('GET /discovery/preferences', () => {
  it('returns the preferences row', async () => {
    query.mockResolvedValueOnce({ rows: [PREFS_ROW] } as any)

    const res = await app.fetch(makeReq('GET', '/discovery/preferences'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.greenhouse_companies).toEqual(['stripe'])
  })

  it('returns empty object when no row exists', async () => {
    query.mockResolvedValueOnce({ rows: [] } as any)

    const res = await app.fetch(makeReq('GET', '/discovery/preferences'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({})
  })

  it('returns 401 without api key', async () => {
    const res = await app.fetch(new Request('http://localhost/discovery/preferences'))
    expect(res.status).toBe(401)
  })
})

// ── PUT /discovery/preferences ─────────────────────────────────────────────

describe('PUT /discovery/preferences', () => {
  it('accepts valid preferences and returns updated row', async () => {
    query
      .mockResolvedValueOnce({ rows: [] } as any)  // upsert
      .mockResolvedValueOnce({ rows: [PREFS_ROW] } as any)  // select after upsert

    const res = await app.fetch(
      makeReq('PUT', '/discovery/preferences', {
        greenhouse_companies: ['stripe', 'shopify'],
        target_roles: ['Backend Engineer'],
      }),
    )
    expect(res.status).toBe(200)
    expect(query).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT'), expect.any(Array))
  })

  it('returns 422 for an invalid seniority value', async () => {
    const res = await app.fetch(
      makeReq('PUT', '/discovery/preferences', { min_seniority: 'intern' }),
    )
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.fields).toBeDefined()
  })

  it('returns 422 for an invalid indeed_query entry', async () => {
    const res = await app.fetch(
      makeReq('PUT', '/discovery/preferences', {
        indeed_queries: [{ missing_q_key: 'whoops' }],
      }),
    )
    expect(res.status).toBe(422)
  })

  it('returns 400 for non-object body', async () => {
    const res = await app.fetch(
      new Request('http://localhost/discovery/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'text/plain', ...AUTH },
        body: 'not json',
      }),
    )
    expect(res.status).toBe(400)
  })

  it('returns 422 for unknown keys (.strict())', async () => {
    const res = await app.fetch(
      makeReq('PUT', '/discovery/preferences', { totally_unknown_field: true }),
    )
    expect(res.status).toBe(422)
  })
})

// ── GET /discovery/jobs ────────────────────────────────────────────────────

describe('GET /discovery/jobs', () => {
  it('returns paginated list of pending_review jobs', async () => {
    query
      .mockResolvedValueOnce({ rows: [DJ_ROW] } as any)
      .mockResolvedValueOnce({ rows: [{ total: 1 }] } as any)

    const res = await app.fetch(makeReq('GET', '/discovery/jobs'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.jobs).toHaveLength(1)
    expect(body.total).toBe(1)
    expect(body.jobs[0].title).toBe('Senior Backend Engineer')
  })

  it('normalises relevance_score to a number', async () => {
    query
      .mockResolvedValueOnce({ rows: [DJ_ROW] } as any)
      .mockResolvedValueOnce({ rows: [{ total: 1 }] } as any)

    const res = await app.fetch(makeReq('GET', '/discovery/jobs'))
    const body = await res.json()
    expect(typeof body.jobs[0].relevance_score).toBe('number')
    expect(body.jobs[0].relevance_score).toBeCloseTo(0.8)
  })

  it('accepts ?status=all', async () => {
    query
      .mockResolvedValueOnce({ rows: [] } as any)
      .mockResolvedValueOnce({ rows: [{ total: 0 }] } as any)

    const res = await app.fetch(makeReq('GET', '/discovery/jobs?status=all'))
    expect(res.status).toBe(200)
  })

  it('returns 400 for invalid status filter', async () => {
    const res = await app.fetch(makeReq('GET', '/discovery/jobs?status=nonsense'))
    expect(res.status).toBe(400)
  })

  it('caps limit at 200', async () => {
    query
      .mockResolvedValueOnce({ rows: [] } as any)
      .mockResolvedValueOnce({ rows: [{ total: 0 }] } as any)

    const res = await app.fetch(makeReq('GET', '/discovery/jobs?limit=9999'))
    expect(res.status).toBe(200)
    // Verify the query was called with limit 200, not 9999
    const firstCall = query.mock.calls[0]
    expect(firstCall[1]).toContain(200)
  })
})

// ── GET /discovery/jobs/:id ────────────────────────────────────────────────

describe('GET /discovery/jobs/:id', () => {
  it('returns the job when found', async () => {
    query.mockResolvedValueOnce({ rows: [DJ_ROW] } as any)

    const res = await app.fetch(makeReq('GET', `/discovery/jobs/${DJ_ROW.id}`))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe(DJ_ROW.id)
  })

  it('returns 404 when not found', async () => {
    query.mockResolvedValueOnce({ rows: [] } as any)

    const res = await app.fetch(makeReq('GET', '/discovery/jobs/does-not-exist'))
    expect(res.status).toBe(404)
  })
})

// ── POST /discovery/jobs/:id/approve ──────────────────────────────────────

describe('POST /discovery/jobs/:id/approve', () => {
  it('returns job_id and status_url on success', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ ...DJ_ROW, status: 'pending_review' }] } as any) // select dj
      .mockResolvedValueOnce({ rows: [{ job_id: 'new-job-uuid' }] } as any)              // insert jobs
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as any)                           // update dj
      .mockResolvedValueOnce({ rows: [{}] } as any)                                       // profile

    const res = await app.fetch(makeReq('POST', `/discovery/jobs/${DJ_ROW.id}/approve`))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.job_id).toBe('new-job-uuid')
    expect(body.status_url).toBe('/jobs/new-job-uuid/status')
  })

  it('spawns the pipeline', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ ...DJ_ROW, status: 'pending_review' }] } as any)
      .mockResolvedValueOnce({ rows: [{ job_id: 'new-job-uuid' }] } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [{}] } as any)

    await app.fetch(makeReq('POST', `/discovery/jobs/${DJ_ROW.id}/approve`))
    expect(runPipelineMock).toHaveBeenCalledOnce()
  })

  it('returns 404 when discovered job not found', async () => {
    query.mockResolvedValueOnce({ rows: [] } as any)

    const res = await app.fetch(makeReq('POST', '/discovery/jobs/bad-id/approve'))
    expect(res.status).toBe(404)
  })

  it('returns 409 when already queued', async () => {
    query.mockResolvedValueOnce({
      rows: [{ ...DJ_ROW, status: 'queued', job_id: 'existing-uuid' }],
    } as any)

    const res = await app.fetch(makeReq('POST', `/discovery/jobs/${DJ_ROW.id}/approve`))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.job_id).toBe('existing-uuid')
  })
})

// ── POST /discovery/jobs/:id/reject ───────────────────────────────────────

describe('POST /discovery/jobs/:id/reject', () => {
  it('marks the job as rejected', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: DJ_ROW.id }], rowCount: 1 } as any)

    const res = await app.fetch(makeReq('POST', `/discovery/jobs/${DJ_ROW.id}/reject`))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('rejected')
  })

  it('returns 404 when not found', async () => {
    query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)  // update returns nothing
      .mockResolvedValueOnce({ rows: [] } as any)                // existence check

    const res = await app.fetch(makeReq('POST', '/discovery/jobs/bad-id/reject'))
    expect(res.status).toBe(404)
  })

  it('returns 409 when job is already queued', async () => {
    query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({ rows: [{ status: 'queued' }] } as any)

    const res = await app.fetch(makeReq('POST', `/discovery/jobs/${DJ_ROW.id}/reject`))
    expect(res.status).toBe(409)
  })
})

// ── DELETE /discovery/jobs/:id ────────────────────────────────────────────

describe('DELETE /discovery/jobs/:id', () => {
  it('deletes a pending_review job and returns 204', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ status: 'pending_review' }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any)

    const res = await app.fetch(makeReq('DELETE', `/discovery/jobs/${DJ_ROW.id}`))
    expect(res.status).toBe(204)
  })

  it('deletes a rejected job and returns 204', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ status: 'rejected' }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any)

    const res = await app.fetch(makeReq('DELETE', `/discovery/jobs/${DJ_ROW.id}`))
    expect(res.status).toBe(204)
  })

  it('returns 404 when job not found', async () => {
    query.mockResolvedValueOnce({ rows: [] } as any)

    const res = await app.fetch(makeReq('DELETE', '/discovery/jobs/bad-id'))
    expect(res.status).toBe(404)
  })

  it('returns 409 when job is queued in the pipeline', async () => {
    query.mockResolvedValueOnce({ rows: [{ status: 'queued' }] } as any)

    const res = await app.fetch(makeReq('DELETE', `/discovery/jobs/${DJ_ROW.id}`))
    expect(res.status).toBe(409)
  })
})

// ── POST /discovery/run ───────────────────────────────────────────────────

describe('POST /discovery/run', () => {
  it('returns 202 immediately', async () => {
    const res = await app.fetch(makeReq('POST', '/discovery/run'))
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.message).toContain('started')
  })

  it('calls runDiscovery', async () => {
    await app.fetch(makeReq('POST', '/discovery/run'))
    expect(runDiscoveryMock).toHaveBeenCalledOnce()
  })
})
