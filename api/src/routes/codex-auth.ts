import { Hono } from 'hono'
import { randomBytes, createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { createServer, type Server } from 'node:http'
import { httpError } from '../errors.js'
import { logger } from '../middleware/logger.js'

const AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize'
const TOKEN_URL = 'https://auth.openai.com/oauth/token'
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const REDIRECT_URI = 'http://localhost:1455/auth/callback'
const SCOPE = 'openid profile email offline_access'
const CALLBACK_PORT = 1455
const LOGIN_TTL_MS = 5 * 60 * 1000
const FALLBACK_CODEX_MODELS = [
  { id: 'gpt-5.5', name: 'GPT-5.5' },
  { id: 'gpt-5.5-pro', name: 'GPT-5.5 Pro' },
  { id: 'gpt-5.4', name: 'GPT-5.4' },
  { id: 'gpt-5.4-mini', name: 'GPT-5.4 mini' },
  { id: 'gpt-5.4-nano', name: 'GPT-5.4 nano' },
  { id: 'gpt-5.1-codex', name: 'GPT-5.1 Codex' },
  { id: 'gpt-5-codex', name: 'GPT-5 Codex' },
  { id: 'gpt-5.1', name: 'GPT-5.1' },
  { id: 'gpt-5', name: 'GPT-5' },
  { id: 'gpt-4.1', name: 'GPT-4.1' },
  { id: 'gpt-4.1-mini', name: 'GPT-4.1 mini' },
  { id: 'gpt-4o', name: 'GPT-4o' },
  { id: 'gpt-4o-mini', name: 'GPT-4o mini' },
  { id: 'o3', name: 'o3' },
  { id: 'o3-mini', name: 'o3 mini' },
  { id: 'o4-mini', name: 'o4 mini' },
]

type PendingLogin = {
  codeVerifier: string
  state: string
  status: 'pending' | 'complete' | 'error'
  error?: string
  createdAt: number
  callbackServer?: Server
}

const pendingLogins = new Map<string, PendingLogin>()

function generatePkce() {
  const verifierBytes = randomBytes(64)
  const codeVerifier = verifierBytes.toString('base64url')
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
  return { codeVerifier, codeChallenge }
}

function generateState() {
  return randomBytes(16).toString('hex')
}

function pruneExpiredLogins() {
  const now = Date.now()
  for (const [id, login] of pendingLogins) {
    if (now - login.createdAt > LOGIN_TTL_MS) {
      if (login.callbackServer) {
        try { login.callbackServer.close() } catch { /* ignore */ }
      }
      pendingLogins.delete(id)
    }
  }
}

function resolveAuthFilePath(): string {
  const envHome = process.env.CHATGPT_LOCAL_HOME ?? process.env.CODEX_HOME
  if (envHome) return join(envHome, 'auth.json')
  return join(homedir(), '.codex', 'auth.json')
}

function codexAuthFileCandidates(): string[] {
  return [
    process.env.CODEX_AUTH_FILE,
    process.env.CHATGPT_LOCAL_HOME ? join(process.env.CHATGPT_LOCAL_HOME, 'auth.json') : null,
    process.env.CODEX_HOME ? join(process.env.CODEX_HOME, 'auth.json') : null,
    join(homedir(), '.chatgpt-local', 'auth.json'),
    join(homedir(), '.codex', 'auth.json'),
  ].filter((p): p is string => typeof p === 'string' && p.length > 0)
}

type CodexAuthFile = {
  tokens?: {
    access_token?: string
    account_id?: string
  }
  last_refresh?: string
}

async function readCodexAuthFile(): Promise<{ path: string; data: CodexAuthFile } | null> {
  for (const candidate of codexAuthFileCandidates()) {
    try {
      const raw = await readFile(candidate, 'utf-8')
      const data = JSON.parse(raw) as CodexAuthFile
      if (!data.tokens?.access_token) continue
      return { path: candidate, data }
    } catch {
      continue
    }
  }

  return null
}

function isOpenAiChatModel(id: string): boolean {
  return id.startsWith('gpt-')
    || id.startsWith('o1-')
    || id === 'o3'
    || id.startsWith('o3-')
    || id === 'o4'
    || id.startsWith('o4-')
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

function deriveAccountId(idToken: string): string | null {
  const claims = decodeJwtPayload(idToken)
  if (!claims) return null
  const authClaim = claims['https://api.openai.com/auth'] as Record<string, unknown> | undefined
  const accountId = authClaim?.chatgpt_account_id
  return typeof accountId === 'string' && accountId.length > 0 ? accountId : null
}

async function persistTokens(
  idToken: string,
  accessToken: string,
  refreshToken: string,
): Promise<void> {
  const filePath = resolveAuthFilePath()
  const accountId = deriveAccountId(idToken)

  let existing: Record<string, unknown> = {}
  try {
    const raw = await readFile(filePath, 'utf-8')
    existing = JSON.parse(raw) as Record<string, unknown>
  } catch { /* file may not exist yet */ }

  const data = {
    ...existing,
    tokens: {
      id_token: idToken,
      access_token: accessToken,
      refresh_token: refreshToken,
      account_id: accountId,
    },
    last_refresh: new Date().toISOString(),
  }

  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 })
}

