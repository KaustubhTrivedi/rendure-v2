import { Hono } from 'hono'
import { z } from 'zod'
import { pool } from '../db.js'
import { httpError } from '../errors.js'
import { assertTrustedEvidenceWriteAllowed, GuardrailViolation } from '../safety-guardrails.js'

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

const createSourceSchema = z
  .object({
    source_type: z.enum(['resume', 'linkedin', 'github', 'portfolio', 'manual', 'other']),
    source_reference: z.string().min(1).nullable().optional(),
    extracted_at: z.string().datetime().nullable().optional(),
    manual_entry: z.boolean().optional(),
    manual_entry_reason: z.string().min(1).nullable().optional(),
  })
  .strict()

const patchSourceSchema = createSourceSchema.partial().strict()

const entityConfigs = {
  roles: {
    table: 'vault_roles',
    recordType: 'role',
    notFound: 'Role not found.',
    schema: z.object({
      company: z.string().min(1),
      title: z.string().min(1),
      employment_type: z.enum(['full_time', 'part_time', 'contract', 'freelance', 'internship']).nullable().optional(),
      start_date: z.string().nullable().optional(),
      end_date: z.string().nullable().optional(),
      location: z.string().nullable().optional(),
      level: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
      manual_entry: z.boolean().optional(),
      manual_entry_reason: z.string().min(1).nullable().optional(),
    }).strict(),
    columns: ['company', 'title', 'employment_type', 'start_date', 'end_date', 'location', 'level', 'description', 'manual_entry', 'manual_entry_reason'],
    jsonbColumns: [],
  },
  projects: {
    table: 'vault_projects',
    recordType: 'project',
    notFound: 'Project not found.',
    schema: z.object({
      title: z.string().min(1),
      role_id: z.string().uuid().nullable().optional(),
      start_date: z.string().nullable().optional(),
      end_date: z.string().nullable().optional(),
      domain: z.string().nullable().optional(),
      tech_stack: z.array(z.string().min(1)).optional(),
      description: z.string().nullable().optional(),
      outcomes: z.string().nullable().optional(),
      manual_entry: z.boolean().optional(),
      manual_entry_reason: z.string().min(1).nullable().optional(),
    }).strict(),
    columns: ['title', 'role_id', 'start_date', 'end_date', 'domain', 'tech_stack', 'description', 'outcomes', 'manual_entry', 'manual_entry_reason'],
    jsonbColumns: ['tech_stack'],
  },
  achievements: {
    table: 'vault_achievements',
    recordType: 'achievement',
    notFound: 'Achievement not found.',
    schema: z.object({
      statement: z.string().min(1),
      role_id: z.string().uuid().nullable().optional(),
      project_id: z.string().uuid().nullable().optional(),
      metrics: z.record(z.string(), z.unknown()).nullable().optional(),
      related_skills: z.array(z.string().min(1)).optional(),
      manual_entry: z.boolean().optional(),
      manual_entry_reason: z.string().min(1).nullable().optional(),
    }).strict(),
    columns: ['statement', 'role_id', 'project_id', 'metrics', 'related_skills', 'manual_entry', 'manual_entry_reason'],
    jsonbColumns: ['metrics', 'related_skills'],
  },
  skills: {
    table: 'vault_skills',
    recordType: 'skill',
    notFound: 'Skill not found.',
    schema: z.object({
      canonical_name: z.string().min(1),
      category: z.enum(['language', 'framework', 'cloud', 'tooling', 'domain', 'soft_skill']),
      manual_entry: z.boolean().optional(),
      manual_entry_reason: z.string().min(1).nullable().optional(),
    }).strict(),
    columns: ['canonical_name', 'category', 'manual_entry', 'manual_entry_reason'],
    jsonbColumns: [],
  },
  certifications: {
    table: 'vault_certifications',
    recordType: 'certification',
    notFound: 'Certification not found.',
    schema: z.object({
      name: z.string().min(1),
      issuer: z.string().nullable().optional(),
      issued_date: z.string().nullable().optional(),
      expiry_date: z.string().nullable().optional(),
      manual_entry: z.boolean().optional(),
      manual_entry_reason: z.string().min(1).nullable().optional(),
    }).strict(),
    columns: ['name', 'issuer', 'issued_date', 'expiry_date', 'manual_entry', 'manual_entry_reason'],
    jsonbColumns: [],
  },
  stories: {
    table: 'vault_stories',
    recordType: 'story',
    notFound: 'Story not found.',
    schema: z.object({
      title: z.string().min(1),
      situation: z.string().nullable().optional(),
      task: z.string().nullable().optional(),
      action: z.string().nullable().optional(),
      result: z.string().nullable().optional(),
      tags: z.array(z.string().min(1)).optional(),
      manual_entry: z.boolean().optional(),
      manual_entry_reason: z.string().min(1).nullable().optional(),
    }).strict(),
    columns: ['title', 'situation', 'task', 'action', 'result', 'tags', 'manual_entry', 'manual_entry_reason'],
    jsonbColumns: ['tags'],
  },
} as const

