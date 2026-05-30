import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
