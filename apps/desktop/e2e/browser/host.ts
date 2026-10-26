import { fork, type ChildProcess } from 'node:child_process'
import { basename, resolve } from 'node:path'
import type { FakeSlack } from '@juno/fake-slack'
import type { EngineOptions, HostCommand, HostMessage, HostStart, WorkerMessage } from '../../web/host/testHost'
import type { SystemCall, SystemHooks } from '../../web/shell'
import type { EngineHooks, WorkPassName } from '../driver/surface'

const repoRoot = resolve(__dirname, '../../../..')
/** What `build:web` makes: the renderer the hosts serve (`vite.web.config.ts`) and the host bundled into one file. */
export const WEB_BUILD = resolve(__dirname, '../../dist')

/** Node, even when Playwright itself was started by another runtime. */
const node = basename(process.execPath).startsWith('node') ? process.execPath : 'node'

interface Child {
  readonly process: ChildProcess
  readonly loaded: Promise<void>
}

async function within<T>(work: Promise<T>, millis: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), millis)
    })])
  } finally { clearTimeout(timer) }
}

async function terminate(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  if (child.connected) child.disconnect()
  try { await within(exited, 2_000, 'The host did not exit') } catch {
    child.kill('SIGKILL')
    await exited
  }
}

// One bundled file loads in about a fifth of the CPU time Node takes to strip and resolve the source's modules.
// A 256 MB heap (JUNO_HOST_HEAP_MB) holds a host near 230 MB resident; uncapped, Node let it grow to 340 MB
// (docs/development.md, "Memory").
function forkHost(build: string): Child {
  const child = fork(resolve(build, 'host/testHost.mjs'), [], {
    execPath: node,
    // JUNO_E2E_HOST_PROFILE=<dir> writes each host's CPU profile there when it exits.
    execArgv: ['--disable-warning=ExperimentalWarning', `--max-old-space-size=${process.env.JUNO_HOST_HEAP_MB ?? 256}`, ...(process.env.JUNO_E2E_HOST_PROFILE === undefined ? [] : ['--cpu-prof', `--cpu-prof-dir=${process.env.JUNO_E2E_HOST_PROFILE}`])],
    cwd: repoRoot,
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    // The test's own time zone: `bun test` runs in UTC without setting TZ, and a host in the machine's zone
    // would read the hours a test set for "now" as other hours.
    env: { ...process.env, JUNO_E2E: '1', NODE_OPTIONS: '', TZ: Intl.DateTimeFormat().resolvedOptions().timeZone },
  })
  const loaded = new Promise<void>((done, fail) => {
    const onMessage = (message: HostMessage) => {
      if (message.type !== 'loaded') return
      child.off('message', onMessage)
      done()
    }
    child.on('message', onMessage)
    child.once('exit', (code) => fail(new Error(`The test host exited before it loaded (code ${code})`)))
  })
  // A child may exit before the next lease awaits its startup.
  loaded.catch(() => undefined)
  return { process: child, loaded }
}

/**
 * One test's lease on a host: the engine and file server in a child process
 * (`web/host/testHost.ts`), against this test's fake Slack.
 */
export class TestHost implements EngineHooks {
  readonly #child: ChildProcess
  readonly #answers = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  #next = 0
  #exited = false
  #stopping: Promise<void> | undefined
  readonly #detach: () => void
  url = ''

  constructor(child: ChildProcess, fake: FakeSlack, readonly userData: string, readonly release: () => void) {
    this.#child = child
    const onMessage = (message: HostMessage) => {
      if (message.type === 'ask') {
        const reply: WorkerMessage = { type: 'reply', id: message.id, value: fake.signIn() }
        if (child.connected) child.send(reply, () => undefined)
      } else if (message.type === 'answer') {
        const waiting = this.#answers.get(message.id)
        this.#answers.delete(message.id)
        if (message.error === undefined) waiting?.resolve(message.value)
        else waiting?.reject(new Error(`test host: ${message.error}`))
      }
    }
    const onExit = (code: number | null) => {
      this.#exited = true
      for (const waiting of this.#answers.values()) waiting.reject(new Error(`The test host exited (code ${code})`))
      this.#answers.clear()
    }
    child.on('message', onMessage)
    child.once('exit', onExit)
    this.#detach = () => {
      child.off('message', onMessage)
      child.off('exit', onExit)
    }
  }

