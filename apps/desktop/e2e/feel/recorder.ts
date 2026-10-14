/**
 * Records one interaction: every compositor frame as a screencast image, and
 * on every animation frame the values of a few DOM probes, plus the
 * layout-shift and long-animation-frame entries and the input events. The
 * checks in `checks.ts` read the result; nothing here asserts.
 *
 * Probes run inside `requestAnimationFrame`, so they see each frame's state
 * just before it paints. Frames are counted, not timed, so a loaded machine
 * slows a recording down without changing what it shows.
 */
import type { CDPSession, Page } from '@playwright/test'

/** What to read on every frame. `selector` finds the first visible match (hidden tabs stay in the page). */
export type Probe =
  /** The viewport rectangle, transforms included. */
  | { readonly kind: 'rect'; readonly name: string; readonly selector: string }
  /** The layout box from the offset chain: ignores transforms, so a scale-in is not a move. */
  | { readonly kind: 'box'; readonly name: string; readonly selector: string }
  /** `scrollTop`, and the distance from the bottom. */
  | { readonly kind: 'scroll'; readonly name: string; readonly selector: string }
  /** How many elements match `selector` inside the first visible `within`. */
  | { readonly kind: 'count'; readonly name: string; readonly within: string; readonly selector: string }
  /** How many images inside the first visible `within` have their bytes. */
  | { readonly kind: 'images'; readonly name: string; readonly within: string }
  /** Trimmed text, at most 120 characters. */
  | { readonly kind: 'text'; readonly name: string; readonly selector: string }
  /** The computed look (colours, shadow, transform, opacity) and whether a transition or animation is running. */
  | { readonly kind: 'look'; readonly name: string; readonly selector: string }
  /**
   * The first (`top`) or last (`bottom`) row in view inside a scroller,
   * rows being the elements with the `rowKey` attribute: its key and its edge's offset from the scroller's top, plus
   * where last frame's row is now. The difference is how far the content
   * the user was looking at moved in that frame.
   */
  | { readonly kind: 'edge'; readonly name: string; readonly scroller: string; readonly rowKey: string; readonly side: 'top' | 'bottom' }

export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface ScrollValue {
  readonly top: number
  readonly fromBottom: number
}

export interface EdgeValue {
  readonly key: string
  readonly at: number
  /** Where the row that was at the edge last frame is now; null when it left the list or there was none. */
  readonly previousAt: number | null
  readonly previousKey: string | null
}

export type ProbeValue = Rect | ScrollValue | EdgeValue | number | string | null

export interface ProbeFrame {
  /** Animation frame number within the recording, from 0. */
  readonly index: number
  /** `performance.now()` in the page at the frame. */
  readonly t: number
  readonly values: Readonly<Record<string, ProbeValue>>
}

export interface InputEvent {
  readonly type: string
  readonly t: number
  /** The probe frame that came next: the first frame that could show the event. */
  readonly nextFrame: number
}

export interface ShiftSource {
  readonly node: string
  readonly before: Rect
  readonly after: Rect
}

export interface Shift {
  readonly t: number
  readonly value: number
  readonly hadRecentInput: boolean
  readonly sources: ReadonlyArray<ShiftSource>
}

export interface LongFrame {
  readonly t: number
  readonly duration: number
  readonly blocking: number
  readonly scripts: ReadonlyArray<string>
}

export interface Mark {
  readonly label: string
  readonly t: number
  readonly nextFrame: number
}

/** One screencast image. */
export interface Shot {
  /** 1-based, as in the filmstrip and the frame file names. */
  readonly number: number
  /** Page time of the compositor frame, comparable with `ProbeFrame.t`. */
  readonly t: number
  readonly jpeg: Buffer
  /** CSS pixels of the page in the image. */
  readonly deviceWidth: number
  readonly deviceHeight: number
}

