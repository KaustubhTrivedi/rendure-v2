import type pg from 'pg'
import { createDb } from './db-adapter.js'

export { createDb }

export const pool: pg.Pool = createDb()
