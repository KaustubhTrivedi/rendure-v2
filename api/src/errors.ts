import type { Context } from 'hono'

/**
 * Machine-readable error codes. Use these as the `code` field in error responses
 * so clients can branch on a stable identifier instead of parsing free-text titles.
 */
export const ErrorCode = {
  unauthorized: 'unauthorized',
  not_found: 'not_found',
  profile_not_found: 'profile_not_found',
  validation_failed: 'validation_failed',
  internal_error: 'internal_error',
  bad_request: 'bad_request',
  conflict: 'conflict',
} as const

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode]

export interface FieldError {
  path: string
  message: string
}

export interface HttpErrorOptions {
  /** Long-form description of the error. */
  detail?: string
  /** Identifier of the failing request — defaults to `c.req.path`. */
  instance?: string
  /** Per-field validation errors. */
  fields?: FieldError[]
  /** URI reference describing the error type. Defaults to `about:blank`. */
  type?: string
}

/**
 * RFC7807-hybrid error response.
 *
 * Body shape: `{type, title, status, error, code, detail?, instance?, fields?}`
 * `error` is an alias of `title` so existing clients that read `body.error`
 * continue to work alongside any new consumers reading `body.title`.
 */
export function httpError(
  c: Context,
  status: number,
  code: ErrorCodeValue,
  title: string,
  opts: HttpErrorOptions = {},
) {
  const body: Record<string, unknown> = {
    type: opts.type ?? 'about:blank',
    title,
    status,
    error: title, // backward-compat alias
    code,
    instance: opts.instance ?? c.req.path,
  }
  if (opts.detail !== undefined) body.detail = opts.detail
  if (opts.fields !== undefined) body.fields = opts.fields

  // Use Hono's c.json with a numeric status cast for type compatibility.
  // The actual HTTP status sent is `status`.
  return c.json(body, status as 200)
}
