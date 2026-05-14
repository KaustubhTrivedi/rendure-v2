import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('./db.js', () => ({
  pool: {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  },
}))

beforeAll(() => {
  process.env.RENDURE_API_KEY = 'test-key'
})

describe('app', () => {
  it('mounts jobs routes (with API key)', async () => {
    const { app } = await import('./index.js')

    const res = await app.request('/jobs/missing/status', {
      headers: { 'X-API-Key': 'test-key' },
    })

    expect(res.status).toBe(404)
    const body = (await res.json()) as Record<string, unknown>
    // Backward-compat: existing `error` key still present (now via RFC7807 alias).
    expect(body.error).toBe('Job not found.')
  })

  it('GET / returns JSON liveness payload (no API key required)', async () => {
    const { app } = await import('./index.js')

    const res = await app.request('/')

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/application\/json/)
    const body = (await res.json()) as { ok: boolean; version: string }
    expect(body.ok).toBe(true)
    expect(typeof body.version).toBe('string')
    expect(body.version.length).toBeGreaterThan(0)
  })

  it('returns 401 on /jobs/* without X-API-Key', async () => {
    const { app } = await import('./index.js')
    const res = await app.request('/jobs/anything/status')
    expect(res.status).toBe(401)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.code).toBe('unauthorized')
    expect(body.error).toBe('Unauthorized')
  })

  it('returns 401 on /profile without X-API-Key', async () => {
    const { app } = await import('./index.js')
    const res = await app.request('/profile')
    expect(res.status).toBe(401)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.code).toBe('unauthorized')
  })

  it('returns 401 on /jobs/* with wrong X-API-Key', async () => {
    const { app } = await import('./index.js')
    const res = await app.request('/jobs/anything/status', {
      headers: { 'X-API-Key': 'wrong' },
    })
    expect(res.status).toBe(401)
  })
})
