// The agent's renderer RPCs as the renderer reads them (plan v3 §12, §13): the real turn engine with
// the scripted fake provider, served over a Node MessageChannel (the same structured-clone port main
// brokers) and read through an RPC client of `AgentRpcs`. Settings › Juno runs on a model picker:
// on OpenRouter it reads the fake catalogue, beside the scripted model; with `custom`, the engine runs
// on the app's providers (`providerTurns`) against a fake OpenAI-compatible server over HTTP.
import { MessageChannel, type MessagePort } from 'node:worker_threads'
import { Effect, Exit, Layer, Scope, Stream, SubscriptionRef } from 'effect'
import { RpcClient, type RpcClientError, type RpcGroup } from 'effect/rpc'
import { openRouterCatalogue } from '@juno/agent-testing'
import { AgentRpcs, type ChatPage, type HostPresence } from '@juno/agent-contract'
import type { AgentProvider } from '@juno/agent-contract'
import { CHAT_MIGRATIONS, hostProtocol, modelPicker, providerConnection, providerTurns, rendererPorts, type HostPort } from '../src/index'
import { rendererServer } from '../src/serve/server'
import { createJunoSettings } from '../src/settings/settings'
import { turnsHarness, type HarnessOptions } from './turns-harness'

export type Client = RpcClient.RpcClient<RpcGroup.Rpcs<typeof AgentRpcs>, RpcClientError.RpcClientError>
export type Presence = typeof HostPresence.Type

const cleanups: Array<() => Promise<void>> = []
/** Closes every engine, settings and scope `served` opened. Each test file calls it in its own `afterEach`. */
export async function closeServed() {
  for (const cleanup of cleanups.splice(0).toReversed()) await cleanup()
}

const nodePort = (port: MessagePort): HostPort => ({
  postMessage: (message) => port.postMessage(message),
  onMessage: (f) => {
    port.on('message', f)
  },
  onClose: (f) => {
    port.on('close', f)
  },
  close: () => port.close(),
})

export const ONLINE: Presence = { online: true, aiEnabled: true, quietHours: false, ownerActive: true, accountId: null, thisTopic: null }

export const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(Effect.result(effect))

export const TEST_KEY = 'sk-or-v1-test'

/** The engine with Settings › Juno, served to one renderer client. */
export async function served(options: HarnessOptions & { readonly custom?: { readonly baseUrl: string; readonly key: string | null } } = {}) {
  const connection = providerConnection()
  const provider: AgentProvider = options.custom === undefined ? { _tag: 'openRouter', key: TEST_KEY } : { _tag: 'custom', ...options.custom }
  connection.set(provider)
  let catalogueReads = 0
  const picker = modelPicker(
    connection,
    options.custom === undefined
      ? {
          fetch: async () => {
            catalogueReads++
            return Response.json(openRouterCatalogue())
          },
        }
      : {
          // The endpoint's list is real HTTP; OpenRouter's catalogue, after a switch, is the fake one.
          fetch: async (url, init) => (String(url).endsWith('/api/v1/models') ? Response.json(openRouterCatalogue()) : fetch(url, init)),
        },
  )
  const app = options.custom === undefined ? {} : { app: providerTurns(connection, picker) }
  const h = await turnsHarness({ compaction: false, ...options, ...app, migrations: [CHAT_MIGRATIONS, ...(options.migrations ?? [])] })
  cleanups.push(h.close)
  const presence = await Effect.runPromise(SubscriptionRef.make<Presence | undefined>(ONLINE))
  let current: Presence | undefined = ONLINE
  const setPresence = (next: Presence) => {
    current = next
    return Effect.runPromise(SubscriptionRef.set(presence, next))
  }
  const settings = createJunoSettings({ turns: h.turns, picker, connection, agentDir: h.dir })
  cleanups.push(async () => settings.close())
  await settings.ready
  const transport = rendererPorts()
  const scope = Effect.runSync(Scope.make())
  cleanups.push(() => Effect.runPromise(Scope.close(scope, Exit.void)))
  await Effect.runPromise(
    Layer.buildWithScope(
      rendererServer(transport, { turns: h.turns, presence: () => current, presenceChanges: SubscriptionRef.changes(presence), settings, ...(options.watchHost ? { schedule: { scheduler: h.turns.scheduler, host: options.watchHost } } : {}) }),
      scope,
    ),
  )
  const client = (await Effect.runPromise(
    Effect.gen(function* () {
      const context = yield* Layer.buildWithScope(
        hostProtocol({
          acquire: async () => {
            const { port1, port2 } = new MessageChannel()
            transport.add(nodePort(port2))
            return nodePort(port1)
          },
        }),
        scope,
      )
      return yield* RpcClient.make(AgentRpcs).pipe(Effect.provide(context), Scope.provide(scope))
    }),
  )) as unknown as Client

  /**
   * Follows `stream` for the whole test. `where(test)` resolves with the first value, already seen or
   * still to come, that passes `test`.
   */
  const follow = <A>(stream: Stream.Stream<A, unknown>) => {
    let latest: A | undefined
    const waiters = new Set<() => void>()
    Effect.runFork(
      stream.pipe(
        Stream.runForEach((value) =>
          Effect.sync(() => {
            latest = value
            for (const wake of waiters) wake()
          }),
        ),
        Effect.ignore,
        Scope.provide(scope),
      ),
    )
    return {
      where: (test: (value: A) => boolean, what: string) =>
        new Promise<A>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`nothing with ${what}; last: ${JSON.stringify(latest)}`)), 15_000)
          const check = () => {
            if (latest === undefined || !test(latest)) return
            clearTimeout(timer)
            waiters.delete(check)
            resolve(latest)
          }
          waiters.add(check)
          check()
        }),
    }
  }

  const chatPage = follow(Stream.map(client['agent.chat.page']({ window: { _tag: 'latest', limit: 50 } }), (snapshot) => snapshot.page))
  /** The first chat page that passes `test`. */
  const pageWhere = (test: (page: ChatPage) => boolean, what: string) => chatPage.where(test, what)

  return { h, client, follow, pageWhere, setPresence, connection, picker, catalogueReads: () => catalogueReads }
}
