import { Hono } from 'hono'
import { z } from 'zod'
import { pool } from '../db.js'
import { httpError } from '../errors.js'

const vault = new Hono()

const vaultProfileSchema = z
  .object({
    headline: z.string().min(1).optional(),
    summary: z.string().min(1).optional(),
    preferred_titles: z.array(z.string().min(1)).optional(),
    location: z.string().min(1).optional(),
    work_authorization: z.string().min(1).optional(),
    remote_preference: z.enum(['remote', 'hybrid', 'onsite']).nullable().optional(),
    open_to_relocation: z.boolean().optional(),
  })
  .strict()

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

vault.get('/profile', async (c) => {
  const result = await pool.query(
    `SELECT id, headline, summary, preferred_titles, location, work_authorization,
            remote_preference, open_to_relocation, last_user_edit, created_at
     FROM vault_profile WHERE id = 1`,
  )
  return c.json(result.rows[0] ?? {})
})

vault.patch('/profile', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return httpError(c, 400, 'bad_request', 'Request body must be a JSON object.')
  }

  const parsed = vaultProfileSchema.safeParse(body)
  if (!parsed.success) {
    return httpError(c, 422, 'validation_failed', 'Invalid vault profile.', {
      fields: validationFields(parsed.error),
    })
  }

  const data = parsed.data
  await pool.query(
    `INSERT INTO vault_profile (id,
       headline, summary, preferred_titles, location, work_authorization,
       remote_preference, open_to_relocation
     ) VALUES (1, $1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE SET
       headline           = COALESCE($1::text, vault_profile.headline),
       summary            = COALESCE($2::text, vault_profile.summary),
       preferred_titles   = COALESCE($3::jsonb, vault_profile.preferred_titles),
       location           = COALESCE($4::text, vault_profile.location),
       work_authorization = COALESCE($5::text, vault_profile.work_authorization),
       remote_preference  = COALESCE($6::text, vault_profile.remote_preference),
       open_to_relocation = COALESCE($7::boolean, vault_profile.open_to_relocation),
       last_user_edit     = NOW()`,
    [
      data.headline ?? null,
      data.summary ?? null,
      data.preferred_titles != null ? JSON.stringify(data.preferred_titles) : null,
      data.location ?? null,
      data.work_authorization ?? null,
      data.remote_preference !== undefined ? data.remote_preference : null,
      data.open_to_relocation !== undefined ? data.open_to_relocation : null,
    ],
  )

  const updated = await pool.query(
    `SELECT id, headline, summary, preferred_titles, location, work_authorization,
            remote_preference, open_to_relocation, last_user_edit, created_at
     FROM vault_profile WHERE id = 1`,
  )
  return c.json(updated.rows[0], 200)
})

export default vault
