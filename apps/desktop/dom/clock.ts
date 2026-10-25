/**
 * The DOM lane's test clock, as Playwright's `page.clock`: installed before
 * the renderer loads, it owns the page's `Date`, `performance.now`,
 * `setTimeout` and `setInterval`. Time flows with real time until a test
 * moves it: `fastForward` jumps and fires each due timer once, `runFor`
 * fires every timer in order, `pauseAt` jumps and stops. The engine's
 * clock follows every jump (`EngineClock`, the host's `clock` command), so
 * a wait in the engine (a slow fake model, a debounce) passes with the
 * page's. Animation frames and React's scheduler keep real time.
 */
export interface EngineClock {
  /** Moves the engine's clock forward by `millis`, running the sleeps that fall due. */
  jump(millis: number): Promise<void>
}

interface Timer {
  readonly id: number
  at: number
  readonly run: () => void
  readonly every: number | undefined
}

type Callback = (...args: unknown[]) => void

export class PageClock {
  readonly #realNow = Date.now
  readonly #realSetTimeout = globalThis.setTimeout
  #offset = 0
  #paused: number | undefined
  #fixed: number | undefined
  #next = 1
  readonly #timers = new Map<number, Timer>()
  #tick: ReturnType<typeof setInterval> | undefined
  #engine: EngineClock | undefined

  constructor(start?: number) {
    if (start !== undefined) this.#offset = start - this.#realNow()
  }

  /** The page's time now. */
  now(): number {
    return this.#paused ?? this.#realNow() + this.#offset
  }

  /** Replaces the window's timers and dates. Call before the renderer's script runs. */
  install(window: object, engine?: EngineClock): void {
    // A relaunch installs it in the new window; the old window's timers went with it.
    clearInterval(this.#tick)
    this.#timers.clear()
    this.#engine = engine
    const target = window as Record<string, unknown>
    const RealDate = (target['Date'] ?? Date) as DateConstructor
    const now = () => this.#fixed ?? this.now()
    class FakeDate extends RealDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) super(now())
        else super(...(args as [number]))
      }

      static override now(): number {
        return now()
      }
    }
    target['Date'] = FakeDate
    // happy-dom hands the window Bun's own `performance`; the page gets a view of it whose `now` is the clock's.
    const real = target['performance'] as Performance | undefined
    if (real !== undefined) {
      const origin = this.now()
      const now = () => this.now() - origin
      const view = new Proxy(real, {
        get: (object, key) => {
          if (key === 'now') return now
          const value: unknown = Reflect.get(object, key, object)
          return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(object) : value
        },
      })
      Object.defineProperty(target, 'performance', { configurable: true, value: view })
    }
    target['setTimeout'] = (run: Callback, delay = 0, ...args: unknown[]) => this.#add(run, delay, args, undefined)
    target['setInterval'] = (run: Callback, delay = 0, ...args: unknown[]) => this.#add(run, delay, args, Math.max(1, Number(delay) || 0))
    target['clearTimeout'] = target['clearInterval'] = (id: number | undefined) => { if (id !== undefined) this.#timers.delete(Number(id)) }
    this.#tick = setInterval(() => { if (this.#paused === undefined) this.#fireDue(this.now()) }, 4)
  }

  #add(run: Callback, delay: number, args: unknown[], every: number | undefined): number {
    const id = this.#next++
    this.#timers.set(id, { id, at: this.now() + Math.max(0, Number(delay) || 0), run: () => run(...args), every })
    return id
  }

  /** Fires the timers due by `time`, each once, earliest first. */
  #fireDue(time: number): void {
    for (const timer of [...this.#timers.values()].filter((each) => each.at <= time).toSorted((a, b) => a.at - b.at || a.id - b.id)) this.#fire(timer, time)
  }

  #fire(timer: Timer, time: number): void {
    if (!this.#timers.has(timer.id)) return
    if (timer.every === undefined) this.#timers.delete(timer.id)
    else timer.at = time + timer.every
    try { timer.run() } catch (error) { console.error('[page] timer failed:', error) }
  }

  async #settle(): Promise<void> {
    await new Promise((done) => this.#realSetTimeout(done, 0))
  }

  #move(millis: number): void {
    if (this.#paused !== undefined) this.#paused += millis
    else this.#offset += millis
  }

  /**
   * Jumps forward, as a laptop lid closed for that long: the engine's clock
   * first, then each page timer that fell due fires once.
   */
  async fastForward(millis: number | string): Promise<void> {
    const ms = toMillis(millis)
    await this.#engine?.jump(ms)
    this.#move(ms)
    this.#fireDue(this.now())
    await this.#settle()
  }

  /** Runs time forward through every page timer in order, intervals included, settling the page after each. */
  async runFor(millis: number | string): Promise<void> {
    const target = this.now() + toMillis(millis)
    const paused = this.#paused !== undefined
    this.#paused = this.now()
    for (;;) {
      const next = [...this.#timers.values()].filter((each) => each.at <= target).toSorted((a, b) => a.at - b.at || a.id - b.id)[0]
      if (next === undefined) break
      await this.#engine?.jump(Math.max(0, next.at - this.#paused))
      this.#paused = Math.max(this.#paused, next.at)
      this.#fire(next, this.#paused)
      await this.#settle()
    }
    await this.#engine?.jump(target - this.#paused)
    this.#paused = target
    if (!paused) this.resume()
    await this.#settle()
  }

  /** Jumps to `time` (firing what falls due once) and stops there. */
  async pauseAt(time: number | Date): Promise<void> {
    const at = typeof time === 'number' ? time : time.getTime()
    if (at > this.now()) await this.fastForward(at - this.now())
    this.#paused = at
  }

  /** Time flows again from where it stopped. */
  resume(): void {
    if (this.#paused === undefined) return
    this.#offset = this.#paused - this.#realNow()
    this.#paused = undefined
  }

  /** `Date` answers `time` until this is called again with undefined; timers keep running. */
  setFixedTime(time: number | Date | undefined): void {
    this.#fixed = time === undefined ? undefined : typeof time === 'number' ? time : time.getTime()
  }

  /** Sets the time without firing any timer. */
  setSystemTime(time: number | Date): void {
    const at = typeof time === 'number' ? time : time.getTime()
    if (this.#paused !== undefined) this.#paused = at
    else this.#offset = at - this.#realNow()
  }

  close(): void {
    clearInterval(this.#tick)
    this.#timers.clear()
  }
}

/** A number of milliseconds, or Playwright's "hh:mm:ss" / "mm:ss" strings. */
function toMillis(value: number | string): number {
  if (typeof value === 'number') return value
  const parts = value.split(':').map(Number)
  if (parts.some((part) => !Number.isFinite(part))) throw new Error(`Not a duration: ${value}`)
  return parts.reduce((total, part) => total * 60 + part, 0) * 1_000
}
