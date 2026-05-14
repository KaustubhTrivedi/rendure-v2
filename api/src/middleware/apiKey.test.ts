import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { apiKeyMiddleware, assertApiKeyConfigured } from './apiKey.js'

const ORIGINAL_ENV = process.env.RENDURE_API_KEY

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.RENDURE_API_KEY
  else process.env.RENDURE_API_KEY = ORIGINAL_ENV
})

function makeApp() {
  const app = new Hono()
  app.use('/jobs/*', apiKeyMiddleware())
  app.get('/jobs/list', (c) => c.json({ ok: true }))
  app.get('/', (c) => c.json({ ok: true })) // public
  return app
}

describe('assertApiKeyConfigured', () => {
  it('throws when RENDURE_API_KEY is unset', () => {
    delete process.env.RENDURE_API_KEY
    expect(() => assertApiKeyConfigured()).toThrow(/RENDURE_API_KEY/)
  })

  it('throws when RENDURE_API_KEY is empty', () => {
    process.env.RENDURE_API_KEY = ''
    expect(() => assertApiKeyConfigured()).toThrow(/RENDURE_API_KEY/)
  })

  it('does not throw when RENDURE_API_KEY is set', () => {
    process.env.RENDURE_API_KEY = 'a-key'
    expect(() => assertApiKeyConfigured()).not.toThrow()
  })
})

describe('apiKeyMiddleware', () => {
  beforeEach(() => {
    process.env.RENDURE_API_KEY = 'test-key'
  })

  it('returns 401 with RFC7807 hybrid body when header is missing', async () => {
    const res = await makeApp().request('/jobs/list')
    expect(res.status).toBe(401)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.code).toBe('unauthorized')
    expect(body.error).toBe('Unauthorized')
    expect(body.title).toBe('Unauthorized')
    expect(body.status).toBe(401)
  })

  it('returns 401 when header value is wrong', async () => {
    const res = await makeApp().request('/jobs/list', { headers: { 'X-API-Key': 'wrong-key' } })
    expect(res.status).toBe(401)
  })

  it('returns 401 when header length differs from expected (avoids timingSafeEqual throw)', async () => {
    process.env.RENDURE_API_KEY = 'abc'
    const res = await makeApp().request('/jobs/list', { headers: { 'X-API-Key': 'abcd' } })
    expect(res.status).toBe(401)
  })

  it('passes through when header matches', async () => {
    const res = await makeApp().request('/jobs/list', { headers: { 'X-API-Key': 'test-key' } })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
  })

  it('does not gate public routes (no middleware mounted)', async () => {
    const res = await makeApp().request('/')
    expect(res.status).toBe(200)
  })

  it('header lookup is case-insensitive', async () => {
    const res = await makeApp().request('/jobs/list', { headers: { 'x-api-key': 'test-key' } })
    expect(res.status).toBe(200)
  })
})
