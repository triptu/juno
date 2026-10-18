/**
 * Starts the engine on a transport. Electron calls this from the utility
 * process entry; tests call it from Node with a `memoryTransport`.
 *
 * Startup order follows performance 2.1: the services and the RPC server come
 * up first, so the first live query is answered from local state before any
 * network work starts. The session then asks main for the stored secrets and
 * verifies them in the background (`session/Session.ts`).
 *
 * The host supplies two seams the engine cannot own: a `Host` (parentPort in
 * Electron, `memoryHost()` in tests) and the `HttpTransport` for Slack
 * (`net.fetch` on the `persist:slack` session in Electron, Node `fetch` in
 * tests). Both default to the Node flavour so a bare `startEngine` still
 * serves.
 */
import { WorkControl, type WorkControlOptions } from './workControl'
import { Clock, Context, Effect, Exit, Layer, Logger, Scope } from 'effect'
import type { HandlerOptions } from '@juno/agent-juno'
import type { EngineConfig as Config } from '@juno/contract'
import { HttpTransport } from '@juno/slack'
import { EngineConfig, EngineTiming, productionTiming, type EngineTimingConfig, SyncControl, type SyncControlOptions } from './config'
import { agentHostServer } from './protocol/agentHost'
import { HostLink, silentHost, type Host } from './protocol/host'
import { hostNotificationHost, NotificationControl, NotificationHost } from './notificationRuntime'
import type { Presence } from '@juno/domain'
import { Outbox } from './outbox'
import { SocketEvents } from './socketEvents'
import { AgentHost, Handlers, Services } from './layer'
import { protocolServer } from './protocol/server'
import type { Transport } from './protocol/transport'

export interface EngineHandle {
  readonly wake: () => Promise<void>
  readonly setPresence: (presence: Presence) => Promise<void>
  readonly currentPresence: () => Promise<Presence | undefined>
  readonly config: Config
  /** Closes every port and releases every service. */
  readonly stop: () => Promise<void>
  /** Waits for scheduled background command recoveries, including their local writes. */
  readonly commandIdle: () => Promise<void>
}

export interface EngineHostOptions {
  /** Scheduling overrides; omitted values keep production defaults. */
  readonly timing?: Partial<EngineTimingConfig>
  readonly work?: WorkControlOptions
  /** A controlled clock for tests of production scheduling. */
  readonly clock?: Clock.Clock
  readonly logger?: Logger.Logger<unknown, void>

  readonly notifications?: NotificationHost
  /** Optional cycle observer and sync schedule overrides, used by the test harness. */
  readonly sync?: SyncControlOptions
  readonly host?: Host
  /** The HTTP seam for Slack (ADR 0007). */
  readonly httpTransport?: Layer.Layer<HttpTransport>
  /** Ports from the agent utility process. When set, the engine serves the AgentHost group on them (ADR 0012). */
  readonly agentTransport?: Transport
  /** Whether the agent's sends reach Slack. Default `disabled`; the desktop enables the guarded single-attempt path. */
  readonly agentWrites?: HandlerOptions['writes']
}

export function startEngine(transport: Transport, config: Config, options: EngineHostOptions = {}): Promise<EngineHandle> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const servers =
        options.agentTransport === undefined
          ? protocolServer(transport)
          : Layer.merge(protocolServer(transport), agentHostServer(options.agentTransport, { writes: options.agentWrites ?? 'disabled' }).pipe(Layer.provide(AgentHost)))
      const hostLink = HostLink.layer(options.host ?? silentHost())
      // Without a notifier of its own (tests pass one), notifications go to main over the host link.
      const notificationHost = options.notifications === undefined ? hostNotificationHost.pipe(Layer.provide(hostLink)) : Layer.succeed(NotificationHost, options.notifications)
      const app = servers.pipe(
        Layer.provide(Handlers),
        Layer.provideMerge(Services),
        Layer.provide(
          Layer.mergeAll(
            EngineConfig.layer(config),
            Layer.succeed(WorkControl, options.work ?? {}),
            Layer.succeed(EngineTiming, { ...productionTiming, ...(config.fakeSlackUrl === undefined ? {} : { socketBackoffCapMillis: 2_000, socketTickleMillis: 2_000 }), ...options.timing }),
            notificationHost,
            Layer.succeed(SyncControl, options.sync ?? {}),
            hostLink,
            options.httpTransport ?? HttpTransport.nodeFetch(),
          ),
        ),
      )
      // A failed build must not leak what was already acquired.
      const context = yield* Layer.buildWithScope(app, scope).pipe(Effect.provideService(Clock.Clock, options.clock ?? (yield* Clock.Clock)), Effect.onError(() => Scope.close(scope, Exit.void)))
      const onEvent = options.sync?.onEvent
      if (onEvent !== undefined) {
        // Register before returning so the harness can observe every subsequent barrier frame.
        yield* Context.get(context, SocketEvents).subscribe('test-barrier', Effect.succeed((input) =>
          input._tag === 'Overflowed' ? Effect.void : Effect.sync(() => onEvent(input)),
        )).pipe(Effect.provideService(Scope.Scope, scope))
      }
      const notifications = Context.get(context, NotificationControl)
      const outbox = Context.get(context, Outbox)
      return {
        config,
        wake: () => Effect.runPromise(notifications.wake),
        setPresence: (value: Presence) => Effect.runPromise(notifications.setPresence(value)),
        currentPresence: () => Effect.runPromise(notifications.currentPresence),
        stop: () => Effect.runPromise(Scope.close(scope, Exit.void)),
        commandIdle: () => Effect.runPromise(outbox.idle),
      }
    }).pipe(Effect.provide(Logger.layer(options.logger === undefined ? [Logger.defaultLogger] : [options.logger]))),
  )
}
