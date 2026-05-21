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

vi.mock('./pg-listener.js', () => ({
  listenForPipelineEvents: vi.fn(),
}))

// ── Imports after mocks ─────────────────────────────────────────────────────

import { pool } from './db.js'
import {
  formatTelegramTerminalMessage,
  sendTelegramMessage,
  isTelegramBotConfigured,
} from './telegram.js'
import {
  notifyTerminalJob,
  startTelegramTerminalNotifier,
  __resetSentJobsForTests,
} from './telegram-notifier.js'
import * as pgListener from './pg-listener.js'
import { logger } from './middleware/logger.js'

const query = vi.mocked(pool.query)
const formatMsg = vi.mocked(formatTelegramTerminalMessage)
const sendMsg = vi.mocked(sendTelegramMessage)
const listenForPipelineEventsMock = vi.mocked(pgListener.listenForPipelineEvents)
const isConfigured = vi.mocked(isTelegramBotConfigured)

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

// ── Tests: startTelegramTerminalNotifier ─────────────────────────────────────

describe('startTelegramTerminalNotifier', () => {
  let capturedCallback: ((n: { job_id: string; event_id: string }) => void) | null
  let closeListener: () => Promise<void>

  beforeEach(() => {
    // Clear call counts only — do NOT clear mock implementations/return values
    query.mockClear()
    formatMsg.mockClear()
    sendMsg.mockClear()
    isConfigured.mockClear()
    listenForPipelineEventsMock.mockClear()
    vi.mocked(logger.warn).mockClear()
    vi.mocked(logger.error).mockClear()

    __resetSentJobsForTests()
    capturedCallback = null
    closeListener = vi.fn().mockResolvedValue(undefined)

    // Default: Telegram IS configured
    isConfigured.mockReturnValue(true)

    // Capture the onEvent callback so we can fire notifications in tests
    listenForPipelineEventsMock.mockImplementation(async (cb) => {
      capturedCallback = cb as (n: { job_id: string; event_id: string }) => void
      return { close: closeListener }
    })

    // Default query works
    query.mockResolvedValue({
      rows: [buildRow()],
      rowCount: 1,
    } as never)
    formatMsg.mockReturnValue('Mocked Telegram Message')
  })

  // ── Registers listener ────────────────────────────────────────────────────

  it('registers listenForPipelineEvents when Telegram is configured', async () => {
    const notifier = await startTelegramTerminalNotifier()

    expect(listenForPipelineEventsMock).toHaveBeenCalledTimes(1)
    expect(typeof capturedCallback).toBe('function')

    await notifier.close()
  })

  // ── Forwards notification to notifyTerminalJob ────────────────────────────

  it('calls notifyTerminalJob when a pipeline notification arrives', async () => {
    const notifier = await startTelegramTerminalNotifier()

    expect(capturedCallback).not.toBeNull()
    const p = capturedCallback!({ job_id: 'job-111-222', event_id: 'evt-001' })
    await p

    expect(query).toHaveBeenCalled()
    expect(sendMsg).toHaveBeenCalledTimes(1)
    expect(sendMsg).toHaveBeenCalledWith('chat-999', 'Mocked Telegram Message')

    await notifier.close()
  })

  // ── Duplicate suppression ────────────────────────────────────────────────

  it('does not send duplicate messages for the same job_id within one process', async () => {
    const notifier = await startTelegramTerminalNotifier()

    // Fire first notification
    const p1 = capturedCallback!({ job_id: 'job-111-222', event_id: 'evt-001' })
    await p1

    expect(query).toHaveBeenCalledTimes(1)
    expect(sendMsg).toHaveBeenCalledTimes(1)

    // Fire second notification (same job_id) — should be suppressed
    const p2 = capturedCallback!({ job_id: 'job-111-222', event_id: 'evt-002' })
    await p2

    expect(query).toHaveBeenCalledTimes(1)
    expect(sendMsg).toHaveBeenCalledTimes(1)

    await notifier.close()
  })

  it('sends separate messages for different job_ids', async () => {
    const notifier = await startTelegramTerminalNotifier()

    // Fire for two different jobs
    const p1 = capturedCallback!({ job_id: 'job-aaa', event_id: 'evt-001' })
    await p1
    const p2 = capturedCallback!({ job_id: 'job-bbb', event_id: 'evt-002' })
    await p2

    expect(query).toHaveBeenCalledTimes(2)
    expect(sendMsg).toHaveBeenCalledTimes(2)

    await notifier.close()
  })

  // ── No-op when unconfigured ───────────────────────────────────────────────

  it('returns a no-op notifier without registering listener when Telegram is not configured', async () => {
    isConfigured.mockReturnValue(false)

    const notifier = await startTelegramTerminalNotifier()

    // No listener was registered
    expect(listenForPipelineEventsMock).not.toHaveBeenCalled()
    // Warning was logged (if logger.warn was called)
    expect(logger.warn).toHaveBeenCalled()

    // close() resolves cleanly without error
    await notifier.close()
  })

  // ── Errors do not crash ──────────────────────────────────────────────────

  it('catches and logs notifyTerminalJob errors without crashing', async () => {
    query.mockRejectedValue(new Error('DB connection lost'))

    const notifier = await startTelegramTerminalNotifier()

    const p = capturedCallback!({ job_id: 'job-111-222', event_id: 'evt-001' })
    await p
    await new Promise((r) => setTimeout(r, 5))

    // The error was caught and logged
    expect(logger.error).toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ job_id: 'job-111-222' }),
      expect.any(String),
    )

    await notifier.close()
  })

  // ── close() cleans up ────────────────────────────────────────────────────

  it('close() calls the underlying listener close', async () => {
    const notifier = await startTelegramTerminalNotifier()

    await notifier.close()

    expect(closeListener).toHaveBeenCalledTimes(1)
  })
})
