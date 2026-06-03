import pg from 'pg'
import { config } from './config.js'

const { Pool } = pg

export function createDb(): pg.Pool {
  const connStr = (config.db as Record<string, string>).connectionString

  if (!connStr) {
    throw new Error(
      `createDb(): config.db.connectionString is not set for DEPLOY_TARGET="${config.target}"`,
    )
  }

  return new Pool({ connectionString: connStr })
}
