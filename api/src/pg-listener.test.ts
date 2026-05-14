import { describe, expect, it, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const MIGRATION_PATH = resolve(import.meta.dirname, '..', '..', 'database', '003_pipeline_events_notify.sql')

describe('003_pipeline_events_notify migration', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf-8')

  it('defines notify_pipeline_event function', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION notify_pipeline_event()')
  })

  it('calls pg_notify with pipeline_events channel', () => {
    expect(sql).toContain('pg_notify(')
    expect(sql).toContain("'pipeline_events'")
  })

  it('notifies with job_id and event_id only', () => {
    expect(sql).toContain("'job_id', NEW.job_id")
    expect(sql).toContain("'event_id', NEW.event_id")
  })

  it('does not include metadata or detail in notification payload', () => {
    expect(sql).not.toContain('metadata')
    expect(sql).not.toContain('NEW.detail')
  })
})

const triggerNotification = vi.hoisted(() => {
  let callbacks: Array<(msg: { payload?: string }) => void> = []
  return {
    _callbacks: callbacks,
    register: (cb: (msg: { payload?: string }) => void) => { callbacks.push(cb) },
    fire: (payload?: string) => { callbacks.forEach((cb) => cb({ payload })) },
    reset: () => { callbacks = [] },
  }
})

vi.mock('pg', () => {
  const mockClient = {
    connect: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue(undefined),
    on: vi.fn((_event: string, cb: (...args: unknown[]) => void) => {
      triggerNotification.register(cb as (msg: { payload?: string }) => void)
    }),
    end: vi.fn().mockResolvedValue(undefined),
  }
  const Client = vi.fn(function () {
    return mockClient
  })
  return {
    default: { Client },
    Client,
  }
})

import { listenForPipelineEvents } from './pg-listener.js'
import pg from 'pg'

describe('listenForPipelineEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    triggerNotification.reset()
  })

  it('creates a dedicated pg.Client, connects, and LISTENs on pipeline_events', async () => {
    const onEvent = vi.fn()
    const listener = await listenForPipelineEvents(onEvent)

    expect(pg.Client).toHaveBeenCalledTimes(1)
    const client = vi.mocked(pg.Client).mock.results[0].value
    expect(client.connect).toHaveBeenCalledTimes(1)
    expect(client.query).toHaveBeenCalledWith('LISTEN pipeline_events')

    await listener.close()
  })

  it('invokes callback on valid notification payload', async () => {
    const onEvent = vi.fn()
    const listener = await listenForPipelineEvents(onEvent)

    triggerNotification.fire(JSON.stringify({ job_id: 'job-123', event_id: 'evt-001' }))

    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(onEvent).toHaveBeenCalledWith({ job_id: 'job-123', event_id: 'evt-001' })

    await listener.close()
  })

  it('does not invoke callback for malformed or incomplete payloads', async () => {
    const onEvent = vi.fn()
    const listener = await listenForPipelineEvents(onEvent)

    triggerNotification.fire('not-json')
    triggerNotification.fire(JSON.stringify({ foo: 'bar' }))
    triggerNotification.fire(JSON.stringify({ job_id: 'job-123' }))
    triggerNotification.fire(JSON.stringify({ event_id: 'evt-001' }))
    triggerNotification.fire(JSON.stringify({ job_id: 123, event_id: 'evt-001' }))

    expect(onEvent).not.toHaveBeenCalled()

    await listener.close()
  })

  it('close() sends UNLISTEN and ends the client exactly once', async () => {
    const onEvent = vi.fn()
    const listener = await listenForPipelineEvents(onEvent)

    const client = vi.mocked(pg.Client).mock.results[0].value

    await listener.close()

    expect(client.query).toHaveBeenCalledWith('UNLISTEN pipeline_events')
    expect(client.end).toHaveBeenCalledTimes(1)
  })
})
