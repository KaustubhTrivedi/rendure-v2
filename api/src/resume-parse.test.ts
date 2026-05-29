import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { pool } from './db.js'
import { decrypt } from './crypto.js'
import { parseResumeWithLLM } from './resume-parse.js'

vi.mock('./db.js', () => ({
  pool: { query: vi.fn() },
}))

vi.mock('./crypto.js', () => ({
  decrypt: vi.fn(),
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readFile: vi.fn(),
  }
})

const query = vi.mocked(pool.query)
const mockedDecrypt = vi.mocked(decrypt)
const mockedReadFile = vi.mocked(readFile)

const parsedJson = {
  full_name: 'Ada Lovelace',
  email: 'ada@example.com',
  phone: null,
  location: 'London',
  linkedin_url: null,
  website_url: null,
  summary: 'Computing pioneer.',
  years_experience: 10,
  target_seniority: 'senior',
  highlight_skills: ['Analysis'],
  preferred_industries: ['Technology'],
}

function jwt(payload: Record<string, unknown>) {
  return [
    Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'sig',
  ].join('.')
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('fetch', vi.fn())
  delete process.env.CODEX_AUTH_FILE
})

describe('parseResumeWithLLM', () => {
  it('uses Codex OAuth when selected and connected', async () => {
    const accessToken = jwt({
      exp: Math.floor(Date.now() / 1000) + 3600,
      'https://api.openai.com/auth': { chatgpt_account_id: 'acct_123' },
    })
    query.mockResolvedValueOnce({
      rows: [{
        llm_provider: 'codex-oauth',
        preferred_model: 'gpt-5.5',
        openrouter_api_key_enc: 'encrypted-key',
      }],
    } as never)
    mockedReadFile.mockResolvedValue(JSON.stringify({
      tokens: { access_token: accessToken, account_id: 'acct_123' },
    }))
    vi.mocked(fetch).mockResolvedValue(new Response([
      'event: response.output_text.delta',
      `data: ${JSON.stringify({ delta: JSON.stringify(parsedJson) })}`,
      '',
      'event: response.completed',
      'data: {}',
      '',
    ].join('\n'), { status: 200 }) as never)

    const parsed = await parseResumeWithLLM('Resume text long enough for parsing')

    expect(parsed.full_name).toBe('Ada Lovelace')
    expect(fetch).toHaveBeenCalledWith(
      'https://chatgpt.com/backend-api/codex/responses',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: `Bearer ${accessToken}`,
          'chatgpt-account-id': 'acct_123',
        }),
      }),
    )
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)
    expect(body.model).toBe('gpt-5.5')
    expect(body.stream).toBe(true)
    expect(body.store).toBe(false)
    expect(body.instructions).toBe("")
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('max_output_tokens')
    expect(body).not.toHaveProperty('max_tokens')
    expect(body).not.toHaveProperty('messages')
    expect(body.input).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: expect.stringContaining('Resume text long enough for parsing'),
          },
        ],
      },
    ])
  })

  it('falls back to OpenRouter when Codex OAuth is selected but not connected', async () => {
    query.mockResolvedValueOnce({
      rows: [{
        llm_provider: 'codex-oauth',
        preferred_model: 'openai/gpt-5.5',
        openrouter_api_key_enc: 'encrypted-key',
      }],
    } as never)
    mockedReadFile.mockRejectedValue(new Error('missing auth'))
    mockedDecrypt.mockReturnValue('openrouter-key')
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(parsedJson) } }],
    }), { status: 200 }) as never)

    const parsed = await parseResumeWithLLM('Resume text long enough for parsing')

    expect(parsed.email).toBe('ada@example.com')
    expect(mockedDecrypt).toHaveBeenCalledWith('encrypted-key')
    expect(fetch).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer openrouter-key',
        }),
      }),
    )
  })

  it('reprompts Codex with a stricter compact schema when the first response is truncated JSON', async () => {
    const accessToken = jwt({
      exp: Math.floor(Date.now() / 1000) + 3600,
      'https://api.openai.com/auth': { chatgpt_account_id: 'acct_123' },
    })
    query.mockResolvedValueOnce({
      rows: [{
        llm_provider: 'codex-oauth',
        preferred_model: 'gpt-5.5',
        openrouter_api_key_enc: null,
      }],
    } as never)
    mockedReadFile.mockResolvedValue(JSON.stringify({
      tokens: { access_token: accessToken, account_id: 'acct_123' },
    }))
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response([
        'event: response.output_text.delta',
        'data: {"delta":"{\\"full_name\\":\\"Ada Lovelace\\",\\"email\\":\\"ada@example.com\\"" }',
        '',
      ].join('\n'), { status: 200 }) as never)
      .mockResolvedValueOnce(new Response([
        'event: response.output_text.delta',
        `data: ${JSON.stringify({ delta: JSON.stringify(parsedJson) })}`,
        '',
      ].join('\n'), { status: 200 }) as never)

    const parsed = await parseResumeWithLLM('Resume text long enough for parsing')

    expect(parsed.full_name).toBe('Ada Lovelace')
    expect(fetch).toHaveBeenCalledTimes(2)
    const retryBody = JSON.parse(vi.mocked(fetch).mock.calls[1][1]?.body as string)
    expect(retryBody.input[0].content[0].text).toContain('Return minified JSON only')
    expect(retryBody.input[0].content[0].text).toContain('Omit website_url unless explicitly present')
  })

  it('returns deterministic contact fields when Codex responses are truncated twice', async () => {
    const accessToken = jwt({
      exp: Math.floor(Date.now() / 1000) + 3600,
      'https://api.openai.com/auth': { chatgpt_account_id: 'acct_123' },
    })
    query.mockResolvedValueOnce({
      rows: [{
        llm_provider: 'codex-oauth',
        preferred_model: 'gpt-5.5',
        openrouter_api_key_enc: null,
      }],
    } as never)
    mockedReadFile.mockResolvedValue(JSON.stringify({
      tokens: { access_token: accessToken, account_id: 'acct_123' },
    }))
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('data: {"delta":"{\\"full_name\\":\\"Kaustubh"}\n\n', { status: 200 }) as never)
      .mockResolvedValueOnce(new Response('data: {"delta":"{\\"full_name\\":\\"Kaustubh"}\n\n', { status: 200 }) as never)

    const parsed = await parseResumeWithLLM([
      'Kaustubh Trivedi',
      'kaus12tri@gmail.com | 089 495 4389 | Dublin, Ireland',
      'LinkedIn: https://linkedin.com/in/kaustubhtrivedi07-software-engineer',
      'Senior software engineer with TypeScript and Python experience.',
    ].join('\n'))

    expect(parsed.full_name).toBe('Kaustubh Trivedi')
    expect(parsed.email).toBe('kaus12tri@gmail.com')
    expect(parsed.phone).toBe('089 495 4389')
    expect(parsed.location).toBe('Dublin, Ireland')
  })
})
