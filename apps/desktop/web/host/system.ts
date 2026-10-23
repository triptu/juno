import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Schema } from 'effect'
import { Channels, ShellRoutes, type MainToEngine } from '@juno/contract'
import type { memoryHost } from '@juno/engine'
import type { WebSocket } from 'ws'
import { createActivityWatch } from '../../src/main/activity'
import { createDockBadge, createDockBounce } from '../../src/main/dockBadge'
import { createHuddlePageRegistry } from '../../src/main/huddlePageRegistry'
import { Notifier, type NotificationOptions } from '../../src/main/notifier'
import { testNotificationPermission } from '../../src/main/notificationTestHooks'
import { syncLogText } from '../../src/main/syncLog'
import { createLog } from '../../src/logging'
import type { ShellEvent, SystemHooks } from '../shell'

/** Main's services with memory OS boundaries. The engine still makes every notification decision. */
export function createShell(userData: string) {
  let host: ReturnType<typeof memoryHost> | undefined
  const send = (message: MainToEngine) => host?.deliver(message)
  const clients = new Set<WebSocket>()
  const publish = (event: ShellEvent) => { for (const socket of clients) socket.send(JSON.stringify(event)) }
  const file = join(userData, 'web-system.json')
  const saved = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as { asked?: boolean; privacy?: boolean } : {}
  const persist = () => writeFileSync(file, JSON.stringify(saved))
  const log = createLog('main', join(userData, 'logs'))
  const permission = testNotificationPermission({})
  let badge = ''
  let idle = 0
  let settingsOpened = 0
  const notifications: Array<NotificationOptions & { click: () => void }> = []
  const dock = createDockBadge(permission, (text) => { badge = text }, {
    enabled: true, asked: () => saved.asked === true,
    remember: () => { saved.asked = true; persist(); return Promise.resolve() },
  })
  const bounce = createDockBounce(true, () => true, () => {})
  const notifier = new Notifier({
    create: (options) => {
      const recorded = { ...options, click: () => {} }
      notifications.push(recorded)
      return { show: () => {}, close: () => {}, onClick: (listener) => { recorded.click = listener } }
    },
    setBadge: dock.set, bounce: bounce.bounce,
    open: (target) => publish({ event: 'notification', value: target }),
    focus: () => {}, send, privacy: () => saved.privacy === true,
  })
  const activity = createActivityWatch({ idleSeconds: () => idle, locked: () => false, send })
  const pages = createHuddlePageRegistry(send)
  let nextPage = 0
  const hooks: SystemHooks = {
    notifications: () => notifications.map(({ title, body, silent }) => ({ title, body, ...(silent === true ? { silent: true as const } : {}) })),
    clickNotification: (index) => notifications[index]?.click(),
    notificationPermission: permission.set,
    notificationRequests: permission.requests,
    notificationSettingsOpened: () => settingsOpened,
    systemIdle: (seconds) => { idle = seconds; activity.poll() },
    dockBadge: () => badge,
    clearDockBadge: () => { badge = '' },
    dockBounces: bounce.testHooks.dockBounces,
    frontmost: bounce.testHooks.frontmost,
    wake: () => { dock.refresh(); notifier.wake() },
  }
  const dispatch = shellDispatch({ userData, log, notifier, dock, permission, pages, saved, persist, openSettings: () => { settingsOpened += 1 } })

  return {
    hooks,
    connect: (next: ReturnType<typeof memoryHost>) => {
      host = next
      next.onEngine((message) => {
        if (message._tag === 'ready') { notifier.engineReady(); activity.poll(); pages.report() }
        else notifier.handle(message)
      })
      activity.start()
    },
    attach: (socket: WebSocket) => {
      const page = ++nextPage
      clients.add(socket)
      socket.on('message', (data) => {
        const request = JSON.parse(data.toString()) as { id: number; channel: string; input?: unknown }
        void dispatch(request.channel, request.input, page).then(
          (value) => socket.send(JSON.stringify({ id: request.id, value })),
          (error: unknown) => socket.send(JSON.stringify({ id: request.id, error: error instanceof Error ? error.message : String(error) })),
        )
      })
      socket.on('close', () => { clients.delete(socket); pages.forget(page) })
    },
    close: async () => { activity.stop(); await log.close() },
  }
}

function shellDispatch({ userData, log, notifier, dock, permission, pages, saved, persist, openSettings }: {
  userData: string
  log: ReturnType<typeof createLog>
  notifier: Notifier
  dock: ReturnType<typeof createDockBadge>
  permission: ReturnType<typeof testNotificationPermission>
  pages: ReturnType<typeof createHuddlePageRegistry>
  saved: { privacy?: boolean }
  persist: () => void
  openSettings: () => void
}) {
  return async (channel: string, input: unknown, page: number): Promise<unknown> => {
    switch (channel) {
      case 'web.syncLog': return syncLogText('web', Schema.decodeUnknownSync(ShellRoutes[Channels.appCopySyncLog].input)(input), new Date(), join(userData, 'logs'))
      case Channels.appReportStagingFailure:
        log.log('WARN', 'files: staging failed', Schema.decodeUnknownSync(ShellRoutes[channel].input)(input))
        return
      case Channels.huddleRegister: return { generation: pages.register(page), fakeMedia: true }
      case Channels.notificationsViewing:
        notifier.setViewing(Schema.decodeUnknownSync(ShellRoutes[channel].input)(input).topicId)
        return
      case Channels.notificationsContentShown: return dock.contentShown()
      case Channels.notificationsTest: return notifier.test()
      case Channels.notificationsPermission: return permission.read()
      case Channels.notificationsRequestPermission: return dock.request()
      case Channels.notificationsOpenSettings: openSettings(); return
      case Channels.launchSetPrivacy:
        saved.privacy = Schema.decodeUnknownSync(ShellRoutes[channel].input)(input).privacy
        persist()
        return
      default: throw new Error(`Shell route unavailable: ${channel}`)
    }
  }
}
