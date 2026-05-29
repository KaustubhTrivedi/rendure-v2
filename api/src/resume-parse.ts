import { z } from 'zod'
import { pool } from './db.js'
import { decrypt } from './crypto.js'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { isCodexOAuthEnabled } from './routes/codex-auth.js'

const DEFAULT_OPENROUTER_PARSE_MODEL = 'google/gemini-2.0-flash-001'
const DEFAULT_CODEX_PARSE_MODEL = 'gpt-5.5'
const CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses'

const coerceString = z.any().transform((v) =>
  v == null ? null : typeof v === 'string' ? v : String(v),
)

const coerceStringArray = z.any().transform((v) => {
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : String(x)))
  if (typeof v === 'string') return v.split(',').map((s) => s.trim()).filter(Boolean)
  return []
})

const SENIORITY_LEVELS = ['junior', 'mid', 'senior', 'lead', 'staff', 'principal'] as const

export const parsedProfileSchema = z.object({
  full_name: coerceString,
  email: coerceString,
  phone: coerceString,
  location: coerceString,
  linkedin_url: coerceString,
  website_url: coerceString,
  summary: coerceString,
  years_experience: z.any().transform((v) => {
    if (v == null) return null
    const n = Number(v)
    return Number.isFinite(n) ? Math.round(n) : null
  }),
  target_seniority: z.any().transform((v) => {
    if (v == null) return null
    const s = String(v).toLowerCase().trim()
    return (SENIORITY_LEVELS as readonly string[]).includes(s)
      ? (s as (typeof SENIORITY_LEVELS)[number])
      : null
  }),
  highlight_skills: coerceStringArray,
  preferred_industries: coerceStringArray,
}).passthrough()

export type ParsedProfile = z.infer<typeof parsedProfileSchema>

const PARSE_PROMPT = `You are a resume parser. Extract structured profile data from the resume text below.

Return minified JSON only. No markdown fences, no explanation, no whitespace formatting.
Keep values short: summary max 120 chars, highlight_skills max 8, preferred_industries max 3.
Use this exact schema:

{
  "full_name": string or null,
  "email": string or null,
  "phone": string or null,
  "location": string or null (city, state/country),
  "linkedin_url": string or null,
  "website_url": string or null (portfolio/personal site, not LinkedIn),
  "summary": string or null (professional summary/objective, 1-3 sentences),
  "years_experience": number or null (total years, estimated from work history dates),
  "target_seniority": "junior" | "mid" | "senior" | "lead" | "staff" | "principal" | null (inferred from titles/experience),
  "highlight_skills": string[] (top 10-15 technical and professional skills),
  "preferred_industries": string[] (industries from work history, max 5)
}

Rules:
- Extract only what is explicitly stated or clearly inferrable
- For years_experience, calculate from earliest to latest work dates
- For target_seniority, infer from most recent job title and total experience
- For highlight_skills, prioritize skills mentioned multiple times or in prominent positions
- For preferred_industries, derive from company types in work history
- Return null for fields you cannot determine
- Return empty arrays if no items found

Resume text:
`

const COMPACT_PARSE_PROMPT = `Return minified JSON only. No markdown, no prose.
Schema keys: full_name,email,phone,location,linkedin_url,website_url,summary,years_experience,target_seniority,highlight_skills,preferred_industries.
Omit website_url unless explicitly present as a personal website distinct from LinkedIn.
Keep summary under 80 chars. Max 6 highlight_skills. Max 3 preferred_industries.
Use null for unknown scalar fields and [] for unknown arrays.
Allowed target_seniority values: junior,mid,senior,lead,staff,principal,null.
Resume text:
`

