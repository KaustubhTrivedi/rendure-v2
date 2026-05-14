import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
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
const inFlight = new Map<string, Promise<Buffer>>()

type LimitTask<T> = {
  run: () => Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

class RenderLimiter {
  private active = 0
  private readonly queue: LimitTask<unknown>[] = []

  constructor(private readonly concurrency: number) {}

  run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ run: task, resolve: resolve as (value: unknown) => void, reject })
      this.drain()
    })
  }

  private drain() {
    while (this.active < this.concurrency && this.queue.length > 0) {
      const next = this.queue.shift()
      if (!next) return
      this.active += 1
      next.run()
        .then(next.resolve)
        .catch(next.reject)
        .finally(() => {
          this.active -= 1
          this.drain()
        })
    }
  }

  clear() {
    this.queue.length = 0
    this.active = 0
  }
}

let limiter: RenderLimiter | null = null

function cacheDir() {
  return process.env.RESUME_PDF_CACHE_DIR ?? path.resolve('api/.cache/resumes')
}

function cachePath(versionId: string) {
  if (!UUID_RE.test(versionId)) {
    throw new RenderCvFailedError('Invalid resume version id.')
  }
  return path.join(cacheDir(), `${versionId}.pdf`)
}

function renderTimeoutMs() {
  const parsed = Number.parseInt(process.env.RESUME_PDF_RENDER_TIMEOUT_MS ?? '30000', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30000
}

function renderConcurrency() {
  const parsed = Number.parseInt(process.env.RESUME_PDF_RENDER_CONCURRENCY ?? '2', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2
}

function getLimiter() {
  limiter ??= new RenderLimiter(renderConcurrency())
  return limiter
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
  const existing = inFlight.get(options.versionId)
  if (existing) return existing

  const renderPromise = getLimiter()
    .run(() => renderAndCachePdf(options, pdfPath))
    .finally(() => {
      inFlight.delete(options.versionId)
    })
  inFlight.set(options.versionId, renderPromise)
  return renderPromise
}

export function resetResumeRendererForTests(): void {
  inFlight.clear()
  limiter?.clear()
  limiter = null
}

async function renderAndCachePdf(options: RenderPdfOptions, pdfPath: string): Promise<Buffer> {
  await mkdir(path.dirname(pdfPath), { recursive: true })
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'resume-render-'))
  const outputDir = path.join(tempDir, 'out')
  const inputPath = path.join(tempDir, 'resume.yaml')
  try {
    await mkdir(outputDir, { recursive: true })
    await writeFile(inputPath, options.source)
    await runRenderCv(inputPath, outputDir)
    const outputPdf = await findRenderedPdf(outputDir)
    const rendered = await readFile(outputPdf)
    const tempCachePath = path.join(path.dirname(pdfPath), `.${options.versionId}.${Date.now()}.tmp`)
    await writeFile(tempCachePath, rendered)
    await rename(tempCachePath, pdfPath)
    return rendered
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function findRenderedPdf(outputDir: string): Promise<string> {
  const files = await readdir(outputDir)
  const pdf = files.find((file) => file.endsWith('.pdf'))
  if (!pdf) {
    throw new RenderCvFailedError()
  }
  return path.join(outputDir, pdf)
}

async function runRenderCv(inputPath: string, outputDir: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false
    let stderr = ''
    const child = spawn('rendercv', ['render', inputPath, '--output-folder', outputDir], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      reject(new RenderCvTimeoutError())
    }, renderTimeoutMs())

    child.stderr?.on('data', (chunk) => {
      stderr = (stderr + String(chunk)).slice(0, 1024)
    })
    child.on('error', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new RenderCvUnavailableError())
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code === 0) {
        resolve()
      } else {
        if (stderr) {
          console.error('RenderCV failed', { stderr })
        }
        reject(new RenderCvFailedError())
      }
    })
  })
}
