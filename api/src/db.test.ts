import { beforeEach, describe, expect, it, vi } from 'vitest'

const { PoolMock, mockConfig } = vi.hoisted(() => ({
  PoolMock: vi.fn(),
  mockConfig: {
    config: {
      target: 'self-hosted',
      db: { connectionString: 'postgres://test' },
    },
  },
}))

vi.mock('pg', () => ({
  default: {
    Pool: PoolMock,
  },
}))

vi.mock('./config.js', () => mockConfig)

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mockConfig.config.target = 'self-hosted'
  mockConfig.config.db = { connectionString: 'postgres://test' }
  PoolMock.mockImplementation(({ connectionString }) => ({
    connectionString,
    kind: 'pool',
  }))
})

describe('createDb config.db.connectionString seam', () => {
  it('createDb constructs pg.Pool with exactly config.db.connectionString', async () => {
    const { createDb } = await import('./db-adapter.js')

    const pool = createDb()

    expect(PoolMock).toHaveBeenCalledTimes(1)
    expect(PoolMock).toHaveBeenCalledWith({ connectionString: 'postgres://test' })
    expect(pool).toEqual({ connectionString: 'postgres://test', kind: 'pool' })
  })

  it('createDb throws when config.db.connectionString is not set', async () => {
    mockConfig.config.db = {}
    const { createDb } = await import('./db-adapter.js')

    expect(() => createDb()).toThrow(/config\.db\.connectionString is not set/)
  })
})

describe('pool export behavior through ./db.js', () => {
  it('pool export preserves backward-compatible ./db.js consumers as the singleton created by createDb', async () => {
    const singletonPool = { tag: 'singleton-pool' }
    PoolMock.mockReturnValueOnce(singletonPool)

    const { pool } = await import('./db.js')
    const { createDb } = await import('./db-adapter.js')

    expect(pool).toBe(singletonPool)
    expect(PoolMock).toHaveBeenCalledTimes(1)

    const nextPool = createDb()

    expect(nextPool).not.toBe(pool)
    expect(PoolMock).toHaveBeenNthCalledWith(1, { connectionString: 'postgres://test' })
    expect(PoolMock).toHaveBeenNthCalledWith(2, { connectionString: 'postgres://test' })
  })
})
