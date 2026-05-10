import { describe, expect, it, vi } from 'vitest'

vi.mock('./db.js', () => ({
  pool: {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  },
}))

describe('app', () => {
  it('mounts jobs routes', async () => {
    const { app } = await import('./index.js')

    const res = await app.request('/jobs/missing/status')


    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ error: 'Job not found.' })
  })
})
