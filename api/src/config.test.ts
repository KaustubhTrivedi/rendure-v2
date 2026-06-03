import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const fixture: Record<string, Record<string, unknown>> = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../tests/fixtures/deploy-target-parity.json'),
    'utf-8',
  ),
)

describe('resolve() target defaults', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.DATABASE_URL = 'postgres://x'
  })

  afterEach(() => {
    delete process.env.DATABASE_URL
    delete process.env.DEPLOY_TARGET
  })

  it('defaults to self-hosted when DEPLOY_TARGET is undefined', async () => {
    delete process.env.DEPLOY_TARGET
    const { resolve } = await import('./config.js')
    const result = resolve(process.env)
    expect(result.target).toBe('self-hosted')
  })

  it('defaults to self-hosted when DEPLOY_TARGET is empty string', async () => {
    process.env.DEPLOY_TARGET = ''
    const { resolve } = await import('./config.js')
    const result = resolve(process.env)
    expect(result.target).toBe('self-hosted')
  })

  it('defaults to self-hosted when DEPLOY_TARGET is whitespace only', async () => {
    process.env.DEPLOY_TARGET = '  '
    const { resolve } = await import('./config.js')
    const result = resolve(process.env)
    expect(result.target).toBe('self-hosted')
  })
})

describe('parity fixture', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.DATABASE_URL = 'postgres://parity-fixture'
  })

  it('resolve per target deep-equals the shared parity fixture', async () => {
    const { resolve } = await import('./config.js')
    for (const [target, expected] of Object.entries(fixture)) {
      const env: Record<string, string> = { DEPLOY_TARGET: target }
      if (target === 'self-hosted') {
        env.DATABASE_URL = 'postgres://parity-fixture'
      }
      expect(resolve(env)).toEqual(expected)
    }
  })
})

describe('fail-fast throw tests', () => {
  let resolve: (env: Record<string, string | undefined>) => { target: string; db: Record<string, string>; execution: Record<string, never>; credentials: Record<string, never> }

  beforeAll(async () => {
    process.env.DATABASE_URL = 'postgres://x'
    vi.resetModules()
    const mod = await import('./config.js')
    resolve = mod.resolve
  })

  afterAll(() => {
    delete process.env.DATABASE_URL
  })

  it('throws on invalid non-empty DEPLOY_TARGET listing valid targets', () => {
    expect(() => resolve({ DEPLOY_TARGET: 'staging', DATABASE_URL: 'postgres://x' }))
      .toThrow(/self-hosted, cloud, browser/)
  })

  it('throws on missing DATABASE_URL for self-hosted target', () => {
    expect(() => resolve({ DEPLOY_TARGET: 'self-hosted' }))
      .toThrow(/DATABASE_URL/)
  })
})

describe('config singleton immutability', () => {
  let config: Record<string, unknown>

  beforeAll(async () => {
    process.env.DATABASE_URL = 'postgres://x'
    vi.resetModules()
    const mod = await import('./config.js')
    config = mod.config
  })

  afterAll(() => {
    delete process.env.DATABASE_URL
  })

  it('config is frozen', () => {
    expect(Object.isFrozen(config)).toBe(true)
  })

  it('config.db is frozen', () => {
    expect(Object.isFrozen(config.db)).toBe(true)
  })

  it('config.execution is frozen', () => {
    expect(Object.isFrozen(config.execution)).toBe(true)
  })

  it('config.credentials is frozen', () => {
    expect(Object.isFrozen(config.credentials)).toBe(true)
  })
})
