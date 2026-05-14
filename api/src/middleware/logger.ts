import type { MiddlewareHandler } from 'hono'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import pino from 'pino'

const isProd = process.env.NODE_ENV === 'production'

/**
 * Shared pino logger. JSON in production, pino-pretty in development/test.
 * Level controlled by LOG_LEVEL env var (default: info).
 */
export const logger = pino(
  isProd
    ? { level: process.env.LOG_LEVEL ?? 'info' }
    : {
        level: process.env.LOG_LEVEL ?? 'info',
        transport: {
          target: 'pino-pretty',
          options: { singleLine: true, colorize: true },
        },
      },
)

const JOB_ID_RE = /^\/jobs\/([^/]+)/

/**
 * Hono middleware that emits exactly one structured log line per request.
 *
 * Captured fields: request_id, method, path, status, duration_ms, job_id?
 * Excluded: request body, response body, header values (notably X-API-Key).
 */
export function loggerMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const request_id = randomUUID()
    c.set('request_id', request_id)
    const start = performance.now()
    let threw: unknown
    try {
      await next()
    } catch (err) {
      threw = err
    }
    const duration_ms = Math.round(performance.now() - start)
    const path = c.req.path
    const match = path.match(JOB_ID_RE)
    const job_id = match ? match[1] : undefined

    const fields: Record<string, unknown> = {
      request_id,
      method: c.req.method,
      path,
      status: c.res.status,
      duration_ms,
    }
    if (job_id !== undefined) fields.job_id = job_id

    if (threw) {
      fields.error = threw instanceof Error ? threw.message : String(threw)
      logger.error(fields)
      throw threw
    }
    logger.info(fields)
  }
}
