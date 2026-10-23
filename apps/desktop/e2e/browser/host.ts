import { fork, type ChildProcess } from 'node:child_process'
import { basename, resolve } from 'node:path'
import type { FakeSlack } from '@juno/fake-slack'
import type { EngineOptions, HostCommand, HostMessage, HostStart, WorkerMessage } from '../../web/host/testHost'
import type { SystemCall, SystemHooks } from '../../web/shell'
import type { EngineHooks, WorkPassName } from '../driver/surface'

const repoRoot = resolve(__dirname, '../../../..')
/** What `build:web` makes: the renderer the hosts serve (`vite.web.config.ts`) and the host bundled into one file. */
export const WEB_BUILD = resolve(__dirname, '../../dist')
export const WEB_ROOT = resolve(WEB_BUILD, 'renderer')
// One bundled file loads in about a fifth of the CPU time Node takes to strip and resolve the source's modules.
const entry = resolve(WEB_BUILD, 'host/testHost.mjs')

/** Node, even when Playwright itself was started by another runtime. */
const node = basename(process.execPath).startsWith('node') ? process.execPath : 'node'

interface Child {
  readonly process: ChildProcess
  readonly loaded: Promise<void>
}

function forkHost(): Child {
  const child = fork(entry, [], {
    execPath: node,
    // JUNO_E2E_HOST_PROFILE=<dir> writes each host's CPU profile there when it exits.
    execArgv: ['--disable-warning=ExperimentalWarning', ...(process.env.JUNO_E2E_HOST_PROFILE === undefined ? [] : ['--cpu-prof', `--cpu-prof-dir=${process.env.JUNO_E2E_HOST_PROFILE}`])],
    cwd: repoRoot,
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    env: { ...process.env, JUNO_E2E: '1', NODE_OPTIONS: '' },
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
  // A spare nobody takes must not hold the worker's exit.
  loaded.catch(() => undefined)
  return { process: child, loaded }
}

/**
 * One test's host: the engine and file server in a child process
 * (`web/host/testHost.ts`), against this test's fake Slack.
 */
export class TestHost implements EngineHooks {
  readonly #child: ChildProcess
  readonly #answers = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  #next = 0
  #exited = false
  url = ''

  constructor(child: ChildProcess, fake: FakeSlack, readonly userData: string) {
    this.#child = child
    child.on('message', (message: HostMessage) => {
      if (message.type === 'ask') {
        const reply: WorkerMessage = { type: 'reply', id: message.id, value: fake.signIn() }
        if (child.connected) child.send(reply, () => undefined)
      } else if (message.type === 'answer') {
        const waiting = this.#answers.get(message.id)
        this.#answers.delete(message.id)
        if (message.error === undefined) waiting?.resolve(message.value)
        else waiting?.reject(new Error(`test host: ${message.error}`))
      }
    })
    child.once('exit', (code) => {
      this.#exited = true
      for (const waiting of this.#answers.values()) waiting.reject(new Error(`The test host exited (code ${code})`))
      this.#answers.clear()
    })
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

  /** Stops the engine and the server, then the process. */
  async stop(): Promise<void> {
    if (!this.#exited) await Promise.race([this.#command({ type: 'stop' }).catch(() => undefined), new Promise((done) => setTimeout(done, 5_000))])
    if (!this.#exited) {
      const exited = new Promise((done) => this.#child.once('exit', done))
      this.#child.disconnect()
      await Promise.race([exited, new Promise((done) => setTimeout(done, 2_000))])
      if (!this.#exited) this.#child.kill('SIGKILL')
    }
  }
}

/**
 * A worker's hosts. It keeps one spare process loaded while a test runs, so
 * the next test does not wait for Node to load the engine (about 1.3 s).
 */
export class HostPool {
  #spare: Child | undefined

  #take(): Child {
    const child = this.#spare ?? forkHost()
    this.#spare = forkHost()
    return child
  }

  async start(fake: FakeSlack, start: Omit<HostStart, 'fakeUrl' | 'webRoot'>): Promise<TestHost> {
    const child = this.#take()
    await child.loaded
    const host = new TestHost(child.process, fake, start.userData)
    try {
      await host.start({ ...start, fakeUrl: fake.url, webRoot: WEB_ROOT })
    } catch (error) {
      await host.stop()
      throw error
    }
    return host
  }

  close(): void {
    const spare = this.#spare
    this.#spare = undefined
    if (spare !== undefined && spare.process.connected) spare.process.disconnect()
  }
}
