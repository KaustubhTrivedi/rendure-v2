import { pool } from './db.js'
import { isTerminalStatus } from './sse.js'
import type { TelegramTerminalJob } from './telegram.js'
import {
  formatTelegramTerminalMessage,
  sendTelegramMessage,
  isTelegramBotConfigured,
} from './telegram.js'
import { listenForPipelineEvents } from './pg-listener.js'
import { logger } from './middleware/logger.js'

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

// ── Terminal notifier lifecycle ──────────────────────────────────────────────

/**
 * In-memory set of job IDs for which a terminal notification has already
 * been sent in this process. Guards against duplicate Telegram messages
 * when multiple pipeline_events arrive for the same terminal transition.
 */
const sentJobs = new Set<string>()

/**
 * Reset the in-memory sent-job set. Only needed in tests.
 */
export function __resetSentJobsForTests(): void {
  sentJobs.clear()
}

export interface TelegramTerminalNotifier {
  close(): Promise<void>
}

/**
 * Start listening for pipeline events and send Telegram notifications for
 * terminal-state job transitions.
 *
 * If the Telegram bot token is not configured (`isTelegramBotConfigured()`
 * returns false), this returns a no-op notifier without opening a database
 * listener. This makes startup safe when Telegram is not set up.
 *
 * Errors in the listener or notification pipeline are caught and logged.
 * They never crash the server.
 */
export async function startTelegramTerminalNotifier(): Promise<TelegramTerminalNotifier> {
  if (!isTelegramBotConfigured()) {
    logger.warn({ feature: 'telegram-terminal-notifier' }, 'Telegram bot not configured; terminal notifications disabled.')
    return { close: async () => {} }
  }

  const listener = await listenForPipelineEvents(
    async (notification: { job_id: string; event_id: string }) => {
      // Process-local duplicate suppression
      if (sentJobs.has(notification.job_id)) {
        return
      }
      sentJobs.add(notification.job_id)

      try {
        const result = await notifyTerminalJob(notification.job_id)
        if (!result.sent) {
          logger.warn(
            { job_id: notification.job_id, reason: result.reason },
            'Terminal notification not sent',
          )
        }
      } catch (err) {
        logger.error(
          {
            job_id: notification.job_id,
            err: err instanceof Error ? err.message : String(err),
          },
          'Terminal notification error',
        )
      }
    },
  )

  return {
    close: async () => {
      await listener.close()
    },
  }
}
