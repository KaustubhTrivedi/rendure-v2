import { Hono } from 'hono'
import { z } from 'zod'
import { pool } from '../db.js'
import { httpError } from '../errors.js'

const vault = new Hono()

const approvalReadFilter = (state: string | undefined) =>
  state === 'candidate'
    ? "approval_state = 'pending'"
    : "approval_state IN ('approved','edited')"

function validationFields(error: z.ZodError) {
  return error.errors.map((e) => ({
    path: e.path.join('.'),
    message: e.message,
  }))
}

export default vault
