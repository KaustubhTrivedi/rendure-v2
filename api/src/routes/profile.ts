import { Hono } from 'hono'
import { z } from 'zod'
import { pool } from '../db.js'
import { encrypt, decrypt } from '../crypto.js'
import { httpError } from '../errors.js'
import { parseResumeWithLLM, extractPdfText } from '../resume-parse.js'

const profile = new Hono()

const SELECT_COLUMNS = `
  display_name,
  openrouter_api_key_enc IS NOT NULL AS api_key_configured,
  llm_provider,
  qa_threshold,
  max_iterations,
  preferred_model,
  model_job_scout,
  model_resume_tailor,
  model_quality_analyst,
  model_confirmation,
  model_orchestrator,
  target_seniority,
  highlight_skills,
  preferred_industries,
  tailor_style_notes,
  notify_email,
  notify_webhook_url,
  notify_telegram_chat_id,
  resume_text,
  full_name,
  email,
  phone,
  location,
  linkedin_url,
  website_url,
  summary,
  years_experience,
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
    llm_provider: z.enum(['openrouter', 'codex-oauth']).optional(),
    target_seniority: z
      .enum(['junior', 'mid', 'senior', 'lead', 'staff', 'principal'])
      .optional(),
    highlight_skills: z.array(z.string().min(1)).optional(),
    preferred_industries: z.array(z.string().min(1)).optional(),
    tailor_style_notes: z.string().nullable().optional(),
    qa_threshold: z.number().min(0).max(1).optional(),
    max_iterations: z.number().int().min(1).max(20).optional(),
    preferred_model: z.string().min(1).optional(),
    model_job_scout: z.string().min(1).nullable().optional(),
    model_resume_tailor: z.string().min(1).nullable().optional(),
    model_quality_analyst: z.string().min(1).nullable().optional(),
    model_confirmation: z.string().min(1).nullable().optional(),
    model_orchestrator: z.string().min(1).nullable().optional(),
    notify_telegram_chat_id: z.string().nullable().optional(),
    notify_webhook_url: z.string().url().nullable().optional(),
    resume_text: z.string().nullable().optional(),
    full_name: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    location: z.string().nullable().optional(),
    linkedin_url: z.string().nullable().optional(),
    website_url: z.string().nullable().optional(),
    summary: z.string().nullable().optional(),
    years_experience: z.number().int().nullable().optional(),
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

  const JSONB_COLUMNS = new Set(['highlight_skills', 'preferred_industries'])

  const setFragments: string[] = []
  const values: unknown[] = []
  keys.forEach((k, idx) => {
    setFragments.push(`"${k}" = $${idx + 1}`)
    const v = data[k]
    values.push(JSONB_COLUMNS.has(k) && v != null ? JSON.stringify(v) : v)
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

/**
 * GET /profile/models
 *
 * Fetches available models from OpenRouter using the stored API key.
 * Returns the raw model list from OpenRouter's API.
 */
profile.get('/models', async (c) => {
  const result = await pool.query(
    `SELECT openrouter_api_key_enc FROM user_profile WHERE id = 1`,
  )

  if (result.rows.length === 0 || !result.rows[0].openrouter_api_key_enc) {
    return httpError(c, 404, 'not_found', 'API key not configured', {
      detail: 'Set one via PUT /profile/api-key first.',
    })
  }

  let apiKey: string
  try {
    apiKey = decrypt(result.rows[0].openrouter_api_key_enc)
  } catch {
    return httpError(c, 500, 'internal_error', 'Failed to decrypt stored API key.')
  }

  const res = await fetch('https://openrouter.ai/api/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
  })

  if (!res.ok) {
    return httpError(c, 502, 'bad_request', 'OpenRouter request failed', {
      detail: `OpenRouter returned ${res.status}.`,
    })
  }

  const body = (await res.json()) as { data: { id: string; name: string }[] }
  const models = body.data
    .filter((m) => !m.id.endsWith(':free'))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((m) => ({ id: m.id, name: m.name }))

  return c.json(models)
})

/**
 * POST /profile/resume
 *
 * Upload a resume file (PDF, Markdown, or plain text).
 * Extracts text, calls LLM to parse structured profile data, stores both.
 * Returns the parsed profile fields for the frontend to display/edit.
 */
profile.post('/resume', async (c) => {
  const contentType = c.req.header('content-type') ?? ''

  let resumeText: string

  if (contentType.includes('multipart/form-data')) {
    const body = await c.req.parseBody()
    const file = body['file']

    if (!file || typeof file === 'string') {
      return httpError(c, 400, 'bad_request', 'A file upload is required in the "file" field.')
    }

    const filename = file.name?.toLowerCase() ?? ''
    const buffer = Buffer.from(await file.arrayBuffer())

    if (filename.endsWith('.pdf')) {
      try {
        resumeText = await extractPdfText(buffer)
      } catch {
        return httpError(c, 400, 'bad_request', 'Failed to parse PDF. Ensure the file is a valid PDF.')
      }
    } else if (filename.endsWith('.md') || filename.endsWith('.txt') || filename.endsWith('.text')) {
      resumeText = buffer.toString('utf-8')
    } else {
      return httpError(c, 400, 'bad_request', 'Unsupported file type. Upload a PDF, Markdown (.md), or text (.txt) file.')
    }
  } else {
    const body = await c.req.json().catch(() => null)
    if (!body || typeof body.resume_text !== 'string' || !body.resume_text.trim()) {
      return httpError(c, 400, 'bad_request', 'resume_text is required when not uploading a file.')
    }
    resumeText = body.resume_text.trim()
  }

  if (resumeText.trim().length < 50) {
    return httpError(c, 400, 'bad_request', 'Resume text is too short. Please upload a valid resume.')
  }

  // Store the raw resume text
  await pool.query(
    `UPDATE user_profile SET resume_text = $1 WHERE id = 1`,
    [resumeText],
  )

  // Parse with LLM
  let parsed
  try {
    parsed = await parseResumeWithLLM(resumeText)
  } catch (e) {
    return c.json({
      resume_stored: true,
      parsed: null,
      parse_error: e instanceof Error ? e.message : 'Unknown parsing error',
    })
  }

  // Store parsed fields
  await pool.query(
    `UPDATE user_profile SET
       full_name = $1, email = $2, phone = $3, location = $4,
       linkedin_url = $5, website_url = $6, summary = $7,
       years_experience = $8, target_seniority = $9,
       highlight_skills = $10, preferred_industries = $11
     WHERE id = 1`,
    [
      parsed.full_name, parsed.email, parsed.phone, parsed.location,
      parsed.linkedin_url, parsed.website_url, parsed.summary,
      parsed.years_experience, parsed.target_seniority,
      parsed.highlight_skills ? JSON.stringify(parsed.highlight_skills) : null,
      parsed.preferred_industries ? JSON.stringify(parsed.preferred_industries) : null,
    ],
  )

  return c.json({ resume_stored: true, parsed })
})

/**
 * GET /profile/resume
 *
 * Returns the stored resume text, or 404 if none uploaded.
 */
profile.get('/resume', async (c) => {
  const result = await pool.query(
    `SELECT resume_text FROM user_profile WHERE id = 1`,
  )

  if (result.rows.length === 0 || !result.rows[0].resume_text) {
    return httpError(c, 404, 'not_found', 'No resume uploaded yet.')
  }

  return c.text(result.rows[0].resume_text, 200, {
    'Content-Type': 'text/plain; charset=utf-8',
  })
})

export default profile
