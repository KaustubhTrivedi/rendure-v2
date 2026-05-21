import { describe, expect, it } from 'vitest'
import type { TelegramTerminalJob } from './telegram.js'
import { formatTelegramTerminalMessage } from './telegram.js'

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
  })
})
