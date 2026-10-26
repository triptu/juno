/**
 * Turns a recording into what a person looks at: the frames as files, a
 * labelled filmstrip PNG, a 4× slow-motion webm and `result.json`. The pixel
 * statistics for the checks come from the same pass. A headless Chrome (the
 * installed one, as in the gallery) decodes and draws the frames; ffmpeg
 * encodes the video and is optional.
 */
import { chromium, type Browser, type Page } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { loadavg } from 'node:os'
import { join, resolve } from 'node:path'
import { PIXEL_DELTA, type ShotPixels, type Verdict } from './checks'
import { STAMP, type Recording, type Rect } from './recorder'

/** Where every run writes its artefacts; gitignored and emptied at the start of a run. The e2e config puts it with the test results. */
export const REPORT_DIR = process.env.JUNO_FEEL_REPORT ?? resolve(__dirname, '../../feel-report')

/** Video plays this many times slower than the recording. */
export const SLOW_MOTION = 4
/** The filmstrip shows at most this many frames; flagged frames are always kept. */
const STRIP_MAX = 120
const STRIP_COLUMNS = 6
const TILE_WIDTH = 300
/** Pixel statistics are taken on frames scaled to this width. */
const ANALYSE_WIDTH = 480
const ORIGIN = 'http://feel.local'

export interface ScenarioResult {
  readonly name: string
  readonly title: string
  readonly test: string
  readonly status: 'pass' | 'fail' | 'skipped'
  readonly reason?: string
  readonly verdicts: ReadonlyArray<Verdict>
  readonly frames: number
  readonly animationFrames: number
  readonly durationMs: number
  readonly load: number
  /** Page time of each filmstrip frame from the first, for the contact sheet's frame counter. */
  readonly timeline: ReadonlyArray<number>
  readonly video: string | null
  readonly filmstrip: string | null
  readonly notes: ReadonlyArray<string>
}

export class Studio {
  #browser: Browser | undefined

