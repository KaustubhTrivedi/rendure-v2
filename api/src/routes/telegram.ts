import { Hono } from 'hono'
import { httpError, ErrorCode } from '../errors.js'
import { submitJobUrl } from '../job-submission.js'

export type TelegramUpdate = {
  update_id?: number
  message?: {
    text?: string
    chat?: { id?: number | string }
  }
}

/**
 * Telegram webhook route.
 *
 * Expects POST / with a JSON Telegram Update body.
 * Authenticated via X-Telegram-Bot-Api-Secret-Token matching TELEGRAM_WEBHOOK_SECRET.
 * Extracts URLs from message text and submits them to the pipeline.
 */
const telegram = new Hono()

// ── Middleware: config gate ───────────────────────────────────────────────

telegram.use('*', async (c, next) => {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_WEBHOOK_SECRET) {
    return httpError(c, 503, ErrorCode.internal_error, 'Telegram not configured.', {
      detail: 'TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET must be set.',
    })
  }
  await next()
})

// ── Middleware: secret token gate ─────────────────────────────────────────

telegram.use('*', async (c, next) => {
  const provided = c.req.header('X-Telegram-Bot-Api-Secret-Token')
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET

  if (!provided || provided !== expected) {
    return httpError(c, 401, ErrorCode.unauthorized, 'Unauthorized')
  }

  await next()
})

// ── POST / — receive Telegram update ─────────────────────────────────────

telegram.post('/', async (c) => {
  const body: TelegramUpdate | null = await c.req.json().catch(() => null)
  const text = body?.message?.text?.trim()

  // No text at all
  if (!text) {
    return c.json({ text: 'Send me a job posting URL and I\'ll tailor your resume for you.' })
  }

  // /start command
  if (text === '/start') {
    return c.json({ text: 'Send me a job posting URL and I\'ll tailor your resume for you.' })
  }

  // Extract URLs from message text
  const urlPattern = /https?:\/\/[^\s]+/g
  const urls = text.match(urlPattern)

  // Zero or multiple URLs → friendly help, no job created
  if (!urls || urls.length !== 1) {
    return c.json({ text: 'Please send exactly one job posting URL.' })
  }

  const rawUrl = urls[0]

  // Validate the URL is parseable
  try {
    new URL(rawUrl)
  } catch {
    return c.json({ text: 'That doesn\'t look like a valid URL. Please send a valid job posting URL.' })
  }

  // Submit the URL to the pipeline
  const result = await submitJobUrl(rawUrl)

  if (result.statusCode === 202) {
    return c.json(
      { text: `Job submitted! Check status: ${result.body.status_url}` },
      202,
    )
  }

  if (result.statusCode === 409) {
    return c.json({
      text: `This URL was already submitted. Status: ${result.body.status}. Check: ${result.body.status_url}`,
    })
  }

  // 400-level error from submitJobUrl (bad request)
  return c.json({ text: result.title })
})

export default telegram
