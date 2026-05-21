import { pool } from './db.js'
import { isTerminalStatus } from './sse.js'
import type { TelegramTerminalJob } from './telegram.js'
import {
  formatTelegramTerminalMessage,
  sendTelegramMessage,
} from './telegram.js'

/**
 * Query the canonical current state for a job and, if the job is in a terminal
 * state and the user's profile has a Telegram chat ID configured, send a
 * formatted notification message.
 *
 * Returns a typed result indicating whether the message was sent and, if not,
 * the reason.
 */
export async function notifyTerminalJob(
  jobId: string,
): Promise<{ sent: boolean; reason?: string }> {
  const result = await pool.query(
    `SELECT
       j.status,
       j.qa_score,
       j.company_name,
       j.role_title,
       j.active_resume_id,
       u.notify_telegram_chat_id,
       q.gaps
     FROM jobs j
     CROSS JOIN user_profile u
     LEFT JOIN LATERAL (
       SELECT qr.gaps
       FROM resume_versions rv
       JOIN qa_reviews qr ON qr.version_id = rv.version_id
       WHERE rv.job_id = j.job_id
       ORDER BY rv.created_at DESC
       LIMIT 1
     ) q ON true
     WHERE j.job_id = $1`,
    [jobId],
  )

  const row = result.rows[0]
  if (!row) {
    return { sent: false, reason: 'job_not_found' }
  }

  if (!isTerminalStatus(row.status)) {
    return { sent: false, reason: 'not_terminal' }
  }

  const chatId: string | null = row.notify_telegram_chat_id
  if (!chatId) {
    return { sent: false, reason: 'telegram_chat_not_configured' }
  }

  const telegramJob: TelegramTerminalJob = {
    job_id: jobId,
    status: row.status as 'approved' | 'low_match' | 'error',
    qa_score: row.qa_score,
    company_name: row.company_name,
    role_title: row.role_title,
    active_resume_id: row.active_resume_id,
    gaps: row.gaps,
  }

  const message = formatTelegramTerminalMessage(telegramJob)
  const sendResult = await sendTelegramMessage(chatId, message)

  if (sendResult.ok) {
    return { sent: true }
  }

  return { sent: false, reason: sendResult.error }
}
