import { Hono } from 'hono'
import { pool } from '../db.js'
import { encrypt } from '../crypto.js'

const profile = new Hono()

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