type EntityName = keyof typeof entityConfigs
type EntityConfig = (typeof entityConfigs)[EntityName]

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

function entityValues(data: Record<string, unknown>, config: EntityConfig) {
  return config.columns.map((column) => {
    const value = data[column]
    if (config.jsonbColumns.includes(column as never)) {
      return value !== undefined && value !== null ? JSON.stringify(value) : null
    }
    if (column === 'manual_entry') {
      return value ?? false
    }
    return value ?? null
  })
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

vault.post('/sources', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return httpError(c, 400, 'bad_request', 'Request body must be a JSON object.')
  }

  const parsed = createSourceSchema.safeParse(body)
  if (!parsed.success) {
    return httpError(c, 422, 'validation_failed', 'Invalid source artifact.', {
      fields: validationFields(parsed.error),
    })
  }

  const data = parsed.data
  const result = await pool.query(
    `INSERT INTO source_artifacts (
       source_type, source_reference, extracted_at,
       approval_state, manual_entry, manual_entry_reason
     ) VALUES ($1, $2, $3, 'pending', $4, $5)
     RETURNING id, source_type, source_reference, extracted_at, approval_state,
               manual_entry, manual_entry_reason, last_user_edit, created_at`,
    [
      data.source_type,
      data.source_reference ?? null,
      data.extracted_at ?? null,
      data.manual_entry ?? false,
      data.manual_entry_reason ?? null,
    ],
  )

  return c.json(result.rows[0], 201)
})

vault.get('/sources', async (c) => {
  const filter = approvalReadFilter(c.req.query('state'))
  const result = await pool.query(
    `SELECT id, source_type, source_reference, extracted_at, approval_state,
            manual_entry, manual_entry_reason, last_user_edit, created_at
     FROM source_artifacts
     WHERE ${filter}
     ORDER BY created_at DESC`,
    [],
  )
  return c.json(result.rows)
})

vault.get('/sources/:id', async (c) => {
  const result = await pool.query(
    `SELECT id, source_type, source_reference, extracted_at, approval_state,
            manual_entry, manual_entry_reason, last_user_edit, created_at
     FROM source_artifacts WHERE id = $1`,
    [c.req.param('id')],
  )
  if (result.rows.length === 0) {
    return httpError(c, 404, 'not_found', 'Source artifact not found.')
  }
  return c.json(result.rows[0])
})

vault.patch('/sources/:id', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return httpError(c, 400, 'bad_request', 'Request body must be a JSON object.')
  }

  const parsed = patchSourceSchema.safeParse(body)
  if (!parsed.success) {
    return httpError(c, 422, 'validation_failed', 'Invalid source artifact.', {
      fields: validationFields(parsed.error),
    })
  }

  const data = parsed.data
  const result = await pool.query(
    `UPDATE source_artifacts SET
       source_type         = COALESCE($2::text, source_type),
       source_reference    = COALESCE($3::text, source_reference),
       extracted_at        = COALESCE($4::timestamptz, extracted_at),
       manual_entry        = COALESCE($5::boolean, manual_entry),
       manual_entry_reason = COALESCE($6::text, manual_entry_reason),
       last_user_edit      = NOW()
     WHERE id = $1
     RETURNING id, source_type, source_reference, extracted_at, approval_state,
               manual_entry, manual_entry_reason, last_user_edit, created_at`,
    [
      c.req.param('id'),
      data.source_type ?? null,
      data.source_reference ?? null,
      data.extracted_at ?? null,
      data.manual_entry !== undefined ? data.manual_entry : null,
      data.manual_entry_reason ?? null,
    ],
  )
  if (result.rows.length === 0) {
    return httpError(c, 404, 'not_found', 'Source artifact not found.')
  }
  return c.json(result.rows[0])
})

