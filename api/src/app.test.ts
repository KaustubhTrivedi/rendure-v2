import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('./db.js', () => ({
  pool: {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  },
}))

vi.mock('./job-submission.js', () => ({
  submitJobUrl: vi.fn(),
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

  it('POST /telegram does not require X-API-Key (uses Telegram secret)', async () => {
    const { submitJobUrl } = await import('./job-submission.js')
    vi.mocked(submitJobUrl).mockResolvedValue({
      statusCode: 202,
      body: { job_id: 'job-123', status: 'new', status_url: '/jobs/job-123/status' },
    })

    // Set env vars for the telegram route
    process.env.TELEGRAM_BOT_TOKEN = 'bot:token'
    process.env.TELEGRAM_WEBHOOK_SECRET = 'webhook-secret'

    const { app } = await import('./index.js')
    const res = await app.request('/telegram', {
      method: 'POST',
      headers: { 'X-Telegram-Bot-Api-Secret-Token': 'webhook-secret' },
      body: JSON.stringify({ message: { text: 'https://example.com/job', chat: { id: 123 } } }),
    })

    expect(res.status).not.toBe(401)
    delete process.env.TELEGRAM_BOT_TOKEN
    delete process.env.TELEGRAM_WEBHOOK_SECRET
  })

  it('POST /telegram without Telegram secret returns 401', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'bot:token'
    process.env.TELEGRAM_WEBHOOK_SECRET = 'webhook-secret'

    const { app } = await import('./index.js')
    const res = await app.request('/telegram', {
      method: 'POST',
      body: JSON.stringify({ message: { text: 'hello', chat: { id: 123 } } }),
    })

    expect(res.status).toBe(401)
    delete process.env.TELEGRAM_BOT_TOKEN
    delete process.env.TELEGRAM_WEBHOOK_SECRET
  })

  it('/jobs/* and /profile/* still return 401 without X-API-Key when telegram route is mounted', async () => {
    const { app } = await import('./index.js')

    const jobsRes = await app.request('/jobs/anything/status')
    expect(jobsRes.status).toBe(401)

    const profileRes = await app.request('/profile')
    expect(profileRes.status).toBe(401)
  })
})