export interface Recording {
  readonly frames: ReadonlyArray<ProbeFrame>
  readonly events: ReadonlyArray<InputEvent>
  readonly shifts: ReadonlyArray<Shift>
  readonly longFrames: ReadonlyArray<LongFrame>
  readonly marks: ReadonlyArray<Mark>
  readonly shots: ReadonlyArray<Shot>
  /** Named regions in CSS pixels, read at the end, for the pixel checks. */
  readonly regions: Readonly<Record<string, Rect>>
  readonly startedAt: number
  readonly endedAt: number
}

export interface RecordOptions {
  readonly probes: ReadonlyArray<Probe>
  /** Name to selector; each is read once, when the recording stops. `window` is always there. */
  readonly regions?: Readonly<Record<string, string>>
}

interface PageRecorder {
  frames: ProbeFrame[]
  events: InputEvent[]
  shifts: Shift[]
  longFrames: LongFrame[]
  marks: Mark[]
  on: boolean
  stop: () => void
}

const key = '__junoFeel'

/**
 * Every animation frame paints its number into the bottom-left corner as a
 * row of black and white cells (two guard cells, then the bits, lowest
 * first), so each screencast image says which probe frame it shows. It also
 * makes the compositor send an image for every frame.
 */
export const STAMP = { cell: 8, height: 6, bits: 14 } as const

export class Recorder {
  readonly #shots: Array<Omit<Shot, 'number'>> = []
  #timeOrigin = 0

  private constructor(
    readonly page: Page,
    readonly cdp: CDPSession,
    readonly options: RecordOptions,
  ) {}

  static async start(page: Page, options: RecordOptions): Promise<Recorder> {
    const cdp = await page.context().newCDPSession(page)
    const recorder = new Recorder(page, cdp, options)
    recorder.#timeOrigin = await page.evaluate(() => performance.timeOrigin)
    await installProbes(page, options.probes)
    cdp.on('Page.screencastFrame', (frame) => {
      void cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => undefined)
      const epochMs = frame.metadata.timestamp === undefined ? Date.now() : frame.metadata.timestamp * 1000
      recorder.#shots.push({
        t: epochMs - recorder.#timeOrigin,
        jpeg: Buffer.from(frame.data, 'base64'),
        deviceWidth: frame.metadata.deviceWidth,
        deviceHeight: frame.metadata.deviceHeight,
      })
    })
    const size = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 80, maxWidth: size.width, maxHeight: size.height, everyNthFrame: 1 })
    // The first image is the state before the action.
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    return recorder
  }

  /** Notes a step in the page's clock, so a check can look only at what followed it. */
  async mark(label: string): Promise<void> {
    await this.page.evaluate(
      ({ label: name, key: k }) => {
        const state = (window as unknown as Record<string, PageRecorder>)[k]!
        state.marks.push({ label: name, t: performance.now(), nextFrame: state.frames.length })
      },
      { label, key },
    )
  }

  /** Waits `settleMs` plus two frames, then stops and returns everything. */
  async stop(settleMs = 600): Promise<Recording> {
    await this.page.waitForTimeout(settleMs)
    const page = await this.page.evaluate(
      async ({ key: k, regions }) => {
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
        const state = (window as unknown as Record<string, PageRecorder>)[k]!
        state.stop()
        const rects: Record<string, { x: number; y: number; width: number; height: number }> = {
          // Without the frame stamp along the bottom edge.
          window: { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight - 8 },
        }
        for (const [name, selector] of Object.entries(regions)) {
          const element = [...document.querySelectorAll(selector)].find((el) => el.checkVisibility())
          if (element === undefined) continue
          const r = element.getBoundingClientRect()
          rects[name] = { x: r.x, y: r.y, width: r.width, height: r.height }
        }
        delete (window as unknown as Record<string, unknown>)[k]
        return { frames: state.frames, events: state.events, shifts: state.shifts, longFrames: state.longFrames, marks: state.marks, regions: rects, endedAt: performance.now() }
      },
      { key, regions: this.options.regions ?? {} },
    )
    await this.cdp.send('Page.stopScreencast').catch(() => undefined)
    await this.cdp.detach().catch(() => undefined)
    const shots = this.#shots.toSorted((a, b) => a.t - b.t).map((shot, index) => ({ ...shot, number: index + 1 }))
    return { ...page, shots, startedAt: page.frames[0]?.t ?? 0 }
  }
}

