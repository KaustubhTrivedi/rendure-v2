/**
 * Telegram outbound message formatting and Bot API client.
 *
 * Provides MarkdownV2-escaped terminal status messages for approved,
 * low_match, and error pipeline outcomes, plus a dependency-free
 * sendMessage wrapper around fetch().
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface TelegramTerminalJob {
  job_id: string
  status: 'approved' | 'low_match' | 'error' | 'submitted' | 'submission_failed'
  qa_score: string | number | null
  company_name: string | null
  role_title: string | null
  active_resume_id: string | null
  gaps?: Array<{ category?: string; detail?: string; severity?: string }> | null
}

export interface TelegramSendOk {
  ok: true
}

export interface TelegramSendFailed {
  ok: false
  error: string
}

export type TelegramSendResult = TelegramSendOk | TelegramSendFailed

// ── MarkdownV2 escaping ────────────────────────────────────────────────────

/**
 * Characters that MUST be escaped in Telegram MarkdownV2:
 * _ * [ ] ( ) ~ ` > # + - = | { } . !
 *
 * Each is prefixed with a backslash.
 */
const MARKDOWN_V2_ESCAPE_RE = /[_*[\]()~`>#+\-=|{}.!]/g

/**
 * Escape a plain-text string so it is safe for inclusion in a
 * Telegram MarkdownV2 message.
 */
export function escapeMarkdownV2(text: string): string {
  return text.replace(MARKDOWN_V2_ESCAPE_RE, '\\$&')
}

// ── Configuration ──────────────────────────────────────────────────────────

/**
 * Check whether a Telegram bot token is available for outbound messages.
 *
 * Reads `TELEGRAM_BOT_TOKEN` from the environment at call time so that
 * tests can mutate `process.env` without module-level side effects.
 */
export function isTelegramBotConfigured(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN
}

// ── sendMessage client ─────────────────────────────────────────────────────

const TELEGRAM_API_BASE = 'https://api.telegram.org/bot'

/**
 * Send a MarkdownV2-formatted message to the given Telegram chat.
 *
 * Reads `TELEGRAM_BOT_TOKEN` at call time.  Never includes the token
 * in returned errors or log output (T-04-02-01).
 */
export async function sendTelegramMessage(
  chatId: string,
  text: string,
): Promise<TelegramSendResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) {
    return { ok: false, error: 'telegram_not_configured' }
  }

  const url = `${TELEGRAM_API_BASE}${token}/sendMessage`

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'MarkdownV2',
      }),
    })
  } catch {
    return { ok: false, error: 'telegram_send_failed' }
  }

  if (!response.ok) {
    return { ok: false, error: 'telegram_send_failed' }
  }

  return { ok: true }
}

// ── Message formatting ─────────────────────────────────────────────────────

/**
 * Build a MarkdownV2-formatted terminal status message for the given job.
 *
 * Uses API-relative paths only (D-12).  Never includes stack traces or
 * internal exception detail (D-11).
 */
export function formatTelegramTerminalMessage(job: TelegramTerminalJob): string {
  const safe = {
    company: job.company_name ? escapeMarkdownV2(job.company_name) : null,
    role: job.role_title ? escapeMarkdownV2(job.role_title) : null,
    score: job.qa_score != null ? escapeMarkdownV2(String(job.qa_score)) : null,
  }

  switch (job.status) {
    case 'approved': {
      const lines = [`✅ *Status:* Approved`]
      if (safe.score) {
        lines.push(`*QA Score:* ${safe.score}`)
      }
      const roleParts: string[] = []
      if (safe.role) roleParts.push(safe.role)
      if (safe.company) roleParts.push(`@ ${safe.company}`)
      if (roleParts.length > 0) {
        lines.push(`*Role:* ${roleParts.join(' ')}`)
      }
      if (job.active_resume_id) {
        const base = `/jobs/${escapeMarkdownV2(job.job_id)}/resume/${escapeMarkdownV2(job.active_resume_id)}`
        lines.push(`*Resume:* ${base}`)
        lines.push(`*PDF:* ${base}/pdf`)
      }
      return lines.join('\n')
    }
    case 'error': {
      // Safe, no stack traces (D-11)
      const lines: string[] = []
      lines.push(`❌ *Status:* Error`)
      lines.push('')
      lines.push('Tailoring failed for your job posting. The pipeline encountered an error before completing.')
      lines.push('')
      lines.push(`Check status: /jobs/${escapeMarkdownV2(job.job_id)}/status`)
      return lines.join('\n')
    }

    case 'low_match': {
      const lines: string[] = []
      lines.push(`⚠️ *Status:* Low Match`)
      if (safe.score) {
        lines.push(`*QA Score:* ${safe.score}`)
      }
      // Include top high-severity gaps, preserving supplied order
      const highGaps = (job.gaps ?? []).filter((g) => g.severity === 'high')
      if (highGaps.length > 0) {
        lines.push('')
        lines.push('*Key Gaps:*')
        for (const gap of highGaps) {
          const detail = gap.detail ? escapeMarkdownV2(gap.detail) : ''
          lines.push(`• ${detail}`)
        }
      }
      return lines.join('\n')
    }
    case 'submitted': {
      const lines = [`📨 *Status:* Submitted`]
      const roleParts: string[] = []
      if (safe.role) roleParts.push(safe.role)
      if (safe.company) roleParts.push(`@ ${safe.company}`)
      if (roleParts.length > 0) {
        lines.push(`*Role:* ${roleParts.join(' ')}`)
      }
      lines.push('')
      lines.push('Your application was submitted to the employer portal after QA approval.')
      return lines.join('\n')
    }
    case 'submission_failed': {
      const lines = [`❌ *Status:* Submission Failed`]
      const roleParts: string[] = []
      if (safe.role) roleParts.push(safe.role)
      if (safe.company) roleParts.push(`@ ${safe.company}`)
      if (roleParts.length > 0) {
        lines.push(`*Role:* ${roleParts.join(' ')}`)
      }
      lines.push('')
      lines.push('Auto-apply could not submit your application. Your tailored resume is still available.')
      lines.push('')
      lines.push(`Check status: /jobs/${escapeMarkdownV2(job.job_id)}/status`)
      return lines.join('\n')
    }
    default:
      return `Status: ${escapeMarkdownV2(job.status)}`
  }
}
