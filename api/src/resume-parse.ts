import { z } from 'zod'
import { pool } from './db.js'
import { decrypt } from './crypto.js'

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

Return ONLY valid JSON matching this exact schema — no markdown fences, no explanation:

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

/**
 * Call OpenRouter to parse resume text into structured profile data.
 * Uses the user's stored API key and preferred model (or a sensible default).
 */
export async function parseResumeWithLLM(resumeText: string): Promise<ParsedProfile> {
  const profileResult = await pool.query(
    `SELECT openrouter_api_key_enc, preferred_model FROM user_profile WHERE id = 1`,
  )

  const profile = profileResult.rows[0]
  if (!profile?.openrouter_api_key_enc) {
    throw new Error('API key not configured')
  }

  const apiKey = decrypt(profile.openrouter_api_key_enc)
  const model = profile.preferred_model || 'google/gemini-2.0-flash-001'

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

  const raw = completion.choices?.[0]?.message?.content ?? ''

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

/**
 * Extract text from a PDF buffer using pdf-parse v2.
 */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data: new Uint8Array(buffer) })
  const result = await parser.getText()
  return result.text
}
