/**
 * The engine end to end inside Node: the real engine over a MessageChannel,
 * the real state atoms, an in-process fake Slack, and a scripted "main" that
 * answers the engine's parentPort requests the way apps/desktop does.
 */
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'
import { HttpTransport } from '@juno/slack'
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
 * (`vitest.config.ts`), so a slow step on a loaded machine still fails with
 * the step's label before the test itself times out.
 */
export const WAIT_MS = 45_000

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
  let nextSignIn: (() => Credentials | { failed: { kind: 'cancelled' | 'keychain'; message: string } }) | undefined
  host.onEngine((message) => {
    switch (message._tag) {
      case 'requestSecrets':
        host.deliver({ _tag: 'secrets', secrets: stored })
        break
      case 'signIn':
      case 'importFromSlackApp': {
        const outcome = nextSignIn === undefined ? fake.signIn() : nextSignIn()
        if ('failed' in outcome) {
          host.deliver({ _tag: 'sessionFailed', method: message._tag === 'signIn' ? 'window' : 'import', ...outcome.failed })
        } else {
          current = outcome
          host.deliver({ _tag: 'secrets', secrets: toSecrets(outcome) })
        }
        break
      }
      case 'storeSecrets':
        stored = message.secrets
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
          proxy: 'DIRECT',
        })
        break
      default:
        break
    }
  })
  // The engine's HTTP transport: the cookie Chromium would attach comes from the "session".
  // With `network.offline` every request fails the way a dropped connection does.
  const network = { offline: false }
  const httpTransport = HttpTransport.nodeFetch({
    fetch: (input, init) =>
      network.offline
        ? Promise.reject(new TypeError('fetch failed'))
        : fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string>), ...(current === undefined ? {} : { cookie: `d=${current.cookie}` }) } }),
  })
  return {
    host,
    httpTransport,
    /** Set `offline` to fail every Slack API request as a dropped connection would. */
    network,
    get stored() {
      return stored
    },
    failNextSignIn: (kind: 'cancelled' | 'keychain', message: string) => {
      nextSignIn = () => ({ failed: { kind, message } })
    },
  }
}

export interface RunningEngine {
  readonly fake: FakeSlack
  readonly main: ReturnType<typeof fakeMain>
  readonly registry: Registry
  readonly userData: string
  readonly handle: EngineHandle
  readonly status: (tag: SessionStatus['_tag']) => Promise<SessionStatus>
  /** Waits for boot or reconnect and its follow pass to finish. Does not drain socket events or command retries. */
  readonly syncIdle: () => Promise<void>
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
  /** How long a failed boot waits before it tries again (the app waits 30 s). */
  readonly bootRetryMillis?: number
}

/** Starts a fake (unless reused) and the engine on it, with the atoms a test reads. */
export async function startTestEngine(options: EngineOptions = {}): Promise<RunningEngine> {
  const fake =
    options.reuse?.fake ??
    (await startFakeSlack({
      ...options.fakeOptions,
      ...(options.enterpriseId === undefined ? {} : { enterpriseId: options.enterpriseId }),
    }))
  const credentials = options.reuse?.credentials ?? options.initial?.(fake)
  const main = fakeMain(fake, credentials)
  const userData = options.reuse?.userData ?? join(tmpdir(), `juno-engine-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  await mkdir(userData, { recursive: true })
  const transport = memoryTransport()
  let cycles = 0
  let pendingCycles = 0
  const handle = await startEngine(transport, { userData, e2e: true, dev: false, fakeSlackUrl: fake.url, ai: 'fake' }, {
    ...(options.notifications === undefined ? {} : { notifications: options.notifications }),
    host: main.host,
    httpTransport: main.httpTransport,
    ...(options.agent === undefined ? {} : { agentTransport: options.agent.transport, agentWrites: options.agent.writes ?? 'disabled' }),
    sync: {
      config: { sweepIntervalMillis: 0, ...(options.bootRetryMillis === undefined ? {} : { bootRetryMillis: options.bootRetryMillis }) },
      onCycle: (event) => {
        if (event === 'started') {
          cycles += 1
          pendingCycles += 1
        } else pendingCycles -= 1
      },
    },
  })
  const registry = makeRegistry()
  configureConnection(registry, {
    acquire: async () => {
      const channel = new MessageChannel()
      transport.add(channel.port2 as unknown as MessagePortLike)
      return channel.port1 as unknown as PortLike
    },
  })
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
    syncIdle: async () => {
      await waitFor(() => (cycles > 0 && pendingCycles === 0 ? true : undefined), WAIT_MS, 'the sync cycle to finish')
    },
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
      registry.dispose()
      await handle.stop()
      if (options.reuse === undefined) {
        await fake.close()
        await rm(userData, { recursive: true, force: true })
      }
    },
  }
}
