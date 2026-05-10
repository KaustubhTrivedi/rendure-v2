import { Hono } from 'hono'
import { pool } from '../db.js'
import { encrypt } from '../crypto.js'

const profile = new Hono()

/**
 * POST /profile
 *
 * Create the user profile. Fails if one already exists.
 *
 * Body: { "display_name": "Alice" }
 * Response 201: { "ok": true }
 * Response 409: profile already exists
 */
profile.post('/', async (c) => {
  const body = await c.req.json().catch(() => null)

  if (!body || typeof body.display_name !== 'string' || !body.display_name.trim()) {
    return c.json({ error: 'display_name is required and must be a non-empty string.' }, 400)
  }

  const existing = await pool.query('SELECT id FROM user_profile WHERE id = 1')
  if (existing.rows.length > 0) {
    return c.json({ error: 'Profile already exists. Use PATCH /profile to update it.' }, 409)
  }

  await pool.query(
    `INSERT INTO user_profile (id, display_name) VALUES (1, $1)`,
    [body.display_name.trim()]
  )

  return c.json({ ok: true }, 201)
})

/**
 * GET /profile
 *
 * Return the user profile. The API key is never returned — only whether one is configured.
 *
 * Response 200: profile object
 * Response 404: no profile exists yet
 */
profile.get('/', async (c) => {
  const result = await pool.query(
    `SELECT
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
       created_at,
       updated_at
     FROM user_profile WHERE id = 1`
  )

  if (result.rows.length === 0) {
    return c.json({ error: 'No profile found. Create one with POST /profile.' }, 404)
  }

  return c.json(result.rows[0])
})

/**
 * PUT /profile/api-key
 *
 * Store (or replace) the user's OpenRouter API key.
 * The key is encrypted with AES-256-GCM before being written to the DB.
 *
 * Body: { "api_key": "sk-or-..." }
 * Response 200: { "ok": true }
 */
profile.put('/api-key', async (c) => {
  const body = await c.req.json().catch(() => null)

  if (!body || typeof body.api_key !== 'string' || !body.api_key.trim()) {
    return c.json({ error: 'api_key is required and must be a non-empty string.' }, 400)
  }

  const encrypted = encrypt(body.api_key.trim())

  await pool.query(
    `INSERT INTO user_profile (id, openrouter_api_key_enc)
     VALUES (1, $1)
     ON CONFLICT (id) DO UPDATE SET
       openrouter_api_key_enc = EXCLUDED.openrouter_api_key_enc,
       updated_at = NOW()`,
    [encrypted]
  )

  return c.json({ ok: true })
})

/**
 * GET /profile/api-key
 *
 * Returns whether an API key is currently stored — never returns the key itself.
 *
 * Response 200: { "configured": true | false }
 */
profile.get('/api-key', async (c) => {
  const result = await pool.query(
    `SELECT openrouter_api_key_enc IS NOT NULL AS configured
     FROM user_profile WHERE id = 1`
  )

  const configured = result.rows[0]?.configured ?? false
  return c.json({ configured })
})

/**
 * DELETE /profile/api-key
 *
 * Remove the stored API key.
 *
 * Response 200: { "ok": true }
 */
profile.delete('/api-key', async (c) => {
  await pool.query(
    `UPDATE user_profile SET openrouter_api_key_enc = NULL, updated_at = NOW()
     WHERE id = 1`
  )
  return c.json({ ok: true })
})

export default profile
