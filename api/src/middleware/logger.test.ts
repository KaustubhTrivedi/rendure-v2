import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

// Mock pino BEFORE importing the middleware module so the spies are wired in.
const infoSpy = vi.fn()
const errorSpy = vi.fn()

vi.mock('pino', () => {
  const factory = () => ({
    info: infoSpy,
    error: errorSpy,
    level: 'info',
  })
  // pino has both default and named export shapes; cover both.
  return { default: factory, pino: factory }
})

beforeEach(() => {
  infoSpy.mockClear()
  errorSpy.mockClear()
})

async function makeApp() {
  const { loggerMiddleware } = await import('./logger.js')
  const app = new Hono()
  app.use('*', loggerMiddleware())
  app.get('/profile', (c) => c.json({ ok: true }))
  app.get('/jobs/:id/status', (c) => c.json({ id: c.req.param('id'), status: 'ok' }))
  app.get('/jobs/:id', (c) => c.json({ id: c.req.param('id') }))
  app.get('/boom', () => {
    throw new Error('kaboom')
  })
  return app
}

describe('loggerMiddleware', () => {
  it('logs method, path, status, duration_ms for a 200 response', async () => {
    const app = await makeApp()
    await app.request('/profile')
    expect(infoSpy).toHaveBeenCalledTimes(1)
    const logged = infoSpy.mock.calls[0][0]
    expect(logged.method).toBe('GET')
    expect(logged.path).toBe('/profile')
    expect(logged.status).toBe(200)
    expect(typeof logged.duration_ms).toBe('number')
    expect(typeof logged.request_id).toBe('string')
    expect(logged.request_id.length).toBeGreaterThan(0)
  })

  it('extracts job_id for /jobs/:id/status', async () => {
    const app = await makeApp()
    await app.request('/jobs/abc-123/status')
    const logged = infoSpy.mock.calls[0][0]
    expect(logged.job_id).toBe('abc-123')
  })

  it('extracts job_id for /jobs/:id', async () => {
    const app = await makeApp()
    await app.request('/jobs/xyz')
    const logged = infoSpy.mock.calls[0][0]
    expect(logged.job_id).toBe('xyz')
  })

  it('does not include job_id for non-job routes', async () => {
    const app = await makeApp()
    await app.request('/profile')
    const logged = infoSpy.mock.calls[0][0]
    expect(logged.job_id).toBeUndefined()
  })

  it('does not log X-API-Key header value or request body', async () => {
    const app = await makeApp()
    await app.request('/profile', {
      headers: { 'X-API-Key': 'super-secret-key' },
    })
    const logged = JSON.stringify(infoSpy.mock.calls[0][0])
    expect(logged).not.toContain('super-secret-key')
    expect(logged).not.toContain('X-API-Key')
    expect(logged).not.toContain('x-api-key')
  })

  it('generates distinct request_ids per request', async () => {
    const app = await makeApp()
    await app.request('/profile')
    await app.request('/profile')
    const id1 = infoSpy.mock.calls[0][0].request_id
    const id2 = infoSpy.mock.calls[1][0].request_id
    expect(id1).not.toBe(id2)
  })
})
