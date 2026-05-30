import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { resolve } from './config.js'

const fixture: Record<string, Record<string, unknown>> = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../tests/fixtures/deploy-target-parity.json'),
    'utf-8',
  ),
)

describe('resolve() target defaults', () => {
  it('defaults to self-hosted when DEPLOY_TARGET is undefined', () => {
    const result = resolve({ DATABASE_URL: 'postgres://x' })
    expect(result.target).toBe('self-hosted')
  })

  it('defaults to self-hosted when DEPLOY_TARGET is empty string', () => {
    const result = resolve({ DEPLOY_TARGET: '', DATABASE_URL: 'postgres://x' })
    expect(result.target).toBe('self-hosted')
  })

  it('defaults to self-hosted when DEPLOY_TARGET is whitespace only', () => {
    const result = resolve({ DEPLOY_TARGET: '  ', DATABASE_URL: 'postgres://x' })
    expect(result.target).toBe('self-hosted')
  })
})

describe('parity fixture', () => {
  it('resolve per target deep-equals the shared parity fixture', () => {
    for (const [target, expected] of Object.entries(fixture)) {
      const env: Record<string, string> = { DEPLOY_TARGET: target }
      if (target === 'self-hosted') {
        env.DATABASE_URL = 'postgres://parity-fixture'
      }
      expect(resolve(env)).toEqual(expected)
    }
  })
})
