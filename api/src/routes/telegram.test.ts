import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import telegram from './telegram.js'
import { submitJobUrl } from '../job-submission.js'

vi.mock('../job-submission.js', () => ({
  submitJobUrl: vi.fn(),
}))

const mockSubmitJobUrl = vi.mocked(submitJobUrl)

const DEFAULT_HEADERS = {
  'X-Telegram-Bot-Api-Secret-Token': 'webhook-secret',
}

function makeBody(text: string, chatId: number | string = 123) {
  return JSON.stringify({ message: { text, chat: { id: chatId } } })
}

describe('Telegram webhook — config/secret gate', () => {
  beforeEach(() => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'bot:token')
    vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', 'webhook-secret')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetAllMocks()
  })

  it('returns 503 problem JSON when TELEGRAM_BOT_TOKEN is missing', async () => {
    process.env.TELEGRAM_BOT_TOKEN = ''
    const res = await telegram.request('/', { method: 'POST' })
    expect(res.status).toBe(503)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.code).toBe('internal_error')
    expect(body.status).toBe(503)
  })

  it('returns 503 problem JSON with stable code/detail when TELEGRAM_WEBHOOK_SECRET is missing', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = ''
    const res = await telegram.request('/', { method: 'POST' })
    expect(res.status).toBe(503)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.code).toBe('internal_error')
    expect(body.status).toBe(503)
  })

  it('returns 401 problem JSON when X-Telegram-Bot-Api-Secret-Token is missing', async () => {
    const res = await telegram.request('/', {
      method: 'POST',
      body: makeBody('https://example.com/job'),
    })
    expect(res.status).toBe(401)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.code).toBe('unauthorized')
    expect(mockSubmitJobUrl).not.toHaveBeenCalled()
  })

  it('returns 401 problem JSON when X-Telegram-Bot-Api-Secret-Token is wrong', async () => {
    const res = await telegram.request('/', {
      method: 'POST',
      headers: { 'X-Telegram-Bot-Api-Secret-Token': 'wrong-secret' },
      body: makeBody('https://example.com/job'),
    })
    expect(res.status).toBe(401)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.code).toBe('unauthorized')
    expect(mockSubmitJobUrl).not.toHaveBeenCalled()
  })

  it('exact header match proceeds without requiring X-API-Key', async () => {
    mockSubmitJobUrl.mockResolvedValue({
      statusCode: 202,
      body: { job_id: 'job-123', status: 'new', status_url: '/jobs/job-123/status' },
    })
    const res = await telegram.request('/', {
      method: 'POST',
      headers: DEFAULT_HEADERS,
      body: makeBody('https://example.com/job'),
    })
    // Not 401 means it passed the Telegram secret gate
    expect(res.status).not.toBe(401)
    expect(mockSubmitJobUrl).toHaveBeenCalled()
  })
})

describe('Telegram webhook — URL handling', () => {
  beforeEach(() => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'bot:token')
    vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', 'webhook-secret')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetAllMocks()
  })

  it('/start text returns 200 JSON with friendly help text', async () => {
    const res = await telegram.request('/', {
      method: 'POST',
      headers: DEFAULT_HEADERS,
      body: makeBody('/start'),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.text).toBeTruthy()
    expect(typeof body.text).toBe('string')
    expect(mockSubmitJobUrl).not.toHaveBeenCalled()
  })

  it('text with no valid URL returns 200 JSON with friendly help', async () => {
    const res = await telegram.request('/', {
      method: 'POST',
      headers: DEFAULT_HEADERS,
      body: makeBody('how does this work?'),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.text).toBeTruthy()
    expect(typeof body.text).toBe('string')
    expect(mockSubmitJobUrl).not.toHaveBeenCalled()
  })

  it('exactly one valid URL calls submitJobUrl(url) and maps new-job to 202', async () => {
    mockSubmitJobUrl.mockResolvedValue({
      statusCode: 202,
      body: { job_id: 'job-123', status: 'new', status_url: '/jobs/job-123/status' },
    })
    const res = await telegram.request('/', {
      method: 'POST',
      headers: DEFAULT_HEADERS,
      body: makeBody('https://example.com/job'),
    })
    expect(res.status).toBe(202)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.text).toBeTruthy()
    expect(mockSubmitJobUrl).toHaveBeenCalledWith('https://example.com/job')
  })

  it('duplicate result from submitJobUrl returns existing job/status', async () => {
    mockSubmitJobUrl.mockResolvedValue({
      statusCode: 409,
      body: {
        error: 'This URL has already been submitted.',
        job_id: 'job-123',
        status: 'tailoring',
        status_url: '/jobs/job-123/status',
      },
    })
    const res = await telegram.request('/', {
      method: 'POST',
      headers: DEFAULT_HEADERS,
      body: makeBody('https://example.com/job'),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.text).toBeTruthy()
    expect(mockSubmitJobUrl).toHaveBeenCalledWith('https://example.com/job')
  })

  it('messages with zero URLs return friendly help, no job created', async () => {
    const res = await telegram.request('/', {
      method: 'POST',
      headers: DEFAULT_HEADERS,
      body: makeBody('can you help me find a job?'),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.text).toBeTruthy()
    expect(mockSubmitJobUrl).not.toHaveBeenCalled()
  })

  it('messages with multiple URLs return friendly help, no job created', async () => {
    const res = await telegram.request('/', {
      method: 'POST',
      headers: DEFAULT_HEADERS,
      body: makeBody('https://example.com/job1 https://example.com/job2'),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.text).toBeTruthy()
    expect(mockSubmitJobUrl).not.toHaveBeenCalled()
  })
})
