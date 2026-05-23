/** API server entry point — Hono on Node.js. */

import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import jobs from './routes/jobs.js'
import profile from './routes/profile.js'
import telegram from './routes/telegram.js'
import { logger, loggerMiddleware } from './middleware/logger.js'
import { apiKeyMiddleware, assertApiKeyConfigured } from './middleware/apiKey.js'
import { checkRenderCvAvailable } from './resume-render.js'
import { startTelegramTerminalNotifier } from './telegram-notifier.js'

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

// CORS — allow frontend dev server and any configured origin
app.use('*', cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:5174', 'http://127.0.0.1:5174'],
  credentials: true,
}))

// Global request logging — also covers the healthcheck.
app.use('*', loggerMiddleware())

// Gate authenticated route groups behind the API key. GET / stays public.
app.use('/profile/*', apiKeyMiddleware())
app.use('/jobs/*', apiKeyMiddleware())

app.get('/', (c) => {
  return c.json({ ok: true, version: pkg.version })
})

app.route('/telegram', telegram)
app.route('/profile', profile)
app.route('/jobs', jobs)

if (process.env.NODE_ENV !== 'test') {
  void checkRenderCvAvailable()
    .then((available) => {
      if (!available) {
        logger.warn({ dependency: 'rendercv' }, 'RenderCV CLI unavailable; PDF resume downloads will return 503.')
      }
    })
    .catch(() => {
      logger.warn({ dependency: 'rendercv' }, 'RenderCV CLI unavailable; PDF resume downloads will return 503.')
    })

  void startTelegramTerminalNotifier()
    .then((notifier) => {
      logger.info({ feature: 'telegram-terminal-notifier' }, 'Telegram terminal notifications active.')
      // Keep the notifier alive for the lifetime of the process; close on shutdown.
      process.once('SIGTERM', () => { void notifier.close() })
      process.once('SIGINT', () => { void notifier.close() })
    })
    .catch(() => {
      logger.warn({ feature: 'telegram-terminal-notifier' }, 'Telegram terminal notifications unavailable due to startup error.')
    })

  serve({
    fetch: app.fetch,
    port: 3002
  }, (info) => {
    console.log(`Server is running on http://localhost:${info.port}`)
  })
}
