import { beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../index.js'
import { pool } from '../db.js'

vi.mock('../db.js', () => ({ pool: { query: vi.fn() } }))

const query = vi.mocked(pool.query)

const API_KEY = 'test-rendure-key'
const AUTH = { 'X-API-Key': API_KEY }

function makeReq(method: string, path: string, body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...AUTH },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

const SOURCE_ROW = {
  id: '11111111-1111-1111-1111-111111111111',
  source_type: 'resume',
  source_reference: 'resume.md',
  extracted_at: '2026-06-01T00:00:00.000Z',
  approval_state: 'pending',
  manual_entry: false,
  manual_entry_reason: null,
  last_user_edit: null,
  created_at: '2026-06-01T00:00:00.000Z',
}

const PROFILE_ROW = {
  id: 1,
  headline: 'Senior Software Engineer',
  summary: 'Builds reliable product systems.',
  preferred_titles: ['Senior Software Engineer'],
  location: 'Remote',
  work_authorization: 'US citizen',
  remote_preference: 'remote',
  open_to_relocation: false,
  last_user_edit: null,
  created_at: '2026-06-01T00:00:00.000Z',
}

const ROLE_ROW = {
  id: '22222222-2222-2222-2222-222222222222',
  company: 'Acme',
  title: 'Senior Engineer',
  approval_state: 'pending',
  manual_entry: false,
  manual_entry_reason: null,
}

const ENTITY_CASES = [
  {
    name: 'roles',
    path: '/vault/roles',
    body: { company: 'Acme', title: 'Senior Engineer' },
    row: ROLE_ROW,
  },
  {
    name: 'projects',
    path: '/vault/projects',
    body: { title: 'Career Vault', tech_stack: ['TypeScript'] },
    row: {
      id: '33333333-3333-3333-3333-333333333333',
      title: 'Career Vault',
      approval_state: 'pending',
      manual_entry: false,
      manual_entry_reason: null,
    },
  },
  {
    name: 'achievements',
    path: '/vault/achievements',
    body: { statement: 'Reduced review time by 30%.', related_skills: ['TypeScript'] },
    row: {
      id: '44444444-4444-4444-4444-444444444444',
      statement: 'Reduced review time by 30%.',
      approval_state: 'pending',
      manual_entry: false,
      manual_entry_reason: null,
    },
  },
  {
    name: 'skills',
    path: '/vault/skills',
    body: { canonical_name: 'TypeScript', category: 'language' },
    row: {
      id: '55555555-5555-5555-5555-555555555555',
      canonical_name: 'TypeScript',
      category: 'language',
      approval_state: 'pending',
      manual_entry: false,
      manual_entry_reason: null,
    },
  },
  {
    name: 'certifications',
    path: '/vault/certifications',
    body: { name: 'AWS Certified Developer', issuer: 'AWS' },
    row: {
      id: '66666666-6666-6666-6666-666666666666',
      name: 'AWS Certified Developer',
      issuer: 'AWS',
      approval_state: 'pending',
      manual_entry: false,
      manual_entry_reason: null,
    },
  },
  {
    name: 'stories',
    path: '/vault/stories',
    body: { title: 'Incident recovery', situation: 'Production incident' },
    row: {
      id: '77777777-7777-7777-7777-777777777777',
      title: 'Incident recovery',
      approval_state: 'pending',
      manual_entry: false,
      manual_entry_reason: null,
    },
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  process.env.RENDURE_API_KEY = API_KEY
})

describe('vault authentication middleware', () => {
  it('returns 401 without api key', async () => {
    const res = await app.fetch(new Request('http://localhost/vault/profile'))
    expect(res.status).toBe(401)
  })
})

describe('POST /vault/sources', () => {
  it('creates a source artifact candidate with pending approval state', async () => {
    query.mockResolvedValueOnce({ rows: [SOURCE_ROW] } as any)

    const res = await app.fetch(
      makeReq('POST', '/vault/sources', {
        source_type: 'resume',
        source_reference: 'resume.md',
        extracted_at: '2026-06-01T00:00:00.000Z',
      }),
    )

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.approval_state).toBe('pending')
    expect(query).toHaveBeenCalledOnce()
  })
})

describe('GET /vault/sources', () => {
  it('returns approved and edited source artifacts by default', async () => {
    query.mockResolvedValueOnce({
      rows: [{ ...SOURCE_ROW, approval_state: 'approved' }],
    } as any)

    const res = await app.fetch(makeReq('GET', '/vault/sources'))
    expect(res.status).toBe(200)
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("approval_state IN ('approved','edited')"),
      expect.any(Array),
    )
  })

  it('returns pending source artifact candidates when state=candidate', async () => {
    query.mockResolvedValueOnce({ rows: [SOURCE_ROW] } as any)

    const res = await app.fetch(makeReq('GET', '/vault/sources?state=candidate'))
    expect(res.status).toBe(200)
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("approval_state = 'pending'"),
      expect.any(Array),
    )
  })
})

describe('DELETE /vault/sources/:id', () => {
  it('blocks deleting an approved source artifact', async () => {
    query.mockResolvedValueOnce({
      rows: [{ ...SOURCE_ROW, approval_state: 'approved' }],
    } as any)

    const res = await app.fetch(makeReq('DELETE', `/vault/sources/${SOURCE_ROW.id}`))
    expect(res.status).toBe(409)
  })
})

describe('GET /vault/profile', () => {
  it('returns the vault profile row', async () => {
    query.mockResolvedValueOnce({ rows: [PROFILE_ROW] } as any)

    const res = await app.fetch(makeReq('GET', '/vault/profile'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.headline).toBe('Senior Software Engineer')
  })
})

describe('PATCH /vault/profile', () => {
  it('updates only provided fields through a COALESCE upsert', async () => {
    query
      .mockResolvedValueOnce({ rows: [] } as any)
      .mockResolvedValueOnce({ rows: [{ ...PROFILE_ROW, headline: 'Staff Engineer' }] } as any)

    const res = await app.fetch(
      makeReq('PATCH', '/vault/profile', { headline: 'Staff Engineer' }),
    )
    expect(res.status).toBe(200)
    expect(query.mock.calls[0][0]).toContain('ON CONFLICT')
    expect(query.mock.calls[0][0]).toContain('COALESCE')
  })

  it('returns 422 for unknown keys', async () => {
    const res = await app.fetch(
      makeReq('PATCH', '/vault/profile', { approval_state: 'approved' }),
    )
    expect(res.status).toBe(422)
  })
})

for (const entity of ENTITY_CASES) {
  describe(`POST /vault/${entity.name}`, () => {
    it('creates an untrusted pending candidate', async () => {
      query.mockResolvedValueOnce({ rows: [entity.row] } as any)

      const res = await app.fetch(makeReq('POST', entity.path, entity.body))
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.approval_state).toBe('pending')
    })
  })

  describe(`GET /vault/${entity.name}`, () => {
    it('returns only approved and edited records by default', async () => {
      query.mockResolvedValueOnce({
        rows: [{ ...entity.row, approval_state: 'approved' }],
      } as any)

      const res = await app.fetch(makeReq('GET', entity.path))
      expect(res.status).toBe(200)
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining("approval_state IN ('approved','edited')"),
        expect.any(Array),
      )
    })
  })

  describe(`DELETE /vault/${entity.name}/:id`, () => {
    it('blocks deleting an approved or edited trusted record', async () => {
      query.mockResolvedValueOnce({
        rows: [{ ...entity.row, approval_state: 'approved' }],
      } as any)

      const res = await app.fetch(makeReq('DELETE', `${entity.path}/${entity.row.id}`))
      expect(res.status).toBe(409)
    })
  })
}

describe('POST /vault/roles/:id/approve', () => {
  it('rejects approve when no provenance and no manual entry exists', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{ ...ROLE_ROW, manual_entry: false, manual_entry_reason: null }],
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any)

    const res = await app.fetch(makeReq('POST', `/vault/roles/${ROLE_ROW.id}/approve`))
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.detail).toBe('evidence_no_provenance')
  })

  it('approves when record provenance exists', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{ ...ROLE_ROW, manual_entry: false, manual_entry_reason: null }],
      } as any)
      .mockResolvedValueOnce({
        rows: [{ source_artifact_id: SOURCE_ROW.id }],
      } as any)
      .mockResolvedValueOnce({
        rows: [{ ...ROLE_ROW, approval_state: 'approved' }],
      } as any)

    const res = await app.fetch(makeReq('POST', `/vault/roles/${ROLE_ROW.id}/approve`))
    expect(res.status).toBe(200)
  })

  it('approves when manual entry metadata exists', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{
          ...ROLE_ROW,
          manual_entry: true,
          manual_entry_reason: 'Added manually from user memory',
        }],
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any)
      .mockResolvedValueOnce({
        rows: [{ ...ROLE_ROW, approval_state: 'approved' }],
      } as any)

    const res = await app.fetch(makeReq('POST', `/vault/roles/${ROLE_ROW.id}/approve`))
    expect(res.status).toBe(200)
  })
})
