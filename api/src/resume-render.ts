import { spawn } from 'node:child_process'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

export interface RenderPdfOptions {
  versionId: string
  source: string
}

export class RenderCvUnavailableError extends Error {
  constructor(message = 'RenderCV is not available.') {
    super(message)
    this.name = 'RenderCvUnavailableError'
  }
}

export class RenderCvFailedError extends Error {
  constructor(message = 'RenderCV failed to render the resume.') {
    super(message)
    this.name = 'RenderCvFailedError'
  }
}

export class RenderCvTimeoutError extends Error {
  constructor(message = 'RenderCV render timed out.') {
    super(message)
    this.name = 'RenderCvTimeoutError'
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function cacheDir() {
  return process.env.RESUME_PDF_CACHE_DIR ?? path.resolve('api/.cache/resumes')
}

function cachePath(versionId: string) {
  if (!UUID_RE.test(versionId)) {
    throw new RenderCvFailedError('Invalid resume version id.')
  }
  return path.join(cacheDir(), `${versionId}.pdf`)
}

function validateRenderCvSource(source: string) {
  const trimmed = source.trimStart()
  if (!trimmed.startsWith('cv:') || !/^design:/m.test(trimmed)) {
    throw new RenderCvFailedError('Resume source is not valid RenderCV YAML.')
  }
}

async function readCachedPdf(versionId: string): Promise<Buffer | null> {
  try {
    return await readFile(cachePath(versionId))
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return null
    throw error
  }
}

export async function checkRenderCvAvailable(): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const child = spawn('rendercv', ['--version'])
    child.on('error', () => resolve(false))
    child.on('close', (code) => resolve(code === 0))
  })
}

export async function getOrRenderPdf(options: RenderPdfOptions): Promise<Buffer> {
  const pdfPath = cachePath(options.versionId)
  const cached = await readCachedPdf(options.versionId)
  if (cached) return cached

  validateRenderCvSource(options.source)
  await mkdir(path.dirname(pdfPath), { recursive: true })
  throw new RenderCvUnavailableError()
}

export function resetResumeRendererForTests(): void {
  // Filled in when render state is added.
}
