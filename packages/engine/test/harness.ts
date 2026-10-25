import { timed } from './profile'
import { Effect, Record } from 'effect'
import type { WorkName } from '../src/workControl'
/**
 * The engine end to end inside Node: the real engine over a MessageChannel,
 * the real state atoms, an in-process fake Slack, and a scripted "main" that
 * answers the engine's parentPort requests the way apps/desktop does.
 */
import { productionTiming, type EngineTimingConfig } from '../src/config'
import { appendFileSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'
import { HttpTransport } from '@juno/slack'
import { prefs, Store, workspacePaths } from '@juno/store'
import { migratedWorkspace } from './migratedWorkspace'
import { startFakeSlack, type Credentials, type FakeSlack, type FakeSlackOptions } from '@juno/fake-slack'
import type { EngineStatus, SessionSecrets, SessionStatus, TopicRow } from '@juno/contract'
import {
  configureConnection,
  engineStatusAtom,
  makeRegistry,
  sessionStatusAtom,
  topicListAtom,
  type ListWindow,
  type PortLike,
  type Registry,
  type TopicListFilter,
} from '@juno/state'
import { memoryHost, startEngine, type EngineHandle, type EngineHostOptions } from '../src/index'
import { memoryTransport, type MessagePortLike, type Transport } from '../src/protocol/transport'

/**
 * How long a harness wait allows by default: half the test timeout
 * (`setDefaultTimeout` in packages/testing/src/preload.ts), so a slow step on a
 * loaded machine still fails with the step's label before the test times out.
 */
export const WAIT_MS = 15_000

/** Polls a condition, awaiting async predicates before deciding whether to poll again. */
export async function waitFor<A>(f: () => A | undefined | Promise<A | undefined>, timeoutMs = WAIT_MS, label = 'condition'): Promise<Exclude<A, undefined>> {
  const started = Date.now()
  while (true) {
    const value = await f()
    if (value !== undefined) return value as Exclude<A, undefined>
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await sleep(5)
  }
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const rowsFrom = (window: ListWindow<TopicRow>) => window.order.map((id) => window.rows.get(id)!)

export const toSecrets = (c: Credentials): SessionSecrets => ({
  teamId: c.teamId,
  userId: c.userId,
  workspaceUrl: c.url,
  token: c.token,
  teamName: 'Juno Fake',
})

/**
 * What main does for the engine, in miniature: keeps `stored`, answers
 * `requestSecrets`, performs a "sign-in" by minting a fresh fake session,
 * serialises the cookie for the socket, and clears on sign-out.
 */
export function fakeMain(fake: FakeSlack, initial?: Credentials) {
  const host = memoryHost()
  let current = initial
  let stored: SessionSecrets | null = initial === undefined ? null : toSecrets(initial)
  let nextSignIn: (() => Credentials | { failed: { kind: 'keychain'; message: string } }) | undefined
  host.onEngine((message) => {
    switch (message._tag) {
      case 'requestSecrets':
        host.deliver({ _tag: 'secrets', secrets: stored })
        break
      case 'importFromSlackApp': {
        const outcome = nextSignIn === undefined ? fake.signIn() : nextSignIn()
        if ('failed' in outcome) {
          host.deliver({ _tag: 'sessionFailed', method: 'import', ...outcome.failed })
        } else {
          current = outcome
          host.deliver({ _tag: 'secrets', secrets: toSecrets(outcome) })
        }
        break
      }
      case 'storeSecrets':
        stored = message.secrets
        host.deliver({ _tag: 'secretsStored' })
        break
      case 'signOut':
        stored = null
        current = undefined
        host.deliver({ _tag: 'signedOut' })
        break
      case 'handshake':
        host.deliver({
          _tag: 'handshake',
          id: message.id,
          cookie: current === undefined ? '' : `d=${current.cookie}`,
          origin: 'https://app.slack.com',
          userAgent: 'Juno test',
          proxy: network.proxy,
        })
        break
      default:
        break
    }
  })
  // The engine's HTTP transport: the cookie Chromium would attach comes from the "session".
  // With `network.offline` every request fails the way a dropped connection does.
  // `network.proxy` is Chromium's proxy answer for the socket URL.
  // With `network.resend`, a request whose connection closes before any answer is sent once more,
  // as Chromium does on a reused connection (ADR 0014); Node's fetch never does.
  const network = { offline: false, proxy: 'DIRECT', resend: false }
  const send = (input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) =>
    fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string>), ...(current === undefined ? {} : { cookie: `d=${current.cookie}` }) } })
  const httpTransport = HttpTransport.nodeFetch({
    fetch: (input, init) =>
      network.offline ? Promise.reject(new TypeError('fetch failed')) : send(input, init).catch((cause: unknown) => (network.resend && !init?.signal?.aborted ? send(input, init) : Promise.reject(cause))),
  })
  return {
    host,
    httpTransport,
    /** Set `offline` to fail every Slack API request as a dropped connection would; `proxy` to answer the socket handshake with a proxy; `resend` to send a request again after its connection closed, as Chromium does. */
    network,
    get stored() {
      return stored
    },
    failNextSignIn: (kind: 'keychain', message: string) => {
      nextSignIn = () => ({ failed: { kind, message } })
    },
  }
}

