import { beforeEach, describe, expect, it, vi } from 'vitest'
import profile, { patchProfileSchema } from './profile.js'
import { pool } from '../db.js'

vi.mock('../db.js', () => ({
  pool: { query: vi.fn() },
}))

const query = vi.mocked(pool.query)

beforeEach(() => {
  vi.resetAllMocks()
})

const SAMPLE_ROW = {
  display_name: 'Alice',
  api_key_configured: false,
  qa_threshold: null,
  max_iterations: null,
  preferred_model: null,
  target_seniority: null,
  highlight_skills: null,
  preferred_industries: null,
  tailor_style_notes: null,
  notify_email: null,
  notify_webhook_url: null,
  notify_telegram_chat_id: null,
  created_at: '2026-05-13T00:00:00.000Z',
  updated_at: '2026-05-13T00:00:00.000Z',
}

describe('patchProfileSchema', () => {
  it('rejects unknown seniority', () => {
    const r = patchProfileSchema.safeParse({ target_seniority: 'wizard' })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues[0].path).toEqual(['target_seniority'])
    }
  })

  it('rejects qa_threshold > 1', () => {
    const r = patchProfileSchema.safeParse({ qa_threshold: 1.5 })
    expect(r.success).toBe(false)
  })

  it('rejects negative max_iterations', () => {
    const r = patchProfileSchema.safeParse({ max_iterations: -1 })
    expect(r.success).toBe(false)
  })

  it('rejects malformed notify_webhook_url', () => {
    const r = patchProfileSchema.safeParse({ notify_webhook_url: 'not-a-url' })
    expect(r.success).toBe(false)
  })

  it('rejects unknown keys (strict)', () => {
    const r = patchProfileSchema.safeParse({ foo: 'bar' })
    expect(r.success).toBe(false)
  })

  it('accepts an empty object', () => {
    const r = patchProfileSchema.safeParse({})
    expect(r.success).toBe(true)
  })

  it('accepts notify_telegram_chat_id: null (clear)', () => {
    const r = patchProfileSchema.safeParse({ notify_telegram_chat_id: null })
    expect(r.success).toBe(true)
  })

  it('accepts a full valid patch', () => {
    const r = patchProfileSchema.safeParse({
      display_name: 'Alice',
      target_seniority: 'senior',
      highlight_skills: ['Python', 'Kubernetes'],
      qa_threshold: 0.9,
      max_iterations: 4,
      preferred_model: 'anthropic/claude-3.5-sonnet',
      notify_telegram_chat_id: '12345',
      notify_webhook_url: 'https://example.com/hook',
    })
    expect(r.success).toBe(true)
  })
})

describe('PATCH /profile', () => {
  it('returns 400 with code=bad_request when body is malformed JSON', async () => {
    const res = await profile.request('/', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.code).toBe('bad_request')
    expect(body.error).toBeDefined()
    expect(body.title).toBeDefined()
    expect(body.error).toBe(body.title)
  })

  it('returns 400 with code=validation_failed and fields[] for invalid seniority', async () => {
    const res = await profile.request('/', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target_seniority: 'wizard' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code: string; fields: Array<{ path: string }> }
    expect(body.code).toBe('validation_failed')
    expect(Array.isArray(body.fields)).toBe(true)
    expect(body.fields.some((f) => f.path === 'target_seniority')).toBe(true)
  })

  it('returns 404 with code=profile_not_found when no row exists (empty patch path)', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)

    const res = await profile.request('/', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(404)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.code).toBe('profile_not_found')
  })

  it('returns 404 with code=profile_not_found when UPDATE matches no row', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)

    const res = await profile.request('/', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ display_name: 'Alice' }),
    })
    expect(res.status).toBe(404)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.code).toBe('profile_not_found')
  })

  it('updates only provided fields and returns the updated row', async () => {
    query.mockResolvedValueOnce({
      rows: [{ ...SAMPLE_ROW, display_name: 'Bob' }],
      rowCount: 1,
    } as never)

    const res = await profile.request('/', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ display_name: 'Bob' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { display_name: string }
    expect(body.display_name).toBe('Bob')

    // Verify the UPDATE statement's SET clause only touched `display_name`.
    const call = query.mock.calls[0]
    const sql = call[0] as string
    const setClause = sql.slice(sql.indexOf('SET '), sql.indexOf('WHERE'))
    expect(setClause).toContain('"display_name" = $1')
    expect(setClause).not.toContain('qa_threshold')
    expect(setClause).not.toContain('notify_telegram_chat_id')
    expect(call[1]).toEqual(['Bob'])
  })

  it('partial update of notify_telegram_chat_id', async () => {
    query.mockResolvedValueOnce({
      rows: [{ ...SAMPLE_ROW, notify_telegram_chat_id: '12345' }],
      rowCount: 1,
    } as never)

    const res = await profile.request('/', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ notify_telegram_chat_id: '12345' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { notify_telegram_chat_id: string }
    expect(body.notify_telegram_chat_id).toBe('12345')

    const call = query.mock.calls[0]
    expect(call[0]).toContain('"notify_telegram_chat_id" = $1')
    expect(call[1]).toEqual(['12345'])
  })

  it('null clears notify_telegram_chat_id', async () => {
    query.mockResolvedValueOnce({
      rows: [{ ...SAMPLE_ROW, notify_telegram_chat_id: null }],
      rowCount: 1,
    } as never)

    const res = await profile.request('/', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ notify_telegram_chat_id: null }),
    })
    expect(res.status).toBe(200)
    const call = query.mock.calls[0]
    expect(call[1]).toEqual([null])
  })

  it('rejects unknown fields (strict)', async () => {
    const res = await profile.request('/', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ unknown_field: 'x' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.code).toBe('validation_failed')
  })
})

describe('GET /profile error shape', () => {
  it('returns hybrid RFC7807 shape on 404', async () => {
    query.mockResolvedValueOnce({ rows: [] } as never)
    const res = await profile.request('/')
    expect(res.status).toBe(404)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.code).toBe('profile_not_found')
    expect(body.error).toBe(body.title)
    expect(body.status).toBe(404)
    expect(body.instance).toBe('/')
  })
})
