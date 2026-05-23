import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parse as yamlParse, stringify as yamlStringify } from 'yaml'

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

const SECTION_KEYS = new Set([
  'profile', 'summary', 'skills', 'experience',
  'projects', 'education', 'publications', 'certifications',
])

export function normalizeRenderCvYaml(source: string): string {
  let doc: Record<string, unknown>
  try {
    doc = yamlParse(source) as Record<string, unknown>
  } catch {
    return source
  }

  if (!doc || typeof doc !== 'object' || !('cv' in doc)) return source

  const cv = doc.cv as Record<string, unknown>
  if (!cv || typeof cv !== 'object') return source

  if (cv.sections && typeof cv.sections === 'object') {
    normalizeFieldNames(cv.sections as Record<string, unknown>)
    normalizeCvHeader(cv)
    return yamlStringify(doc, { lineWidth: 0 })
  }

  const sections: Record<string, unknown> = {}
  const keysToRemove: string[] = []

  for (const key of Object.keys(cv)) {
    if (SECTION_KEYS.has(key)) {
      if (key === 'profile') {
        sections['summary'] = cv[key]
      } else {
        sections[key] = cv[key]
      }
      keysToRemove.push(key)
    }
  }

  if (Object.keys(sections).length === 0) return source

  for (const key of keysToRemove) {
    delete cv[key]
  }

  normalizeFieldNames(sections)
  cv.sections = sections
  normalizeCvHeader(cv)

  return yamlStringify(doc, { lineWidth: 0 })
}

function normalizeCvHeader(cv: Record<string, unknown>) {
  if (typeof cv.phone === 'string') {
    let phone = cv.phone as string
    phone = phone.replace(/[^\d+]/g, '')
    if (phone.startsWith('0')) {
      phone = '+353' + phone.slice(1)
    }
    if (!phone.startsWith('+')) {
      phone = '+' + phone
    }
    cv.phone = phone
  }

  if (typeof cv.website === 'string') {
    const site = cv.website as string
    if (!/^https?:\/\//i.test(site)) {
      cv.website = 'https://' + site
    }
  }
}

function coerceHighlights(items: Record<string, unknown>[]) {
  for (const item of items) {
    if (Array.isArray(item.highlights)) {
      item.highlights = item.highlights.map((h: unknown) => {
        if (typeof h === 'string') return h
        if (h && typeof h === 'object') {
          return Object.entries(h as Record<string, unknown>)
            .map(([k, v]) => `${k}: ${v}`)
            .join(', ')
        }
        return String(h)
      })
    }
    if (item.start_date instanceof Date) {
      item.start_date = formatDate(item.start_date)
    }
    if (item.end_date instanceof Date) {
      item.end_date = formatDate(item.end_date)
    }
  }
}

function formatDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

function normalizeFieldNames(sections: Record<string, unknown>) {
  if (Array.isArray(sections.skills)) {
    sections.skills = (sections.skills as Record<string, unknown>[]).map((item) => {
      if (item.title && !item.label) {
        item.label = item.title
        delete item.title
      }
      if (Array.isArray(item.skills) && !item.details) {
        item.details = (item.skills as string[]).join(', ')
        delete item.skills
      }
      return item
    })
  }

  if (Array.isArray(sections.projects)) {
    coerceHighlights(sections.projects as Record<string, unknown>[])
    sections.projects = (sections.projects as Record<string, unknown>[]).map((item) => {
      if (item.title && !item.name) {
        item.name = item.title
        delete item.title
      }
      return item
    })
  }

  if (Array.isArray(sections.education)) {
    coerceHighlights(sections.education as Record<string, unknown>[])
    sections.education = (sections.education as Record<string, unknown>[]).map((item) => {
      if (item.study_type && !item.degree) {
        item.degree = item.study_type
        delete item.study_type
      }
      return item
    })
  }

  if (Array.isArray(sections.experience)) {
    coerceHighlights(sections.experience as Record<string, unknown>[])
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
  options = { ...options, source: normalizeRenderCvYaml(options.source) }
  const existing = inFlight.get(options.versionId)
  if (existing) return existing

  const timeoutMs = renderTimeoutMs()
  const renderPromise = getLimiter()
    .run(() => renderAndCachePdf(options, pdfPath, timeoutMs))
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

async function renderAndCachePdf(options: RenderPdfOptions, pdfPath: string, timeoutMs: number): Promise<Buffer> {
  await mkdir(path.dirname(pdfPath), { recursive: true })
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'resume-render-'))
  const outputDir = path.join(tempDir, 'out')
  const inputPath = path.join(tempDir, 'resume.yaml')
  try {
    await mkdir(outputDir, { recursive: true })
    await writeFile(inputPath, options.source)
    await runRenderCv(inputPath, outputDir, timeoutMs)
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

async function runRenderCv(inputPath: string, outputDir: string, timeoutMs: number): Promise<void> {
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
    }, timeoutMs)

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