export interface RunningEngine {
  readonly fake: FakeSlack
  readonly main: ReturnType<typeof fakeMain>
  readonly registry: Registry
  /** A second renderer: a new registry on a new port to the same engine. `stop` disposes it. */
  readonly openWindow: () => Registry
  readonly userData: string
  readonly handle: EngineHandle
  readonly status: (tag: SessionStatus['_tag']) => Promise<SessionStatus>
  /** A harmless unknown frame proves earlier socket frames were consumed. */
  readonly socketIdle: () => Promise<void>
  /** Requests and awaits a complete pass through its normal serial worker. */
  readonly workPass: (name: WorkName) => Promise<void>
  /** Number of actions that passed preflight and requested the send lane. */
  readonly actionsReady: () => number
  /** Commands holding or waiting for the same target lock. */
  readonly pendingCommands: (key: string) => number
  /** Waits for boot or reconnect and its follow pass to finish. Does not drain socket events or command retries. */
  readonly syncIdle: () => Promise<void>
  /** Waits for a sync cycle that starts after this call to finish. */
  readonly nextSync: (timeoutMs?: number) => Promise<void>
  /** Whether a sync cycle (boot, catch-up or sweep, with its follow pass) is running now. */
  readonly syncing: () => boolean
  /** Whether the engine's outbox workers see the socket as up (`SyncLink.online`). */
  readonly online: () => boolean
  readonly phase: (tag: EngineStatus['phase']['_tag'], timeoutMs?: number) => Promise<EngineStatus['phase']>
  /** The mounted list atom for a filter. */
  readonly topicsAtom: (filter?: TopicListFilter) => ReturnType<typeof topicListAtom>
  /** The sidebar window for a filter, once it has at least one message from the engine. */
  readonly topics: (filter?: TopicListFilter) => Promise<ListWindow<TopicRow>>
  readonly rows: (filter?: TopicListFilter) => Promise<ReadonlyArray<TopicRow>>
  /** The rows once `predicate` holds for them. */
  readonly rowsUntil: (predicate: (rows: ReadonlyArray<TopicRow>) => boolean, label?: string, filter?: TopicListFilter) => Promise<ReadonlyArray<TopicRow>>
  readonly stop: () => Promise<void>
}

export interface EngineOptions {
  readonly notifications?: EngineHostOptions['notifications']
  /** A session main already holds, as after a relaunch. */
  readonly initial?: (fake: FakeSlack) => Credentials
  readonly enterpriseId?: string
  readonly fakeOptions?: FakeSlackOptions
  /** Reuse a user-data directory (a warm boot) and a fake. */
  readonly reuse?: { readonly userData: string; readonly fake: FakeSlack; readonly credentials: Credentials }
  /** Serve the AgentHost group on these ports, as for the agent process (ADR 0012). */
  readonly agent?: { readonly transport: Transport; readonly writes?: 'enabled' | 'disabled' }
  /** Scheduling overrides on the fast profile. Data ages and Retry-After stay real. */
  readonly timing?: Partial<EngineTimingConfig>
  readonly clock?: EngineHostOptions['clock']
  /** How many topics the recheck after a drop reads (the app reads 10). */
  readonly recheckTopics?: number
  /** Saved topic window for scenarios that need older cached history. */
  readonly quietDays?: number
  /**
   * Space Slack calls as the app does (`SlackConfig.lanes`), not with the fake's pacing off, every spacing divided
   * by this number (1 is the app's pacing) so the methods keep their real ratios.
   */
  readonly paced?: number
  /** Run the background AI jobs (titles, art, Home's AI items, Juno's Automated check). Off by default, so a test sees no AI result it did not ask for. */
  readonly aiJobs?: boolean
}

