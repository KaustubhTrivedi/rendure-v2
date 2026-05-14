import { Hono } from 'hono'
import { z } from 'zod'
import { pool } from '../db.js'
import { encrypt } from '../crypto.js'
import { httpError } from '../errors.js'

const profile = new Hono()

const SELECT_COLUMNS = `
  display_name,
  openrouter_api_key_enc IS NOT NULL AS api_key_configured,
  qa_threshold,
  max_iterations,
  preferred_model,
  target_seniority,
  highlight_skills,
  preferred_industries,
  tailor_style_notes,
  notify_email,
  notify_webhook_url,
  notify_telegram_chat_id,
  created_at,
  updated_at
`

/**
 * Zod schema for PATCH /profile.
 *
 * Every field is optional — only present fields are updated. `.strict()`
 * rejects unknown keys so a typo can't accidentally clobber a column.
 *
 * Field paths in errors map 1:1 to column names for the `fields[]` response.
 */
export const patchProfileSchema = z
  .object({
    display_name: z.string().trim().min(1).optional(),
    target_seniority: z
      .enum(['junior', 'mid', 'senior', 'lead', 'staff', 'principal'])
      .optional(),
    highlight_skills: z.array(z.string().min(1)).optional(),
    preferred_industries: z.array(z.string().min(1)).optional(),
    tailor_style_notes: z.string().nullable().optional(),
    qa_threshold: z.number().min(0).max(1).optional(),
    max_iterations: z.number().int().min(1).max(20).optional(),
    preferred_model: z.string().min(1).optional(),
    notify_telegram_chat_id: z.string().nullable().optional(),
    notify_webhook_url: z.string().url().nullable().optional(),
  })
  .strict()

/**
 * POST /profile
 *
 * Create the user profile. Fails if one already exists.
 */
profile.post('/', async (c) => {
  const body = await c.req.json().catch(() => null)

  if (!body || typeof body.display_name !== 'string' || !body.display_name.trim()) {
    return httpError(
      c,
      400,
      'bad_request',
      'display_name is required and must be a non-empty string.',
    )
  }

  const existing = await pool.query('SELECT id FROM user_profile WHERE id = 1')
  if (existing.rows.length > 0) {
    return httpError(c, 409, 'conflict', 'Profile already exists. Use PATCH /profile to update it.')
  }

  await pool.query(`INSERT INTO user_profile (id, display_name) VALUES (1, $1)`, [
    body.display_name.trim(),
  ])

  return c.json({ ok: true }, 201)
})

/**
 * GET /profile
 */
profile.get('/', async (c) => {
  const result = await pool.query(
    `SELECT ${SELECT_COLUMNS} FROM user_profile WHERE id = 1`,
  )

  if (result.rows.length === 0) {
    return httpError(c, 404, 'profile_not_found', 'No profile found. Create one with POST /profile.')
  }

  return c.json(result.rows[0])
})

/**
 * PATCH /profile
 *
 * Partial update of the single-user profile row. Only fields present in the
 * request body are updated. Fields set to `null` clear nullable columns.
 * Returns 404 if no row exists — client must POST /profile first.
 */
profile.patch('/', async (c) => {
  const raw = await c.req.json().catch(() => null)
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return httpError(c, 400, 'bad_request', 'Request body must be a JSON object.')
  }

  const parsed = patchProfileSchema.safeParse(raw)
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }))
    return httpError(c, 400, 'validation_failed', 'Validation failed', { fields })
  }

  const data = parsed.data
  const keys = Object.keys(data) as (keyof typeof data)[]

  // No-op patch: return current state (or 404 if no row).
  if (keys.length === 0) {
    const current = await pool.query(`SELECT ${SELECT_COLUMNS} FROM user_profile WHERE id = 1`)
    if (current.rows.length === 0) {
      return httpError(
        c,
        404,
        'profile_not_found',
        'Profile not found',
        { detail: 'Create one with POST /profile first.' },
      )
    }
    return c.json(current.rows[0])
  }

  const setFragments: string[] = []
  const values: unknown[] = []
  keys.forEach((k, idx) => {
    setFragments.push(`"${k}" = $${idx + 1}`)
    values.push(data[k])
  })

  const result = await pool.query(
    `UPDATE user_profile SET ${setFragments.join(', ')} WHERE id = 1 RETURNING ${SELECT_COLUMNS}`,
    values,
  )

  if (result.rowCount === 0) {
    return httpError(c, 404, 'profile_not_found', 'Profile not found', {
      detail: 'Create one with POST /profile first.',
    })
  }

  return c.json(result.rows[0])
})

/**
 * PUT /profile/api-key
 */
profile.put('/api-key', async (c) => {
  const body = await c.req.json().catch(() => null)

  if (!body || typeof body.api_key !== 'string' || !body.api_key.trim()) {
    return httpError(c, 400, 'bad_request', 'api_key is required and must be a non-empty string.')
  }

  const encrypted = encrypt(body.api_key.trim())

  await pool.query(
    `INSERT INTO user_profile (id, openrouter_api_key_enc)
     VALUES (1, $1)
     ON CONFLICT (id) DO UPDATE SET
       openrouter_api_key_enc = EXCLUDED.openrouter_api_key_enc,
       updated_at = NOW()`,
    [encrypted],
  )

  return c.json({ ok: true })
})

/**
 * GET /profile/api-key
 */
profile.get('/api-key', async (c) => {
  const result = await pool.query(
    `SELECT openrouter_api_key_enc IS NOT NULL AS configured FROM user_profile WHERE id = 1`,
  )
  const configured = result.rows[0]?.configured ?? false
  return c.json({ configured })
})

/**
 * DELETE /profile/api-key
 */
profile.delete('/api-key', async (c) => {
  await pool.query(
    `UPDATE user_profile SET openrouter_api_key_enc = NULL, updated_at = NOW() WHERE id = 1`,
  )
  return c.json({ ok: true })
})

export default profile