  #command<T>(command: HostCommand): Promise<T> {
    if (this.#exited || !this.#child.connected) return Promise.reject(new Error('The test host has exited'))
    const id = ++this.#next
    return new Promise<T>((resolve, reject) => {
      this.#answers.set(id, { resolve: resolve as (value: unknown) => void, reject })
      const message: WorkerMessage = { type: 'command', id, command }
      this.#child.send(message, (error) => {
        if (error === null) return
        this.#answers.delete(id)
        reject(error)
      })
    })
  }

  async start(start: HostStart): Promise<void> {
    const { url } = await this.#command<{ url: string }>({ type: 'start', start })
    this.url = url
  }

  system<K extends keyof SystemHooks>(name: K, ...args: Parameters<SystemHooks[K]>): Promise<ReturnType<SystemHooks[K]>> {
    return this.#command({ type: 'system', call: { name, args } as SystemCall })
  }

  /** Stops the engine, as quitting the app does. Leave the page first. */
  quitEngine(): Promise<void> {
    return this.#command({ type: 'quitEngine' })
  }

  /** Starts the engine again on the same data folder, as opening the app again does. Load the page after. */
  startEngine(engine?: EngineOptions): Promise<void> {
    return this.#command({ type: 'startEngine', ...(engine === undefined ? {} : { engine }) })
  }

  workPass(name: WorkPassName): Promise<void> {
    return this.#command({ type: 'workPass', name })
  }

  aiCalls(): Promise<Record<string, number>> {
    return this.#command({ type: 'aiCalls' })
  }

  /** Moves the engine's test clock forward (`EngineOptions.clock`). */
  jumpClock(millis: number): Promise<void> {
    return this.#command({ type: 'jumpClock', millis })
  }

  /** Ends this test's engine, agent and connections before returning the loaded process. */
  stop(): Promise<void> {
    return this.#stopping ??= this.#finish()
  }

  async #finish(): Promise<void> {
    try {
      if (this.#exited) return
      await within(this.#command({ type: 'stop' }), 5_000, 'The host did not stop its test')
      this.#detach()
      this.#exited = true
      this.release()
    } catch (error) {
      await terminate(this.#child)
      throw error
    } finally { this.#detach() }
  }
}

/**
 * A worker's loaded processes. Each lease creates a new engine and shell on
 * a fresh data folder. A failed cleanup discards the process. `build` is
 * the folder with `host/` and `renderer/`: `dist/` for the browser lane,
 * `dom/dist/` for the DOM lane.
 */
export class HostPool {
  #idle: Child[] = []
  readonly #children = new Set<ChildProcess>()

  constructor(readonly build = WEB_BUILD) {}

  #take(): Child {
    const ready = this.#idle.pop()
    if (ready !== undefined && ready.process.connected) return ready
    return this.#fork()
  }

  #fork(): Child {
    const child = forkHost(this.build)
    this.#children.add(child.process)
    child.process.once('exit', () => this.#children.delete(child.process))
    return child
  }

  /** Forks the first process before the first lease asks, so its load overlaps other work. */
  warm(): void {
    if (this.#children.size === 0) this.#idle.push(this.#fork())
  }

  async start(fake: FakeSlack, start: Omit<HostStart, 'fakeUrl' | 'webRoot'>): Promise<TestHost> {
    const child = this.#take()
    await child.loaded
    const host = new TestHost(child.process, fake, start.userData, () => this.#idle.push(child))
    try {
      await host.start({ ...start, fakeUrl: fake.url, webRoot: resolve(this.build, 'renderer') })
    } catch (error) {
      try { await host.stop() } finally { await terminate(child.process) }
      throw error
    }
    return host
  }

  async close(): Promise<void> {
    this.#idle = []
    await Promise.all([...this.#children].map(terminate))
  }
}
