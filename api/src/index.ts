import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import jobs from './routes/jobs.js'
import profile from './routes/profile.js'
import { loggerMiddleware } from './middleware/logger.js'
import { apiKeyMiddleware, assertApiKeyConfigured } from './middleware/apiKey.js'

const pkg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf-8'),
) as { version: string }

// Fail fast if the API key isn't configured — silent auth bypass is worse than a crash.
// Skip in test mode; tests set the env per-suite.
if (process.env.NODE_ENV !== 'test') {
  try {
    assertApiKeyConfigured()
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  }
}

export const app = new Hono()

// Global request logging — also covers the healthcheck.
app.use('*', loggerMiddleware())

// Gate authenticated route groups behind the API key. GET / stays public.
app.use('/profile/*', apiKeyMiddleware())
app.use('/jobs/*', apiKeyMiddleware())

app.get('/', (c) => {
  return c.json({ ok: true, version: pkg.version })
})

app.route('/profile', profile)
app.route('/jobs', jobs)

if (process.env.NODE_ENV !== 'test') {
  serve({
    fetch: app.fetch,
    port: 3002
  }, (info) => {
    console.log(`Server is running on http://localhost:${info.port}`)
  })
}