vault.delete('/sources/:id', async (c) => {
  const id = c.req.param('id')
  const current = await pool.query(
    `SELECT id, approval_state FROM source_artifacts WHERE id = $1`,
    [id],
  )
  if (current.rows.length === 0) {
    return httpError(c, 404, 'not_found', 'Source artifact not found.')
  }

  if (['approved', 'edited'].includes(current.rows[0].approval_state)) {
    return httpError(c, 409, 'conflict', 'Cannot delete an approved source artifact.')
  }

  await pool.query(`DELETE FROM source_artifacts WHERE id = $1`, [id])
  return c.body(null, 204)
})

for (const [path, config] of Object.entries(entityConfigs) as [EntityName, EntityConfig][]) {
  vault.post(`/${path}`, async (c) => {
    const body = await c.req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return httpError(c, 400, 'bad_request', 'Request body must be a JSON object.')
    }

    const parsed = config.schema.safeParse(body)
    if (!parsed.success) {
      return httpError(c, 422, 'validation_failed', `Invalid vault ${path} record.`, {
        fields: validationFields(parsed.error),
      })
    }

    const columns = config.columns
    const placeholders = columns.map((column, index) => {
      const marker = `$${index + 1}`
      return config.jsonbColumns.includes(column as never) ? `${marker}::jsonb` : marker
    })
    const result = await pool.query(
      `INSERT INTO ${config.table} (${columns.join(', ')}, approval_state)
       VALUES (${placeholders.join(', ')}, 'pending')
       RETURNING *`,
      entityValues(parsed.data, config),
    )
    return c.json(result.rows[0], 201)
  })

  vault.get(`/${path}`, async (c) => {
    const result = await pool.query(
      `SELECT * FROM ${config.table}
       WHERE ${approvalReadFilter(c.req.query('state'))}
       ORDER BY created_at DESC`,
      [],
    )
    return c.json(result.rows)
  })

  vault.delete(`/${path}/:id`, async (c) => {
    const id = c.req.param('id')
    const current = await pool.query(
      `SELECT id, approval_state FROM ${config.table} WHERE id = $1`,
      [id],
    )
    if (current.rows.length === 0) {
      return httpError(c, 404, 'not_found', config.notFound)
    }

    if (['approved', 'edited'].includes(current.rows[0].approval_state)) {
      return httpError(c, 409, 'conflict', `Cannot delete an approved ${config.recordType}.`)
    }

    await pool.query(`DELETE FROM ${config.table} WHERE id = $1`, [id])
    return c.body(null, 204)
  })
}

vault.post('/roles/:id/approve', async (c) => {
  const id = c.req.param('id')
  const role = await pool.query(
    `SELECT id, approval_state, manual_entry, manual_entry_reason
     FROM vault_roles WHERE id = $1`,
    [id],
  )
  if (role.rows.length === 0) {
    return httpError(c, 404, 'not_found', 'Role not found.')
  }

  const provenance = await pool.query(
    `SELECT source_artifact_id FROM record_provenance
     WHERE record_type = 'role' AND record_id = $1`,
    [id],
  )

  try {
    assertTrustedEvidenceWriteAllowed({
      initiatedBy: 'user',
      approvalState: 'approved',
      sourceArtifactIds: provenance.rows.map((row: { source_artifact_id: string }) => row.source_artifact_id),
      manualEntry: role.rows[0].manual_entry ?? false,
      manualEntryReason: role.rows[0].manual_entry_reason ?? undefined,
    })
  } catch (err) {
    if (err instanceof GuardrailViolation) {
      return httpError(c, 422, 'validation_failed', err.message, { detail: err.code })
    }
    throw err
  }

  const updated = await pool.query(
    `UPDATE vault_roles SET approval_state = 'approved', last_user_edit = NOW()
     WHERE id = $1
     RETURNING *`,
    [id],
  )
  return c.json(updated.rows[0], 200)
})

export default vault
