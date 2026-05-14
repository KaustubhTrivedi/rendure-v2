import type { MiddlewareHandler } from 'hono'
import { timingSafeEqual } from 'node:crypto'
import { httpError } from '../errors.js'

/**
 * Verifies that RENDURE_API_KEY is set at startup. The server fails fast if it
 * isn't — silent auth bypass is worse than a noisy crash.
 */
export function assertApiKeyConfigured(): void {
  const v = process.env.RENDURE_API_KEY
  if (v === undefined || v === '') {
    throw new Error(
      'RENDURE_API_KEY is not set. Set it in .env (e.g. RENDURE_API_KEY=...) and restart the server.',
    )
  }
}

/**
 * Hono middleware that gates a route group behind the shared API key.
 *
 * - Reads `X-API-Key` (case-insensitive via Hono's header lookup).
 * - Performs a length pre-check, then `crypto.timingSafeEqual` for constant-time
 *   comparison. Both branches return 401 with the RFC7807 hybrid body.
 * - Mount per-route-group: `app.use('/jobs/*', apiKeyMiddleware())`. The
 *   healthcheck route is left ungated so Docker can liveness-check the server.
 */
export function apiKeyMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const expected = process.env.RENDURE_API_KEY ?? ''
    const provided = c.req.header('x-api-key')

    if (!provided) {
      return httpError(c, 401, 'unauthorized', 'Unauthorized', {
        detail: 'Missing X-API-Key header.',
      })
    }

    const expectedBuf = Buffer.from(expected)
    const providedBuf = Buffer.from(provided)

    if (expectedBuf.length !== providedBuf.length) {
      return httpError(c, 401, 'unauthorized', 'Unauthorized')
    }

    if (!timingSafeEqual(expectedBuf, providedBuf)) {
      return httpError(c, 401, 'unauthorized', 'Unauthorized')
    }

    await next()
  }
}