  async #page(dir: string): Promise<Page> {
    // As the gallery's: the installed Chrome, or Playwright's build where none is installed (the remote runner sets GALLERY_BROWSER).
    this.#browser ??= await chromium.launch({ channel: (process.env.FEEL_BROWSER ?? process.env.GALLERY_BROWSER) === 'chromium' ? undefined : 'chrome', headless: true })
    const page = await this.#browser.newPage({ viewport: { width: STRIP_COLUMNS * (TILE_WIDTH + 8) + 24, height: 800 } })
    await page.route(`${ORIGIN}/**`, async (route) => {
      const path = new URL(route.request().url()).pathname
      if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><body></body>' })
      return route.fulfill({ path: join(dir, decodeURIComponent(path)) })
    })
    await page.goto(`${ORIGIN}/`)
    return page
  }

  async close(): Promise<void> {
    await this.#browser?.close()
    this.#browser = undefined
  }

  /** Writes `frames/NNNN.jpg` and returns each frame's pixel statistics for the named regions. */
  async analyse(dir: string, recording: Recording): Promise<ShotPixels[]> {
    await mkdir(join(dir, 'frames'), { recursive: true })
    await Promise.all(recording.shots.map((shot) => writeFile(join(dir, 'frames', frameFile(shot.number)), shot.jpeg)))
    if (recording.shots.length === 0) return []
    const page = await this.#page(dir)
    try {
      const first = recording.shots[0]!
      return await page.evaluate(
        async ({ files, regions, cssWidth, width, delta, stamp }) => {
          const load = (src: string) =>
            new Promise<HTMLImageElement>((done, reject) => {
              const img = new Image()
              img.addEventListener('load', () => done(img))
              img.addEventListener('error', () => reject(new Error(`cannot load ${src}`)))
              img.src = src
            })
          const grey: Uint8Array[] = []
          const frames: Array<number | null> = []
          let height = 0
          const canvas = document.createElement('canvas')
          const context = canvas.getContext('2d', { willReadFrequently: true })!
          const strip = document.createElement('canvas')
          const stripContext = strip.getContext('2d', { willReadFrequently: true })!
          // Reads the frame number from the cells along the bottom-left edge, at full size.
          const readStamp = (img: HTMLImageElement): number | null => {
            const s = img.naturalWidth / cssWidth
            const cells = stamp.bits + 2
            strip.width = Math.ceil(cells * stamp.cell * s)
            strip.height = Math.ceil(stamp.height * s)
            stripContext.drawImage(img, 0, img.naturalHeight - strip.height, strip.width, strip.height, 0, 0, strip.width, strip.height)
            const data = stripContext.getImageData(0, 0, strip.width, strip.height).data
            const dark = (cell: number) => {
              const x = Math.floor((cell + 0.5) * stamp.cell * s)
              const y = Math.floor(strip.height / 2)
              const i = (y * strip.width + x) * 4
              return data[i]! + data[i + 1]! + data[i + 2]! < 384
            }
            if (!dark(0) || dark(1)) return null
            let n = 0
            for (let bit = 0; bit < stamp.bits; bit++) if (dark(bit + 2)) n |= 1 << bit
            return n
          }
          for (const file of files) {
            const img = await load(file)
            frames.push(readStamp(img))
            height = Math.round((img.naturalHeight / img.naturalWidth) * width)
            canvas.width = width
            canvas.height = height
            context.drawImage(img, 0, 0, width, height)
            const rgba = context.getImageData(0, 0, width, height).data
            const g = new Uint8Array(width * height)
            for (let i = 0; i < g.length; i++) g[i] = (rgba[i * 4]! * 299 + rgba[i * 4 + 1]! * 587 + rgba[i * 4 + 2]! * 114) / 1000
            grey.push(g)
          }
          const scale = width / cssWidth
          const area = (r: { x: number; y: number; width: number; height: number }) => ({
            x0: Math.max(0, Math.floor(r.x * scale)),
            y0: Math.max(0, Math.floor(r.y * scale)),
            x1: Math.min(width, Math.ceil((r.x + r.width) * scale)),
            y1: Math.min(height, Math.ceil((r.y + r.height) * scale)),
          })
          const changed = (a: Uint8Array | undefined, b: Uint8Array, r: ReturnType<typeof area>) => {
            if (a === undefined) return 0
            let count = 0
            let total = 0
            for (let y = r.y0; y < r.y1; y++)
              for (let x = r.x0; x < r.x1; x++) {
                total++
                if (Math.abs(a[y * width + x]! - b[y * width + x]!) > delta) count++
              }
            return total === 0 ? 0 : count / total
          }
          const spread = (g: Uint8Array, r: ReturnType<typeof area>) => {
            let sum = 0
            let squares = 0
            let n = 0
            for (let y = r.y0; y < r.y1; y++)
              for (let x = r.x0; x < r.x1; x++) {
                const v = g[y * width + x]!
                sum += v
                squares += v * v
                n++
              }
            return n === 0 ? 0 : Math.sqrt(Math.max(0, squares / n - (sum / n) ** 2))
          }
          return grey.map((g, i) => ({
            number: i + 1,
            frame: frames[i] ?? null,
            regions: Object.fromEntries(
              Object.entries(regions).map(([name, rect]) => {
                const r = area(rect)
                return [name, { changed: changed(grey[i - 1], g, r), changedSkip: changed(grey[i - 2], g, r), spread: spread(g, r) }]
              }),
            ),
          }))
        },
        { files: recording.shots.map((shot) => `/frames/${frameFile(shot.number)}`), regions: recording.regions as Record<string, Rect>, cssWidth: first.deviceWidth, width: ANALYSE_WIDTH, delta: PIXEL_DELTA, stamp: STAMP },
      )
    } finally {
      await page.close()
    }
  }

  /** Draws the frames as a labelled contact sheet; frames named by a failed check get a red frame and the check's name. */
  async filmstrip(dir: string, title: string, recording: Recording, pixels: ReadonlyArray<ShotPixels>, verdicts: ReadonlyArray<Verdict>): Promise<string | null> {
    if (recording.shots.length === 0) return null
    const flags = new Map<number, string[]>()
    for (const verdict of verdicts) {
      if (verdict.status === 'pass') continue
      for (const shot of verdict.shots) flags.set(shot, [...(flags.get(shot) ?? []), verdict.name])
    }
    const changed = pixels.filter((p, i) => i === 0 || i === pixels.length - 1 || (p.regions['window']?.changed ?? 1) > 0.0005).map((p) => p.number)
    const shots = pickShots(changed, flags)
    const t0 = recording.shots[0]!.t
    const tiles = shots.map((number) => {
      const shot = recording.shots[number - 1]!
      const frame = pixels[number - 1]?.frame
      return { number, src: `/frames/${frameFile(number)}`, label: `#${number}  +${Math.round(shot.t - t0)} ms${frame == null ? '' : `  f${frame}`}`, flags: flags.get(number) ?? [] }
    })
    const page = await this.#page(dir)
    try {
      await page.evaluate(
        ({ tiles: list, title: heading, note, columns, tileWidth }) => {
          document.body.innerHTML = ''
          const style = document.createElement('style')
          style.textContent = `
            body { margin: 12px; font: 12px -apple-system, system-ui, sans-serif; background: #f4f4f5; color: #18181b; }
            h1 { font-size: 14px; margin: 0 0 8px; }
            .grid { display: grid; grid-template-columns: repeat(${columns}, ${tileWidth}px); gap: 8px; }
            figure { margin: 0; background: white; border: 2px solid #d4d4d8; }
            figure.flag { border-color: #dc2626; }
            img { display: block; width: 100%; }
            figcaption { padding: 2px 4px; font-variant-numeric: tabular-nums; }
            .bad { color: #dc2626; display: block; }`
          document.head.append(style)
          const h1 = document.createElement('h1')
          h1.textContent = `${heading}${note}`
          const grid = document.createElement('div')
          grid.className = 'grid'
          for (const tile of list) {
            const figure = document.createElement('figure')
            if (tile.flags.length > 0) figure.className = 'flag'
            const img = document.createElement('img')
            img.src = tile.src
            const caption = document.createElement('figcaption')
            caption.textContent = tile.label
            for (const flag of tile.flags) {
              const bad = document.createElement('span')
              bad.className = 'bad'
              bad.textContent = flag
              caption.append(bad)
            }
            figure.append(img, caption)
            grid.append(figure)
          }
          document.body.append(h1, grid)
          return Promise.all([...document.images].map((img) => img.decode()))
        },
        { tiles, title, note: ` (${shots.length} of ${recording.shots.length} frames: those that changed, and every flagged one)`, columns: STRIP_COLUMNS, tileWidth: TILE_WIDTH },
      )
      await page.screenshot({ path: join(dir, 'filmstrip.png'), fullPage: true })
      return 'filmstrip.png'
    } finally {
      await page.close()
    }
  }
}

