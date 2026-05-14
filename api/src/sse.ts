export const PIPELINE_SSE_EVENT = 'pipeline_event'

export const SSE_KEEPALIVE_MS = 30_000

export const SSE_KEEPALIVE_COMMENT = ': keepalive\n\n'

export const TERMINAL_STATUSES = new Set(['approved', 'low_match', 'error'])

export function isTerminalStatus(status: string | null | undefined): boolean {
  return status != null && TERMINAL_STATUSES.has(status)
}

export interface PipelineEventRow {
  event_id: string
  job_id: string
  event_type: string
  agent_name: string | null
  from_status: string | null
  to_status: string | null
  model_used: string | null
  detail: string | null
  metadata: Record<string, unknown> | null
  timestamp: string
}

export interface PipelineEventPayload {
  event_id: string
  job_id: string
  event_type: string
  agent_name: string | null
  from_status: string | null
  to_status: string | null
  model_used: string | null
  detail: string | null
  metadata: Record<string, unknown> | null
  timestamp: string
}

export function toPipelineEventPayload(row: PipelineEventRow): PipelineEventPayload {
  return {
    event_id: row.event_id,
    job_id: row.job_id,
    event_type: row.event_type,
    agent_name: row.agent_name,
    from_status: row.from_status,
    to_status: row.to_status,
    model_used: row.model_used,
    detail: row.detail,
    metadata: row.metadata,
    timestamp: row.timestamp,
  }
}