/** All scheduling ratios stay at 1:20; explicit sync passes replace periodic work in ordinary tests. */
export const fastTiming: EngineTimingConfig = {
  ...Record.map(productionTiming, (millis) => millis / 20),
  sweepIntervalMillis: 0,
  followPassMillis: 0,
  // Retry-After stays real, so the wait it is compared with does too.
  slackInteractiveMaxWaitMillis: productionTiming.slackInteractiveMaxWaitMillis,
}

/** Starts a fake (unless reused) and the engine on it, with the atoms a test reads. */
export async function startTestEngine(options: EngineOptions = {}): Promise<RunningEngine> {
  // JUNO_BOOT_LOG=<file> counts boots: one line per engine, `cold` on an empty store, `warm` on a used one.
  if (process.env.JUNO_BOOT_LOG) appendFileSync(process.env.JUNO_BOOT_LOG, options.reuse === undefined ? 'cold\n' : 'warm\n')
  const fake =
    options.reuse?.fake ??
    (await timed('fake and seed', () => startFakeSlack({
      ...options.fakeOptions,
      ...(options.enterpriseId === undefined ? {} : { enterpriseId: options.enterpriseId }),
    })))
  const credentials = options.reuse?.credentials ?? options.initial?.(fake)
  const main = fakeMain(fake, credentials)
  const userData = options.reuse?.userData ?? join(tmpdir(), `juno-engine-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  await mkdir(userData, { recursive: true })
  if (options.reuse === undefined) {
    const enterprise = fake.workspace.team.enterprise_id
    await timed('schema copy', () => migratedWorkspace(workspacePaths(userData, enterprise === undefined ? fake.teamId : `${enterprise}-${fake.teamId}`)))
  }
  if (options.quietDays !== undefined) {
    await Effect.runPromise(prefs.set('quietDays', options.quietDays).pipe(Effect.provide(Store.layer(workspacePaths(userData, fake.teamId))), Effect.scoped))
  }
  const transport = memoryTransport()
  let cycles = 0
  let pendingCycles = 0
  let online = false
  const commands = new Map<string, number>()
  let actionsReady = 0
  let barrierSent = 0
  let barrierSeen = 0
  const work = new Map<WorkName, { started: number; finished: number; wake?: Effect.Effect<void> }>()
  const stateOf = (name: WorkName) => {
    let state = work.get(name)
    if (state === undefined) { state = { started: 0, finished: 0 }; work.set(name, state) }
    return state
  }
  const handle = await timed('engine construction', () => startEngine(transport, { userData, e2e: true, dev: false, fakeSlackUrl: fake.url, ai: 'fake', aiJobs: options.aiJobs === true, ...(options.paced === undefined ? {} : { fakeSlackPaced: true, ...(options.paced === 1 ? {} : { fakeSlackPaceScale: options.paced }) }) }, {
    timing: { ...fastTiming, ...options.timing },
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    work: {
      onCommands: (key, count) => { if (count === 0) commands.delete(key); else commands.set(key, count) },
      onActionReady: () => { actionsReady++ },
      onPass: (name, event) => {
        const state = stateOf(name)
        if (event === 'started') state.started++
        else state.finished = state.started
      },
      onWake: (name, wake) => { const state = stateOf(name); if (wake === undefined) delete state.wake; else state.wake = wake },
    },
    ...(options.notifications === undefined ? {} : { notifications: options.notifications }),
    host: main.host,
    httpTransport: main.httpTransport,
    ...(options.agent === undefined ? {} : { agentTransport: options.agent.transport, agentWrites: options.agent.writes ?? 'disabled' }),
    sync: {
      config: options.recheckTopics === undefined ? {} : { recheckTopics: options.recheckTopics },
      onEvent: (event) => {
        if (event._tag === 'Frame' && event.frame.type === 'unknown') {
          const raw = event.frame.raw
          if (typeof raw === 'object' && raw !== null && 'junoTestBarrier' in raw && typeof raw.junoTestBarrier === 'number') barrierSeen = raw.junoTestBarrier
        }
      },
      onCycle: (event) => {
        if (event === 'started') {
          cycles += 1
          pendingCycles += 1
        } else pendingCycles -= 1
      },
      onConnection: (next) => {
        online = next
      },
    },
  }))
  const connection = {
    acquire: async () => {
      const channel = new MessageChannel()
      transport.add(channel.port2 as unknown as MessagePortLike)
      return channel.port1 as unknown as PortLike
    },
  }
  const registry = makeRegistry()
  configureConnection(registry, connection)
  const windows: Array<Registry> = []
  const openWindow = () => {
    const window = makeRegistry()
    configureConnection(window, connection)
    windows.push(window)
    return window
  }
  const unmounts: Array<() => void> = [registry.mount(sessionStatusAtom), registry.mount(engineStatusAtom)]
  const mounted = new Set<unknown>()
  const topicsOf = (filter?: TopicListFilter) => {
    const atom = topicListAtom(filter)
    if (!mounted.has(atom)) {
      mounted.add(atom)
      unmounts.push(registry.mount(atom))
    }
    return atom
  }
  const topics = (filter?: TopicListFilter) =>
    waitFor(() => {
      const result = registry.get(topicsOf(filter))
      return result._tag === 'Success' && result.value.meta.seq > 0 ? result.value : undefined
    }, WAIT_MS, 'the topic list')
  return {
    fake,
    main,
    registry,
    openWindow,
    userData,
    handle,
    status: (tag) =>
      waitFor(
        () => {
          const result = registry.get(sessionStatusAtom)
          return result._tag === 'Success' && result.value._tag === tag ? result.value : undefined
        },
        WAIT_MS,
        `session ${tag}`,
      ),
    socketIdle: async () => {
      if (!online) return
      const id = ++barrierSent
      fake.emitFrame({ type: 'juno_test_barrier', junoTestBarrier: id })
      await waitFor(() => barrierSeen >= id || !online ? true : undefined, WAIT_MS, 'socket frames consumed')
    },
    actionsReady: () => actionsReady,
    pendingCommands: (key) => commands.get(key) ?? 0,
    workPass: async (name) => {
      const state = stateOf(name)
      const wake = await waitFor(() => state.wake, WAIT_MS, `${name} worker ready`)
      const started = state.started
      await Effect.runPromise(wake)
      await waitFor(() => state.finished > started ? true : undefined, WAIT_MS, `${name} pass finished`)
    },
    syncIdle: async () => {
      await waitFor(() => (cycles > 0 && pendingCycles === 0 ? true : undefined), WAIT_MS, 'the sync cycle to finish')
    },
    nextSync: async (timeoutMs = WAIT_MS) => {
      const previous = cycles
      await waitFor(() => (cycles > previous && pendingCycles === 0 ? true : undefined), timeoutMs, 'the next sync cycle to finish')
    },
    syncing: () => pendingCycles > 0,
    online: () => online,
    phase: (tag, timeoutMs = WAIT_MS) =>
      waitFor(
        () => {
          const result = registry.get(engineStatusAtom)
          return result._tag === 'Success' && result.value.phase._tag === tag ? result.value.phase : undefined
        },
        timeoutMs,
        `phase ${tag}`,
      ),
    topicsAtom: topicsOf,
    topics,
    rows: async (filter) => rowsFrom(await topics(filter)),
    rowsUntil: (predicate, label = 'rows', filter) =>
      waitFor(
        () => {
          const result = registry.get(topicsOf(filter))
          if (result._tag !== 'Success' || result.value.meta.seq === 0) return undefined
          const rows = rowsFrom(result.value)
          return predicate(rows) ? rows : undefined
        },
        WAIT_MS,
        label,
      ),
    stop: async () => {
      for (const unmount of unmounts.splice(0)) unmount()
      for (const window of windows.splice(0)) window.dispose()
      registry.dispose()
      await handle.stop()
      if (options.reuse === undefined) {
        await fake.close()
        await rm(userData, { recursive: true, force: true })
      }
    },
  }
}
