import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..', '..')
const SCHEMA_PATH = resolve(ROOT, 'database', 'schema.sql')
const MIGRATION_PATH = resolve(ROOT, 'database', '008_compat_boundaries.sql')
const PIPELINE_NOTIFY_PATH = resolve(ROOT, 'database', '003_pipeline_events_notify.sql')
const SSE_PATH = resolve(ROOT, 'api', 'src', 'sse.ts')

function readText(path: string): string {
  return readFileSync(path, 'utf-8')
}

describe('database/008_compat_boundaries.sql', () => {
  const sql = readText(MIGRATION_PATH)

  it('is additive and creates compatibility boundary tables', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS application_statuses')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS application_timeline_events')
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS')
    for (const forbidden of ['ALTER TABLE jobs', 'DROP TABLE', 'DROP COLUMN', 'DELETE FROM jobs', 'UPDATE jobs SET qa_score', 'UPDATE jobs SET iteration_count']) {
      expect(sql).not.toContain(forbidden)
    }
  })

  it('keeps application statuses out of pipeline tables', () => {
    for (const status of ['saved', 'applied', 'interviewing', 'offer', 'rejected', 'archived']) {
      expect(sql).toContain(status)
      expect(readText(SCHEMA_PATH)).not.toContain(`'${status}'`)
    }
  })

  it('does not reference pipeline_events directly', () => {
    expect(sql).not.toContain('pipeline_events')
  })
})

describe('pipeline state boundaries', () => {
  const schema = readText(SCHEMA_PATH)
  const sse = readText(SSE_PATH)
  const notify = readText(PIPELINE_NOTIFY_PATH)

  it('keeps application statuses out of allowed_transitions and terminal statuses', () => {
    for (const status of ['saved', 'applied', 'interviewing', 'offer', 'rejected', 'archived']) {
      expect(schema).not.toContain(`('${status}'`)
      expect(sse).not.toContain(status)
    }
    expect(sse).toContain("approved', 'low_match', 'error")
  })

  it('keeps pipeline notify payload to job_id and event_id only', () => {
    expect(notify).toContain("'job_id', NEW.job_id")
    expect(notify).toContain("'event_id', NEW.event_id")
    expect(notify).not.toContain('metadata')
    expect(notify).not.toContain('detail')
  })
})
