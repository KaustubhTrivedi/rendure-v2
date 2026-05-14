import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  RenderCvFailedError,
  getOrRenderPdf,
  resetResumeRendererForTests,
} from './resume-render.js'

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

const spawnMock = vi.mocked(spawn)
const VERSION_ID = '11111111-1111-4111-8111-111111111111'

const renderCvYaml = `cv:
  name: Test Candidate
  email: test@example.com
  phone: "+1 555 0100"
  sections:
    summary:
      - Senior product engineer focused on backend automation.
    experience:
      - company: Example Co
        position: Staff Engineer
        start_date: 2021-01
        end_date: present
        highlights:
          - Built typed workflow APIs for operational teams.
    education:
      - institution: Example University
        area: Computer Science
        degree: BS
design:
  theme: classic
`

function mockChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    kill: ReturnType<typeof vi.fn>
  }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn()
  spawnMock.mockReturnValue(child as ReturnType<typeof spawn>)
  return child
}

async function withTempCacheDir() {
  const dir = await mkdtemp(path.join(tmpdir(), 'resume-render-test-'))
  process.env.RESUME_PDF_CACHE_DIR = dir
  return dir
}

describe('resume RenderCV helper', () => {
  let tempDirs: string[] = []

  beforeEach(() => {
    vi.useRealTimers()
    resetResumeRendererForTests()
    spawnMock.mockReset()
    delete process.env.RESUME_PDF_CACHE_DIR
    delete process.env.RESUME_PDF_RENDER_TIMEOUT_MS
    delete process.env.RESUME_PDF_RENDER_CONCURRENCY
  })

  afterEach(async () => {
    resetResumeRendererForTests()
    vi.useRealTimers()
    for (const dir of tempDirs) {
      await rm(dir, { recursive: true, force: true })
    }
    tempDirs = []
    delete process.env.RESUME_PDF_CACHE_DIR
    delete process.env.RESUME_PDF_RENDER_TIMEOUT_MS
    delete process.env.RESUME_PDF_RENDER_CONCURRENCY
  })

  it('serves cached PDF bytes without invoking RenderCV', async () => {
    const cacheDir = await withTempCacheDir()
    tempDirs.push(cacheDir)
    const cachedPdf = Buffer.from('%PDF cached bytes')
    await mkdir(cacheDir, { recursive: true })
    await writeFile(path.join(cacheDir, `${VERSION_ID}.pdf`), cachedPdf)

    const result = await getOrRenderPdf({ versionId: VERSION_ID, source: renderCvYaml })

    expect(result).toEqual(cachedPdf)
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('rejects unsafe cache keys that are not UUIDs', async () => {
    const cacheDir = await withTempCacheDir()
    tempDirs.push(cacheDir)

    await expect(getOrRenderPdf({ versionId: '../evil', source: renderCvYaml })).rejects.toThrow(
      RenderCvFailedError,
    )
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it.skipIf(process.env.RUN_RENDERCV_CONTRACT_TEST !== '1')(
    'renders representative current RenderCV YAML latex_source with host rendercv',
    async () => {
      const contractDir = await mkdtemp(path.join(tmpdir(), 'resume-render-contract-'))
      tempDirs.push(contractDir)
      const inputPath = path.join(contractDir, 'resume.yaml')
      const outDir = path.join(contractDir, 'out')
      await mkdir(outDir, { recursive: true })
      await writeFile(inputPath, renderCvYaml)

      const { spawn: realSpawn } = await vi.importActual<typeof import('node:child_process')>(
        'node:child_process',
      )
      const version = await new Promise<string>((resolve, reject) => {
        const child = realSpawn('rendercv', ['--version'])
        let stdout = ''
        let stderr = ''
        child.stdout?.on('data', (chunk) => {
          stdout += String(chunk)
        })
        child.stderr?.on('data', (chunk) => {
          stderr += String(chunk)
        })
        child.on('error', reject)
        child.on('close', (code) => {
          if (code === 0) resolve(stdout.trim() || stderr.trim())
          else reject(new Error(`rendercv --version failed: ${stderr}`))
        })
      })
      expect(version).toMatch(/rendercv/i)

      const code = await new Promise<number | null>((resolve, reject) => {
        const child = realSpawn('rendercv', ['render', inputPath, '--output-folder', outDir])
        child.on('error', reject)
        child.on('close', resolve)
      })
      expect(code).toBe(0)
      await expect(import('node:fs/promises').then((fs) => fs.readdir(outDir))).resolves.toContain(
        'resume.pdf',
      )
    },
  )

  it('fails fast for non RenderCV legacy source before spawning RenderCV', async () => {
    const cacheDir = await withTempCacheDir()
    tempDirs.push(cacheDir)
    mockChild()

    await expect(getOrRenderPdf({ versionId: VERSION_ID, source: '# Tailored Resume' })).rejects.toThrow(
      RenderCvFailedError,
    )
    expect(spawnMock).not.toHaveBeenCalled()
  })
})
