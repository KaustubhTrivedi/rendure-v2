import pg from 'pg'

const { Pool } = pg

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set.')
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL })
