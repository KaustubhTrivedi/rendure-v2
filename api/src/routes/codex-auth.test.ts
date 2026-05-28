import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { codexAuth } from './codex-auth.js'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readFile: vi.fn(),
  }
})

const mockedReadFile = vi.mocked(readFile)

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('fetch', vi.fn())
  delete process.env.CODEX_AUTH_FILE
  delete process.env.CHATGPT_LOCAL_HOME
  delete process.env.CODEX_HOME
})

describe('GET /profile/codex-auth/models', () => {
  it('returns 404 when Codex auth.json is missing', async () => {
    mockedReadFile.mockRejectedValue(new Error('missing'))

    const res = await codexAuth.request('/models')

    expect(res.status).toBe(404)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.code).toBe('not_found')
  })

  it('fetches OpenAI chat-capable models using the Codex access token', async () => {
    process.env.CODEX_AUTH_FILE = '/tmp/codex-auth.json'
    mockedReadFile.mockResolvedValue(JSON.stringify({
      tokens: { access_token: 'codex-access-token' },
    }))
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      data: [
        { id: 'whisper-1', object: 'model' },
        { id: 'gpt-4.1', object: 'model' },
        { id: 'o4-mini', object: 'model' },
        { id: 'text-embedding-3-large', object: 'model' },
        { id: 'o3', object: 'model' },
        { id: 'o1-preview', object: 'model' },
      ],
    }), { status: 200 }) as never)

    const res = await codexAuth.request('/models')

    expect(res.status).toBe(200)
    expect(fetch).toHaveBeenCalledWith('https://api.openai.com/v1/models', {
      headers: { Authorization: 'Bearer codex-access-token' },
    })
    await expect(res.json()).resolves.toEqual([
      { id: 'gpt-4.1', name: 'gpt-4.1' },
      { id: 'o1-preview', name: 'o1-preview' },
      { id: 'o3', name: 'o3' },
      { id: 'o4-mini', name: 'o4-mini' },
    ])
  })

  it('falls back to known ChatGPT models when Codex token cannot read /v1/models', async () => {
    mockedReadFile.mockResolvedValue(JSON.stringify({
      tokens: { access_token: 'codex-access-token' },
    }))
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      error: {
        message: 'Missing scopes: api.model.read',
      },
    }), { status: 403 }) as never)

    const res = await codexAuth.request('/models')

    expect(res.status).toBe(200)
    const body = (await res.json()) as Array<{ id: string; name: string }>
    expect(body.map((m) => m.id)).toContain('gpt-5.5')
    expect(body.map((m) => m.id)).toContain('gpt-5.4')
    expect(body.map((m) => m.id)).toContain('gpt-4.1')
    expect(body.map((m) => m.id)).toContain('o4-mini')
    expect(body.every((m) => m.name.length > 0)).toBe(true)
  })
})
