import { describe, expect, it } from 'vitest'
import { Hono, type Context } from 'hono'
import { httpError, ErrorCode } from './errors.js'

function makeApp(handler: (c: Context) => Response | Promise<Response>) {
  const app = new Hono()
  app.get('/test', handler)
  return app
}

describe('httpError', () => {
  it('returns RFC7807 hybrid body with error alias for title', async () => {
    const app = makeApp((c) => httpError(c, 401, 'unauthorized', 'Unauthorized'))
    const res = await app.request('/test')
    expect(res.status).toBe(401)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.title).toBe('Unauthorized')
    expect(body.error).toBe('Unauthorized')
    expect(body.status).toBe(401)
    expect(body.code).toBe('unauthorized')
    expect(body.type).toBe('about:blank')
  })

  it('defaults instance to request path', async () => {
    const app = makeApp((c) => httpError(c, 404, 'not_found', 'Not found'))
    const res = await app.request('/test')
    const body = (await res.json()) as Record<string, unknown>
    expect(body.instance).toBe('/test')
  })

  it('passes fields through when provided', async () => {
    const app = makeApp((c) =>
      httpError(c, 400, 'validation_failed', 'Validation failed', {
        fields: [{ path: 'qa_threshold', message: 'Must be ≤ 1' }],
      }),
    )
    const res = await app.request('/test')
    const body = (await res.json()) as Record<string, unknown>
    expect(body.fields).toEqual([{ path: 'qa_threshold', message: 'Must be ≤ 1' }])
  })

  it('allows overriding type', async () => {
    const app = makeApp((c) =>
      httpError(c, 400, 'validation_failed', 'Validation failed', { type: '/errors/validation' }),
    )
    const res = await app.request('/test')
    const body = (await res.json()) as Record<string, unknown>
    expect(body.type).toBe('/errors/validation')
  })

  it('includes detail when provided', async () => {
    const app = makeApp((c) =>
      httpError(c, 404, 'profile_not_found', 'Profile not found', { detail: 'Create one with POST /profile first.' }),
    )
    const res = await app.request('/test')
    const body = (await res.json()) as Record<string, unknown>
    expect(body.detail).toBe('Create one with POST /profile first.')
  })

  it('ErrorCode exposes all expected codes', () => {
    expect(ErrorCode.unauthorized).toBe('unauthorized')
    expect(ErrorCode.not_found).toBe('not_found')
    expect(ErrorCode.profile_not_found).toBe('profile_not_found')
    expect(ErrorCode.validation_failed).toBe('validation_failed')
    expect(ErrorCode.internal_error).toBe('internal_error')
    expect(ErrorCode.bad_request).toBe('bad_request')
    expect(ErrorCode.conflict).toBe('conflict')
  })
})
