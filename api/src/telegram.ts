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
  status: 'approved' | 'low_match' | 'error'
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
        lines.push(`*Resume:* \`${base}\``)
        lines.push(`*PDF:* \`${base}/pdf\``)
      }
      return lines.join('\n')
    }
    // Placeholder – other statuses will be added in subsequent RED->GREEN cycles
    default:
      return `Status: ${escapeMarkdownV2(job.status)}`
  }
}
