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
