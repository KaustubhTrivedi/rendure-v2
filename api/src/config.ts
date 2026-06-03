/**
 * DEPLOY_TARGET config module.
 *
 * Reads DEPLOY_TARGET from process.env and resolves a frozen singleton
 * nested by seam ({ target, db, execution, credentials }). Fail-fast:
 * invalid non-empty target throws; missing required vars throw.
 *
 * Singleton: `import { config } from './config'`
 * Testable: `import { resolve } from './config'` (pure function, no process.env access)
 */

const VALID_TARGETS = ['self-hosted', 'cloud', 'browser'] as const
type Target = (typeof VALID_TARGETS)[number]

const REQUIRED_VARS: Record<Target, readonly string[]> = {
  'self-hosted': ['DATABASE_URL'],
  cloud: [],
  browser: [],
}

export interface ConfigSeamSettings {
  target: Target
  db: Readonly<Record<string, string>>
  execution: Readonly<Record<string, never>>
  credentials: Readonly<Record<string, never>>
}

/**
 * Pure resolver — takes an env mapping, returns a frozen ConfigSeamSettings.
 * Does NOT read process.env; use the `config` singleton export for that.
 */
export function resolve(env: Record<string, string | undefined>): ConfigSeamSettings {
  const raw = (env.DEPLOY_TARGET ?? '').trim()
  const target: string = raw === '' ? 'self-hosted' : raw

  if (!(VALID_TARGETS as readonly string[]).includes(target)) {
    throw new Error(
      `Invalid DEPLOY_TARGET "${raw}". Valid: ${VALID_TARGETS.join(', ')}`,
    )
  }

  for (const v of REQUIRED_VARS[target as Target]) {
    if (!env[v]) {
      throw new Error(`DEPLOY_TARGET=${target} requires ${v}`)
    }
  }

  const db: Record<string, string> = target === 'self-hosted'
    ? { connectionString: env.DATABASE_URL! }
    : {}

  return Object.freeze({
    target: target as Target,
    db: Object.freeze(db),
    execution: Object.freeze({}),
    credentials: Object.freeze({}),
  })
}

/** Frozen singleton resolved once at module import from process.env. */
export const config: ConfigSeamSettings = resolve(process.env)
