import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TelegramTerminalJob } from './telegram.js'
import {
  formatTelegramTerminalMessage,
  isTelegramBotConfigured,
  sendTelegramMessage,
} from './telegram.js'

describe('formatTelegramTerminalMessage', () => {
  it('formats approved job with QA score, role/company, and resume API paths', () => {
    const job: TelegramTerminalJob = {
      job_id: 'job-abc-123',
      status: 'approved',
      qa_score: '0.965',
      company_name: 'Acme Corp',
      role_title: 'Senior Engineer',
      active_resume_id: 'resume-xyz-456',
    }

    const msg = formatTelegramTerminalMessage(job)

    // Status
    expect(msg).toContain('Approved')
    // QA score (dots are MarkdownV2-escaped)
    expect(msg).toContain('0\\.965')
    // Role / company
    expect(msg).toContain('Senior Engineer')
    expect(msg).toContain('Acme Corp')
    // Resume API paths (not absolute URLs) per D-09/D-12 (slashes are unescaped, but - and . inside IDs are escaped)
    expect(msg).toContain('/jobs/job\\-abc\\-123/resume/resume\\-xyz\\-456')
    expect(msg).toContain('/jobs/job\\-abc\\-123/resume/resume\\-xyz\\-456/pdf')
    // No backtick code spans (MarkdownV2 inside code spans is literal)
    expect(msg).not.toContain('`/jobs')
  })

  it('formats low_match with status, QA score, and top high-severity gaps', () => {
    const job: TelegramTerminalJob = {
      job_id: 'job-def-456',
      status: 'low_match',
      qa_score: 0.612,
      company_name: 'Beta Inc',
      role_title: 'Junior Developer',
      active_resume_id: null,
      gaps: [
        { category: 'skills', detail: 'Missing TypeScript experience', severity: 'high' },
        { category: 'experience', detail: 'No cloud deployment history', severity: 'high' },
        { category: 'seniority', detail: 'Tone does not match junior level', severity: 'low' },
        { category: 'structure', detail: 'Missing education section', severity: 'high' },
      ],
    }

    const msg = formatTelegramTerminalMessage(job)

    // Status
    expect(msg).toContain('Low Match')
    // QA score
    expect(msg).toContain('0\\.612')
    // Only high-severity gaps included (not low)
    expect(msg).toContain('Missing TypeScript experience')
    expect(msg).toContain('No cloud deployment history')
    expect(msg).toContain('Missing education section')
    expect(msg).not.toContain('Tone does not match junior level')
    // No resume paths (no active_resume_id)
    expect(msg).not.toContain('/resume/')
  })

  it('formats error with safe failure text, job ID, and no stack traces', () => {
    const job: TelegramTerminalJob = {
      job_id: 'job-err-789',
      status: 'error',
      qa_score: null,
      company_name: null,
      role_title: null,
      active_resume_id: null,
    }

    const msg = formatTelegramTerminalMessage(job)

    // Safe status indicator
    expect(msg).toContain('Error')
    // Job ID present for debugging (hyphen is MarkdownV2-escaped)
    expect(msg).toContain('job\\-err\\-789')
    // No stack traces or internal detail per D-11
    expect(msg).not.toContain('Error:')
    expect(msg).not.toContain('at ')
    expect(msg).not.toContain('node_modules')
    expect(msg).not.toContain('stack')
    // No QA score (it's null)
    expect(msg).not.toContain('Score')
  })

  it('escapes all MarkdownV2 special characters in dynamic values', () => {
    // All special chars: _ * [ ] ( ) ~ ` > # + - = | { } . !
    // Test via company_name and role_title which appear in approved output
    const job: TelegramTerminalJob = {
      job_id: 'ignored',
      status: 'approved',
      qa_score: null,
      company_name: 'Test_Co*Test',
      role_title: 'Eng [III] (star)',
      active_resume_id: null,
    }

    const msg = formatTelegramTerminalMessage(job)

    // Underscores and asterisks escaped with backslash
    expect(msg).toContain('Test\\_Co\\*Test')
    // Brackets escaped
    expect(msg).toContain('\\[III\\]')
    // Parentheses escaped with backslash
    expect(msg).toContain('\\(star\\)')
    // No literal unescaped markdown chars from dynamic values
    expect(msg).not.toContain('[III]')
  })
})

describe('isTelegramBotConfigured', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns false when TELEGRAM_BOT_TOKEN is missing', () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '')
    expect(isTelegramBotConfigured()).toBe(false)
  })

  it('returns true when TELEGRAM_BOT_TOKEN is set', () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'abc:def')
    expect(isTelegramBotConfigured()).toBe(true)
  })
})

describe('sendTelegramMessage', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('returns telegram_not_configured when TELEGRAM_BOT_TOKEN is missing', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '')
    const result = await sendTelegramMessage('123', 'Hello')
    expect(result).toEqual({ ok: false, error: 'telegram_not_configured' })
  })

  it('sends POST JSON to correct Telegram API URL with token, chat_id, text, and parse_mode', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'bot123:token456')

    const result = await sendTelegramMessage('chat-999', '*Hello* world')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.telegram.org/botbot123:token456/sendMessage')
    expect(opts.method).toBe('POST')
    expect(opts.headers).toEqual({ 'Content-Type': 'application/json' })
    const body = JSON.parse(opts.body as string)
    expect(body.chat_id).toBe('chat-999')
    expect(body.text).toBe('*Hello* world')
    expect(body.parse_mode).toBe('MarkdownV2')
    expect(result).toEqual({ ok: true })
  })

  it('returns telegram_send_failed on non-ok response without exposing token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ ok: false, description: 'Bad request' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'secret-token-123')

    const result = await sendTelegramMessage('chat-999', 'Hello')

    expect(result).toEqual({ ok: false, error: 'telegram_send_failed' })
    // Token must not appear in the returned error
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(JSON.stringify(result)).not.toContain('token')
  })
})