/**
 * Starts a local HTTP server on port 1455 to receive the OAuth callback.
 * Matches the Codex CLI's registered redirect URI exactly:
 *   http://localhost:1455/auth/callback
 *
 * The server receives the auth code, exchanges it for tokens, persists
 * auth.json, marks the login complete, and shuts down.
 */
function startCallbackServer(loginId: string): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (url.pathname !== '/auth/callback') {
        res.writeHead(404)
        res.end('Not found')
        return
      }

      const code = url.searchParams.get('code')
      const stateParam = url.searchParams.get('state')
      const errorParam = url.searchParams.get('error')
      const errorDesc = url.searchParams.get('error_description')

      const login = pendingLogins.get(loginId)
      const shutDown = () => {
        try { server.close() } catch { /* ignore */ }
        if (login) login.callbackServer = undefined
      }

      if (!login) {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(loginResultPage(false, 'Login session expired or not found.'))
        shutDown()
        return
      }

      if (stateParam !== login.state) {
        login.status = 'error'
        login.error = 'State mismatch'
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(loginResultPage(false, 'State mismatch. Please try again.'))
        shutDown()
        return
      }

      if (errorParam) {
        login.status = 'error'
        login.error = errorDesc ?? errorParam
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(loginResultPage(false, `OpenAI auth error: ${errorDesc ?? errorParam}`))
        shutDown()
        return
      }

      if (!code) {
        login.status = 'error'
        login.error = 'Missing authorization code'
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(loginResultPage(false, 'Missing authorization code.'))
        shutDown()
        return
      }

      try {
        const tokenResp = await fetch(TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: CLIENT_ID,
            code,
            code_verifier: login.codeVerifier,
            redirect_uri: REDIRECT_URI,
          }).toString(),
        })

        if (!tokenResp.ok) {
          logger.error({ status: tokenResp.status }, 'Codex token exchange failed')
          login.status = 'error'
          login.error = `Token exchange failed (${tokenResp.status})`
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(loginResultPage(false, `Token exchange failed (${tokenResp.status}).`))
          shutDown()
          return
        }

        const tokens = (await tokenResp.json()) as {
          id_token: string
          access_token: string
          refresh_token: string
        }

        await persistTokens(tokens.id_token, tokens.access_token, tokens.refresh_token)
        login.status = 'complete'
        logger.info('Codex OAuth login completed, tokens persisted')

        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(loginResultPage(true))
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        logger.error({ err: message }, 'Codex OAuth callback error')
        login.status = 'error'
        login.error = message
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(loginResultPage(false, message))
      } finally {
        shutDown()
      }
    })

    server.listen({ port: CALLBACK_PORT, host: '::', ipv6Only: false }, () => resolve(server))
    server.on('error', reject)

    setTimeout(() => {
      try { server.close() } catch { /* ignore */ }
    }, LOGIN_TTL_MS)
  })
}

/**
 * Whether the Codex OAuth provider is enabled for this deployment.
 *
 * Defaults to enabled (self-hosted parity with prior behaviour); the hosted
 * browser build opts out with `CODEX_OAUTH_ENABLED=false`. Read at call time
 * so tests can mutate `process.env` without module-level side effects.
 */
export function isCodexOAuthEnabled(): boolean {
  return process.env.CODEX_OAUTH_ENABLED !== 'false'
}

// Two Hono apps: one for authenticated routes, one public (kept for backward compat)
export const codexAuth = new Hono()
export const codexAuthPublic = new Hono()

/**
 * POST /profile/codex-auth/login
 *
 * Initiates the OAuth PKCE flow. Starts a local server on port 1455 to
 * receive the callback — matching the Codex CLI's registered redirect URI.
 */