const frameFile = (number: number) => `${String(number).padStart(4, '0')}.jpg`

/** The given frames and the flagged ones when they fit; otherwise every flagged frame plus an even sample of the rest. */
function pickShots(numbers: ReadonlyArray<number>, flags: ReadonlyMap<number, unknown>): number[] {
  const all = new Set([...numbers, ...flags.keys()])
  if (all.size <= STRIP_MAX) return [...all].toSorted((a, b) => a - b)
  const keep = new Set([...flags.keys()].slice(0, STRIP_MAX / 2))
  const room = STRIP_MAX - keep.size
  for (let i = 0; i < room; i++) keep.add(numbers[Math.floor((i * numbers.length) / room)]!)
  return [...keep].toSorted((a, b) => a - b)
}

/** Encodes the frames at their real spacing, `SLOW_MOTION` times slower, as `video.webm`. Null when ffmpeg is missing or fails. */
export async function encodeVideo(dir: string, recording: Recording): Promise<{ readonly file: string | null; readonly note?: string }> {
  const shots = recording.shots
  if (shots.length === 0) return { file: null, note: 'no frames' }
  const lines = ['ffconcat version 1.0']
  for (let i = 0; i < shots.length; i++) {
    const next = shots[i + 1]?.t ?? recording.endedAt
    const seconds = (Math.max(next - shots[i]!.t, 8) * SLOW_MOTION) / 1000
    lines.push(`file 'frames/${frameFile(shots[i]!.number)}'`, `duration ${seconds.toFixed(4)}`)
  }
  // The concat demuxer drops the last duration unless the file is listed again.
  lines.push(`file 'frames/${frameFile(shots.at(-1)!.number)}'`)
  await writeFile(join(dir, 'frames.ffconcat'), `${lines.join('\n')}\n`)
  const args = ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', 'frames.ffconcat', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p', '-fps_mode', 'vfr', '-c:v', 'libvpx', '-b:v', '3M', '-deadline', 'realtime', '-cpu-used', '8', 'video.webm']
  const code = await new Promise<number | string>((done) => {
    const child = spawn('ffmpeg', args, { cwd: dir, stdio: ['ignore', 'ignore', 'pipe'] })
    let error = ''
    child.stderr.on('data', (chunk: Buffer) => (error += chunk.toString()))
    child.on('error', () => done('ffmpeg not found; install it (brew install ffmpeg) to get videos'))
    child.on('exit', (status) => done(status === 0 ? 0 : `ffmpeg failed: ${error.trim().slice(0, 300)}`))
  })
  return code === 0 ? { file: 'video.webm' } : { file: null, note: String(code) }
}

export async function writeResult(dir: string, result: ScenarioResult): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`)
}

export async function readResult(dir: string): Promise<ScenarioResult | undefined> {
  try {
    return JSON.parse(await readFile(join(dir, 'result.json'), 'utf8')) as ScenarioResult
  } catch {
    return undefined
  }
}

export const currentLoad = () => Math.round(loadavg()[0]! * 10) / 10