/** Starts the per-frame probes and the observers in the page. Everything here runs in the renderer. */
async function installProbes(page: Page, probes: ReadonlyArray<Probe>): Promise<void> {
  await page.evaluate(
    ({ probes: list, key: k, stampSpec }) => {
      const w = window as unknown as Record<string, PageRecorder | undefined>
      w[k]?.stop()

      const visible = (selector: string): HTMLElement | null => {
        for (const el of document.querySelectorAll<HTMLElement>(selector)) if (el.checkVisibility()) return el
        return null
      }
      const describe = (node: Node | null): string => {
        const el = node instanceof Element ? node : node?.parentElement
        if (el == null) return '(removed)'
        const label = el.getAttribute('aria-label') ?? el.getAttribute('title') ?? ''
        const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
        const data = [...el.attributes].filter((a) => a.name.startsWith('data-')).map((a) => `[${a.name}]`).join('')
        return `${el.tagName.toLowerCase()}${data}${label ? ` "${label}"` : ''}${text ? ` ${JSON.stringify(text)}` : ''}`
      }
      const layoutBox = (el: HTMLElement) => {
        let x = 0
        let y = 0
        for (let node: HTMLElement | null = el; node; node = node.offsetParent instanceof HTMLElement ? node.offsetParent : null) {
          x += node.offsetLeft - (node === el ? 0 : node.scrollLeft)
          y += node.offsetTop - (node === el ? 0 : node.scrollTop)
        }
        return { x, y, width: el.offsetWidth, height: el.offsetHeight }
      }
      const lastEdge = new Map<string, string>()
      const edge = (probe: Extract<Probe, { kind: 'edge' }>) => {
        const scroller = visible(probe.scroller)
        if (scroller === null) return null
        const box = scroller.getBoundingClientRect()
        const rows = scroller.querySelectorAll<HTMLElement>(`[${probe.rowKey}]`)
        let found: { key: string; at: number } | null = null
        for (const row of rows) {
          const r = row.getBoundingClientRect()
          if (r.height === 0 || r.bottom <= box.top || r.top >= box.bottom) continue
          const at = probe.side === 'top' ? r.top - box.top : r.bottom - box.top
          found = { key: row.getAttribute(probe.rowKey) ?? '', at }
          if (probe.side === 'top') break
        }
        const previousKey = lastEdge.get(probe.name) ?? null
        let previousAt: number | null = null
        if (previousKey !== null) {
          const row = scroller.querySelector<HTMLElement>(`[${probe.rowKey}="${CSS.escape(previousKey)}"]`)
          if (row !== null && row.getBoundingClientRect().height > 0) {
            const r = row.getBoundingClientRect()
            previousAt = probe.side === 'top' ? r.top - box.top : r.bottom - box.top
          }
        }
        if (found === null) {
          lastEdge.delete(probe.name)
          return null
        }
        lastEdge.set(probe.name, found.key)
        return { key: found.key, at: Math.round(found.at * 10) / 10, previousAt: previousAt === null ? null : Math.round(previousAt * 10) / 10, previousKey }
      }
      const read = (probe: Probe): ProbeValue => {
        switch (probe.kind) {
          case 'rect': {
            const el = visible(probe.selector)
            if (el === null) return null
            const r = el.getBoundingClientRect()
            return { x: r.x, y: r.y, width: r.width, height: r.height }
          }
          case 'box': {
            const el = visible(probe.selector)
            return el === null ? null : layoutBox(el)
          }
          case 'scroll': {
            const el = visible(probe.selector)
            return el === null ? null : { top: el.scrollTop, fromBottom: el.scrollHeight - el.scrollTop - el.clientHeight }
          }
          case 'count': {
            const el = visible(probe.within)
            return el === null ? 0 : el.querySelectorAll(probe.selector).length
          }
          case 'images': {
            const el = visible(probe.within)
            return el === null ? 0 : [...el.querySelectorAll('img')].filter((img) => img.complete && img.naturalWidth > 0).length
          }
          case 'text': {
            const el = visible(probe.selector)
            return el === null ? null : (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
          }
          case 'look': {
            const el = visible(probe.selector)
            if (el === null) return null
            const s = getComputedStyle(el)
            const moving = el.getAnimations({ subtree: true }).some((a) => a.playState === 'running')
            return [s.backgroundColor, s.color, s.borderColor, s.boxShadow, s.outlineColor, s.outlineStyle, s.transform, s.opacity, moving ? 'animating' : 'still'].join(' | ')
          }
          case 'edge':
            return edge(probe)
        }
      }

      // The frame stamp: guard cells, then the frame number in binary, painted in the frame the probes read.
      const stamp = document.createElement('div')
      stamp.setAttribute('aria-hidden', 'true')
      stamp.style.cssText = `position:fixed;left:0;bottom:0;display:flex;z-index:2147483647;pointer-events:none;height:${stampSpec.height}px`
      const cells = Array.from({ length: stampSpec.bits + 2 }, () => {
        const cell = document.createElement('span')
        cell.style.cssText = `width:${stampSpec.cell}px;height:${stampSpec.height}px;background:#000`
        stamp.append(cell)
        return cell
      })
      cells[1]!.style.background = '#fff'
      document.body.append(stamp)

      const state: PageRecorder = { frames: [], events: [], shifts: [], longFrames: [], marks: [], on: true, stop: () => undefined }
      const tick = (t: number) => {
        if (!state.on) return
        const values: Record<string, ProbeValue> = {}
        for (const probe of list) values[probe.name] = read(probe)
        const index = state.frames.length
        for (let bit = 0; bit < stampSpec.bits; bit++) cells[bit + 2]!.style.background = (index >> bit) & 1 ? '#000' : '#fff'
        state.frames.push({ index, t, values })
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)

      const onEvent = (event: Event) => state.events.push({ type: event.type, t: event.timeStamp, nextFrame: state.frames.length })
      const types = ['pointerover', 'pointerdown', 'pointerup', 'keydown', 'wheel']
      for (const type of types) window.addEventListener(type, onEvent, { capture: true, passive: true })

      const pushShifts = (entries: ReadonlyArray<PerformanceEntry>) => {
        for (const entry of entries) {
          const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean; sources?: ReadonlyArray<{ node: Node | null; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }> }
          state.shifts.push({
            t: shift.startTime,
            value: shift.value,
            hadRecentInput: shift.hadRecentInput,
            sources: (shift.sources ?? []).map((source) => ({
              node: describe(source.node),
              before: { x: source.previousRect.x, y: source.previousRect.y, width: source.previousRect.width, height: source.previousRect.height },
              after: { x: source.currentRect.x, y: source.currentRect.y, width: source.currentRect.width, height: source.currentRect.height },
            })),
          })
        }
      }
      const shifts = new PerformanceObserver((entries) => pushShifts(entries.getEntries()))
      shifts.observe({ type: 'layout-shift' })
      const long = new PerformanceObserver((entries) => {
        for (const entry of entries.getEntries()) {
          const frame = entry as PerformanceEntry & { blockingDuration?: number; scripts?: ReadonlyArray<{ duration: number; invoker: string; sourceFunctionName: string; sourceURL: string }> }
          state.longFrames.push({
            t: frame.startTime,
            duration: frame.duration,
            blocking: frame.blockingDuration ?? 0,
            scripts: (frame.scripts ?? []).filter((s) => s.duration > 5).map((s) => `${s.invoker} ${s.sourceFunctionName || '?'}@${s.sourceURL.split('/').pop()} ${Math.round(s.duration)}ms`),
          })
        }
      })
      long.observe({ type: 'long-animation-frame' })

      state.stop = () => {
        state.on = false
        stamp.remove()
        pushShifts(shifts.takeRecords())
        shifts.disconnect()
        long.disconnect()
        for (const type of types) window.removeEventListener(type, onEvent, { capture: true })
      }
      w[k] = state
    },
    { probes, key, stampSpec: STAMP },
  )
}