function codexAuthFileCandidates(): string[] {
  return [
    process.env.CODEX_AUTH_FILE,
    process.env.CHATGPT_LOCAL_HOME ? join(process.env.CHATGPT_LOCAL_HOME, 'auth.json') : null,
    process.env.CODEX_HOME ? join(process.env.CODEX_HOME, 'auth.json') : null,
    join(homedir(), '.chatgpt-local', 'auth.json'),
    join(homedir(), '.codex', 'auth.json'),
  ].filter((p): p is string => typeof p === 'string' && p.length > 0)
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    return JSON.parse(Buffer.from(parts[1]!, 'base64url').toString()) as Record<string, unknown>
  } catch {
    return null
  }
}

function accountIdFromToken(token: string): string | null {
  const claims = decodeJwtPayload(token)
  const authClaim = claims?.['https://api.openai.com/auth'] as Record<string, unknown> | undefined
  const accountId = authClaim?.chatgpt_account_id
  return typeof accountId === 'string' && accountId.length > 0 ? accountId : null
}

async function readConnectedCodexAuth(): Promise<{ accessToken: string; accountId: string } | null> {
  for (const candidate of codexAuthFileCandidates()) {
    try {
      const raw = await readFile(candidate, 'utf-8')
      const data = JSON.parse(raw) as {
        tokens?: { access_token?: string; account_id?: string }
      }
      const accessToken = data.tokens?.access_token
      if (!accessToken) continue

      const claims = decodeJwtPayload(accessToken)
      if (claims && typeof claims.exp === 'number' && claims.exp * 1000 < Date.now()) {
        continue
      }

      const accountId = data.tokens?.account_id ?? accountIdFromToken(accessToken)
      if (!accountId) continue

      return { accessToken, accountId }
    } catch {
      continue
    }
  }

  return null
}

function parseJsonProfile(raw: string): ParsedProfile {
  const jsonMatch = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonMatch)
  } catch {
    throw new Error(`LLM returned invalid JSON: ${raw.slice(0, 200)}`)
  }

  const validated = parsedProfileSchema.safeParse(parsed)
  if (!validated.success) {
    throw new Error(`LLM output failed validation: ${validated.error.message}`)
  }

  return validated.data
}