codexAuth.post('/login', async (c) => {
  pruneExpiredLogins()

  const loginId = randomBytes(16).toString('hex')
  const { codeVerifier, codeChallenge } = generatePkce()
  const state = generateState()

  let callbackServer: Server
  try {
    callbackServer = await startCallbackServer(loginId)
  } catch (err) {
    logger.warn({ err }, 'Failed to bind port 1455 for OAuth callback')
    return httpError(c, 500, 'internal_error', 'Port 1455 is in use. Close any existing Codex login and try again.')
  }

  pendingLogins.set(loginId, {
    codeVerifier,
    state,
    status: 'pending',
    createdAt: Date.now(),
    callbackServer,
  })

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    originator: 'codex_cli_rs',
  })

  const authUrl = `${AUTHORIZE_URL}?${params.toString()}`

  return c.json({ login_id: loginId, auth_url: authUrl })
})

/**
 * GET /profile/codex-auth/login/:id/status
 */
codexAuth.get('/login/:id/status', (c) => {
  const loginId = c.req.param('id')
  const login = pendingLogins.get(loginId)

  if (!login) {
    return c.json({ status: 'expired' })
  }

  if (login.status === 'complete') {
    pendingLogins.delete(loginId)
    return c.json({ status: 'complete' })
  }

  if (login.status === 'error') {
    const error = login.error
    pendingLogins.delete(loginId)
    return c.json({ status: 'error', error })
  }

  return c.json({ status: 'pending' })
})

/**
 * GET /profile/codex-auth/models
 *
 * Fetches chat-capable OpenAI models using the Codex OAuth access token.
 */
codexAuth.get('/models', async (c) => {
  const auth = await readCodexAuthFile()
  const accessToken = auth?.data.tokens?.access_token

  if (!accessToken) {
    return httpError(c, 404, 'not_found', 'Codex auth not configured', {
      detail: 'Run Codex OAuth login first.',
    })
  }

  const res = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!res.ok) {
    if (res.status === 403) {
      logger.warn(
        { status: res.status },
        'OpenAI models endpoint denied Codex token; returning fallback Codex model list',
      )
      return c.json(FALLBACK_CODEX_MODELS)
    }

    return httpError(c, 502, 'bad_request', 'OpenAI models request failed', {
      detail: `OpenAI returned ${res.status}.`,
    })
  }

  const body = (await res.json()) as { data?: Array<{ id: string; name?: string }> }
  const models = (body.data ?? [])
    .filter((m) => typeof m.id === 'string' && isOpenAiChatModel(m.id))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((m) => ({ id: m.id, name: m.name ?? m.id }))

  return c.json(models)
})

/**
 * GET /profile/codex-auth/status
 */
codexAuth.get('/status', async (c) => {
  const auth = await readCodexAuthFile()

  if (auth?.data.tokens?.access_token) {
      let expiresAt: string | null = null
      const claims = decodeJwtPayload(auth.data.tokens.access_token)
      if (claims && typeof claims.exp === 'number') {
        expiresAt = new Date((claims.exp as number) * 1000).toISOString()
      }
      const expired = expiresAt ? new Date(expiresAt).getTime() < Date.now() : false

      return c.json({
        connected: !expired,
        expired,
        source_path: auth.path,
        account_id: auth.data.tokens.account_id ?? null,
        expires_at: expiresAt,
        last_refresh: auth.data.last_refresh ?? null,
      })
  }

  return c.json({
    connected: false,
    expired: false,
    source_path: null,
    account_id: null,
    expires_at: null,
    last_refresh: null,
  })
})

function loginResultPage(success: boolean, error?: string): string {
  const title = success ? 'Login Successful' : 'Login Failed'
  const message = success
    ? 'You can close this window and return to Rendure.'
    : `Something went wrong: ${error ?? 'Unknown error'}. Close this window and try again.`
  const color = success ? '#00C853' : '#D50000'

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title} — Rendure</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; background: #FAFAFA;
    }
    .card {
      max-width: 480px; padding: 48px 40px; text-align: center;
      border: 3px solid #000; background: #FFF;
      box-shadow: 6px 6px 0 0 #000;
    }
    .dot {
      width: 20px; height: 20px; border-radius: 0;
      background: ${color}; display: inline-block;
      border: 3px solid #000; margin-bottom: 24px;
    }
    h1 { font-size: 28px; font-weight: 900; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 16px; }
    p { font-size: 14px; color: #666; line-height: 1.6; }
    .close-hint { margin-top: 24px; font-size: 12px; color: #999; letter-spacing: 0.06em; }
  </style>
</head>
<body>
  <div class="card">
    <div class="dot"></div>
    <h1>${title}</h1>
    <p>${message}</p>
    <p class="close-hint">This window will close automatically.</p>
  </div>
  <script>
    ${success ? 'setTimeout(() => window.close(), 2000);' : ''}
  </script>
</body>
</html>`
}
