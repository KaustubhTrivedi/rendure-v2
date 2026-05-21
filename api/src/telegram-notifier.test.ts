import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── Hoisted mocks ───────────────────────────────────────────────────────────

vi.mock('./db.js', () => ({
  pool: { query: vi.fn() },
}))

vi.mock('./telegram.js', () => ({
  formatTelegramTerminalMessage: vi.fn(),
  sendTelegramMessage: vi.fn().mockResolvedValue({ ok: true }),
  isTelegramBotConfigured: vi.fn(),
}))

vi.mock('./middleware/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

// ── Imports after mocks ─────────────────────────────────────────────────────

import { pool } from './db.js'
import {
  formatTelegramTerminalMessage,
  sendTelegramMessage,
} from './telegram.js'
import { notifyTerminalJob } from './telegram-notifier.js'

const query = vi.mocked(pool.query)
const formatMsg = vi.mocked(formatTelegramTerminalMessage)
const sendMsg = vi.mocked(sendTelegramMessage)

// ── Shared test data ────────────────────────────────────────────────────────

const BASE_JOB_ROW = {
  job_id: 'job-111-222',
  status: 'approved',
  qa_score: '0.950',
  company_name: 'Acme Corp',
  role_title: 'Senior Engineer',
  active_resume_id: 'resume-aaa-bbb',
  gaps: null,
}

const PROFILE_ROW = {
  notify_telegram_chat_id: 'chat-999',
}

function buildRow(overrides: Record<string, unknown> = {}) {
  return { ...BASE_JOB_ROW, ...PROFILE_ROW, ...overrides }
}

// ── Tests: notifyTerminalJob ────────────────────────────────────────────────

describe('notifyTerminalJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    formatMsg.mockReturnValue('Mocked Telegram Message')
  })

  // ── Approved job ──────────────────────────────────────────────────────────

  const approvedTests = [
    {
      name: 'sends formatted Telegram message for terminal approved job with full rows',
      rowOverrides: {},
      expectedStatus: 'approved',
      expectedQaScore: '0.950',
      expectedCompany: 'Acme Corp',
      expectedRole: 'Senior Engineer',
      expectedResumeId: 'resume-aaa-bbb',
      expectedGaps: null,
    },
    {
      name: 'handles null company_name and role_title for approved job',
      rowOverrides: { company_name: null, role_title: null },
      expectedStatus: 'approved',
      expectedQaScore: '0.950',
      expectedCompany: null,
      expectedRole: null,
      expectedResumeId: 'resume-aaa-bbb',
      expectedGaps: null,
    },
    {
      name: 'handles null active_resume_id for approved job',
      rowOverrides: { active_resume_id: null },
      expectedStatus: 'approved',
      expectedQaScore: '0.950',
      expectedCompany: 'Acme Corp',
      expectedRole: 'Senior Engineer',
      expectedResumeId: null,
      expectedGaps: null,
    },
    {
      name: 'handles null qa_score for approved job',
      rowOverrides: { qa_score: null },
      expectedStatus: 'approved',
      expectedQaScore: null,
      expectedCompany: 'Acme Corp',
      expectedRole: 'Senior Engineer',
      expectedResumeId: 'resume-aaa-bbb',
      expectedGaps: null,
    },
  ]

  approvedTests.forEach((t) => {
    it(t.name, async () => {
      query.mockResolvedValue({
        rows: [buildRow(t.rowOverrides)],
        rowCount: 1,
      } as never)

      const result = await notifyTerminalJob('job-111-222')

      expect(result).toEqual({ sent: true })

      expect(formatMsg).toHaveBeenCalledTimes(1)
      expect(formatMsg).toHaveBeenCalledWith({
        job_id: 'job-111-222',
        status: t.expectedStatus,
        qa_score: t.expectedQaScore,
        company_name: t.expectedCompany,
        role_title: t.expectedRole,
        active_resume_id: t.expectedResumeId,
        gaps: t.expectedGaps,
      })

      expect(sendMsg).toHaveBeenCalledTimes(1)
      expect(sendMsg).toHaveBeenCalledWith('chat-999', 'Mocked Telegram Message')
    })
  })

  // ── Low match with gaps ────────────────────────────────────────────────────

  it('sends formatted Telegram message for low_match with high-severity gaps', async () => {
    const gaps = [
      { category: 'skills', detail: 'Missing TypeScript experience', severity: 'high' },
      { category: 'experience', detail: 'No cloud deployment history', severity: 'high' },
      { category: 'seniority', detail: 'Tone mismatch', severity: 'low' },
    ]

    query.mockResolvedValue({
      rows: [
        buildRow({ status: 'low_match', qa_score: '0.612', gaps }),
      ],
      rowCount: 1,
    } as never)

    const result = await notifyTerminalJob('job-111-222')

    expect(result).toEqual({ sent: true })

    expect(formatMsg).toHaveBeenCalledWith({
      job_id: 'job-111-222',
      status: 'low_match',
      qa_score: '0.612',
      company_name: 'Acme Corp',
      role_title: 'Senior Engineer',
      active_resume_id: 'resume-aaa-bbb',
      gaps,
    })

    expect(sendMsg).toHaveBeenCalledTimes(1)
  })

  // ── Error ──────────────────────────────────────────────────────────────────

  it('sends formatted Telegram message for error status', async () => {
    query.mockResolvedValue({
      rows: [
        buildRow({ status: 'error', qa_score: null, active_resume_id: null }),
      ],
      rowCount: 1,
    } as never)

    const result = await notifyTerminalJob('job-111-222')

    expect(result).toEqual({ sent: true })

    expect(formatMsg).toHaveBeenCalledWith({
      job_id: 'job-111-222',
      status: 'error',
      qa_score: null,
      company_name: 'Acme Corp',
      role_title: 'Senior Engineer',
      active_resume_id: null,
      gaps: null,
    })

    expect(sendMsg).toHaveBeenCalledTimes(1)
  })

  // ── Not terminal ──────────────────────────────────────────────────────────

  it('returns not_terminal for non-terminal job status', async () => {
    query.mockResolvedValue({
      rows: [buildRow({ status: 'tailoring' })],
      rowCount: 1,
    } as never)

    const result = await notifyTerminalJob('job-111-222')

    expect(result).toEqual({ sent: false, reason: 'not_terminal' })
    expect(formatMsg).not.toHaveBeenCalled()
    expect(sendMsg).not.toHaveBeenCalled()
  })

  // ── Chat not configured ───────────────────────────────────────────────────

  it('returns telegram_chat_not_configured when notify_telegram_chat_id is null', async () => {
    query.mockResolvedValue({
      rows: [buildRow({ notify_telegram_chat_id: null })],
      rowCount: 1,
    } as never)

    const result = await notifyTerminalJob('job-111-222')

    expect(result).toEqual({
      sent: false,
      reason: 'telegram_chat_not_configured',
    })
    expect(formatMsg).not.toHaveBeenCalled()
    expect(sendMsg).not.toHaveBeenCalled()
  })

  it('returns telegram_chat_not_configured when notify_telegram_chat_id is empty string', async () => {
    query.mockResolvedValue({
      rows: [buildRow({ notify_telegram_chat_id: '' })],
      rowCount: 1,
    } as never)

    const result = await notifyTerminalJob('job-111-222')

    expect(result).toEqual({
      sent: false,
      reason: 'telegram_chat_not_configured',
    })
    expect(formatMsg).not.toHaveBeenCalled()
    expect(sendMsg).not.toHaveBeenCalled()
  })

  // ── Send failure ──────────────────────────────────────────────────────────

  it('returns send failure reason when telegram send fails', async () => {
    query.mockResolvedValue({
      rows: [buildRow()],
      rowCount: 1,
    } as never)
    sendMsg.mockResolvedValue({ ok: false, error: 'telegram_send_failed' })

    const result = await notifyTerminalJob('job-111-222')

    expect(result).toEqual({ sent: false, reason: 'telegram_send_failed' })
    expect(formatMsg).toHaveBeenCalledTimes(1)
    expect(sendMsg).toHaveBeenCalledTimes(1)
  })

  // ── No rows returned ──────────────────────────────────────────────────────

  it('returns job_not_found when query returns no rows', async () => {
    query.mockResolvedValue({ rows: [], rowCount: 0 } as never)

    const result = await notifyTerminalJob('job-nonexistent')

    expect(result).toEqual({ sent: false, reason: 'job_not_found' })
    expect(formatMsg).not.toHaveBeenCalled()
    expect(sendMsg).not.toHaveBeenCalled()
  })
})
