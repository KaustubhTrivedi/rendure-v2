import pg from 'pg'

export interface PipelineNotification {
  job_id: string
  event_id: string
}

export interface PipelineEventListener {
  close(): Promise<void>
}

export async function listenForPipelineEvents(
  onEvent: (notification: PipelineNotification) => void,
): Promise<PipelineEventListener> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()

  client.on('notification', (msg) => {
    try {
      const parsed = JSON.parse(msg.payload ?? '{}')
      if (typeof parsed.job_id === 'string' && typeof parsed.event_id === 'string') {
        onEvent({ job_id: parsed.job_id, event_id: parsed.event_id })
      }
    } catch {
      // Malformed payload — notification is just a wake-up;
      // the route re-queries canonical rows.
    }
  })

  await client.query('LISTEN pipeline_events')

  return {
    close: async () => {
      await client.query('UNLISTEN pipeline_events').catch(() => undefined)
      await client.end().catch(() => undefined)
    },
  }
}