function deterministicResumeParse(resumeText: string): ParsedProfile {
  const lines = resumeText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const email = resumeText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? null
  const phone = resumeText.match(/(?:\+?\d[\d\s().-]{7,}\d)/)?.[0]?.trim() ?? null
  const linkedin_url = resumeText.match(/https?:\/\/(?:www\.)?linkedin\.com\/[^\s),]+/i)?.[0] ?? null
  const website_url = resumeText
    .match(/https?:\/\/(?![^/\s]*linkedin\.com)[^\s),]+/i)?.[0] ?? null

  const firstUsefulLine = lines.find((line) =>
    !line.includes('@')
    && !/linkedin\.com/i.test(line)
    && !/https?:\/\//i.test(line)
    && /[A-Za-z]/.test(line)
    && line.length <= 80
  )

  const locationLine = lines.find((line) =>
    /(Ireland|Dublin|United Kingdom|UK|United States|USA|Remote)/i.test(line)
  )
  const location = locationLine
    ?.split('|')
    .map((part) => part.trim())
    .find((part) => /(Ireland|Dublin|United Kingdom|UK|United States|USA|Remote)/i.test(part))
    ?? null

  const skillCandidates = [
    'TypeScript', 'JavaScript', 'Python', 'React', 'Node.js', 'PostgreSQL',
    'Docker', 'Kubernetes', 'AWS', 'GCP', 'Azure', 'LangChain', 'OpenAI',
  ]
  const highlight_skills = skillCandidates.filter((skill) =>
    new RegExp(`\\b${skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(resumeText)
  ).slice(0, 8)

  return parsedProfileSchema.parse({
    full_name: firstUsefulLine ?? null,
    email,
    phone,
    location,
    linkedin_url,
    website_url,
    summary: null,
    years_experience: null,
    target_seniority: null,
    highlight_skills,
    preferred_industries: [],
  })
}

function extractCodexOutputText(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const response = data as {
    output_text?: unknown
    output?: Array<{ type?: string; content?: Array<{ type?: string; text?: unknown }> }>
  }
  if (typeof response.output_text === 'string') return response.output_text

  for (const item of response.output ?? []) {
    if (item.type !== 'message') continue
    for (const part of item.content ?? []) {
      if (part.type === 'output_text' && typeof part.text === 'string') {
        return part.text
      }
    }
  }

  return ''
}

function extractCodexStreamText(streamText: string): string {
  let output = ''
  for (const line of streamText.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue
    const data = line.slice('data:'.length).trim()
    if (!data || data === '[DONE]') continue

    try {
      const event = JSON.parse(data) as {
        delta?: unknown
        text?: unknown
        item?: unknown
        response?: unknown
      }
      if (typeof event.delta === 'string') {
        output += event.delta
      } else if (typeof event.text === 'string') {
        output += event.text
      } else {
        output += extractCodexOutputText(event)
      }
    } catch {
      continue
    }
  }

  return output
}

async function parseWithCodexOAuth(
  resumeText: string,
  model: string,
  auth: { accessToken: string; accountId: string },
): Promise<ParsedProfile> {
  const callCodex = async (prompt: string): Promise<string> => {
  const res = await fetch(CODEX_RESPONSES_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${auth.accessToken}`,
      'chatgpt-account-id': auth.accountId,
      'OpenAI-Beta': 'responses=experimental',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: prompt + resumeText,
            },
          ],
        },
      ],
      instructions: '',
      stream: true,
      store: false,
    }),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(`Codex returned ${res.status}: ${JSON.stringify(body)}`)
  }

    return extractCodexStreamText(await res.text())
  }

  const raw = await callCodex(PARSE_PROMPT)
  try {
    return parseJsonProfile(raw)
  } catch {
    try {
      return parseJsonProfile(await callCodex(COMPACT_PARSE_PROMPT))
    } catch {
      return deterministicResumeParse(resumeText)
    }
  }
}

async function parseWithOpenRouter(
  resumeText: string,
  encryptedApiKey: string,
  model: string,
): Promise<ParsedProfile> {
  const apiKey = decrypt(encryptedApiKey)

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'user', content: PARSE_PROMPT + resumeText },
      ],
      temperature: 0.1,
      max_tokens: 2048,
    }),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(`OpenRouter returned ${res.status}: ${JSON.stringify(body)}`)
  }

  const completion = await res.json() as {
    choices: Array<{ message: { content: string } }>
  }

  return parseJsonProfile(completion.choices?.[0]?.message?.content ?? '')
}

/**
 * Parse resume text into structured profile data using the configured provider.
 * Codex OAuth is used when selected and connected; otherwise OpenRouter is used.
 */
export async function parseResumeWithLLM(resumeText: string): Promise<ParsedProfile> {
  const profileResult = await pool.query(
    `SELECT llm_provider, openrouter_api_key_enc, preferred_model FROM user_profile WHERE id = 1`,
  )

  const profile = profileResult.rows[0]
  if (isCodexOAuthEnabled() && profile?.llm_provider === 'codex-oauth') {
    const codexAuth = await readConnectedCodexAuth()
    if (codexAuth) {
      return parseWithCodexOAuth(
        resumeText,
        profile.preferred_model || DEFAULT_CODEX_PARSE_MODEL,
        codexAuth,
      )
    }
  }

  if (!profile?.openrouter_api_key_enc) {
    throw new Error('API key not configured')
  }

  return parseWithOpenRouter(
    resumeText,
    profile.openrouter_api_key_enc,
    profile.preferred_model || DEFAULT_OPENROUTER_PARSE_MODEL,
  )
}

/**
 * Extract text from a PDF buffer using pdf-parse v2.
 */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data: new Uint8Array(buffer) })
  const result = await parser.getText()
  return result.text
}
