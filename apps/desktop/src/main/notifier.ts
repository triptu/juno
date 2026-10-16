/**
 * OS notifications and the dock badge (architecture 2.2 and 11).
 *
 * The engine decides; main only shows. `notify` shows one notification,
 * once per id, and a click brings the window forward and hands the target
 * to the renderer, which opens the topic at the message. `badge` sets the
 * dock's `•` while any topic has an unread mention. `test` shows Settings ›
 * Notifications' test notification the same way; its click only brings
 * Juno forward.
 *
 * The renderer says which topic it shows and whether its window has focus;
 * main passes that to the engine, which suppresses a notification for the
 * topic on screen, and sends it again after an engine restart.
 *
 * No Electron import here: `index.ts` passes Electron's pieces in, tests
 * pass fakes.
 */
import type { EngineToMain, MainToEngine, NotificationTarget, OsNotification } from '@juno/contract'

export interface ShownNotification {
  readonly show: () => void
  readonly close: () => void
  readonly onClick: (listener: () => void) => void
}

export interface NotifierDeps {
  /** Electron's `new Notification({ title, body })`, or a fake. */
  readonly create: (options: { readonly title: string; readonly body: string }) => ShownNotification
  /** `app.dock.setBadge`. */
  readonly setBadge: (text: string) => void
  /** Brings the app window forward and hands it the target. */
  readonly open: (target: NotificationTarget) => void
  /** Brings the app window forward, or opens it. */
  readonly focus: () => void
  /** To the engine over parentPort. */
  readonly send: (message: MainToEngine) => void
  /** Privacy mode is on: the body, which quotes the message, is left out (SPEC section 5, Privacy mode). */
  readonly privacy: () => boolean
}

/** The body while privacy mode is on. The title still says where it came from. */
export const HIDDEN_BODY = 'Message hidden'

/** Notifications kept alive for their click handler. Electron drops the handler of one it no longer references. */
const KEPT = 20

export const DOCK_BADGE = '•'

/** Settings › Notifications' test notification. Not a message, so privacy mode leaves it as it is. */
export const TEST_NOTIFICATION = { title: 'Juno', body: 'Notifications from Juno look like this.' } as const

export class Notifier {
  private readonly shown = new Map<string, ShownNotification>()
  private viewing: string | null = null

  constructor(private readonly deps: NotifierDeps) {}

  /** Handles `notify` and `badge` from the engine. False for anything else. */
  handle(message: EngineToMain): boolean {
    switch (message._tag) {
      case 'notify':
        this.show(message.notification)
        return true
      case 'badge':
        this.deps.setBadge(message.mentions ? DOCK_BADGE : '')
        return true
      default:
        return false
    }
  }

  /** The topic the window shows, or null; the renderer sends null while its window is not focused. */
  setViewing(topicId: string | null): void {
    this.viewing = topicId
    this.deps.send({ _tag: 'viewing', topicId })
  }

  /** After an engine restart: what it needs to know again. */
  engineReady(): void {
    this.deps.send({ _tag: 'viewing', topicId: this.viewing })
  }

  /** The Mac woke: the engine applies the presence schedule again. */
  wake(): void {
    this.deps.send({ _tag: 'wake' })
  }

  /** Settings › Notifications' Send test notification: a new one each time, clicked to bring Juno forward. */
  test(): void {
    this.tests += 1
    this.post(`test:${this.tests}`, TEST_NOTIFICATION, () => this.deps.focus())
  }

  private tests = 0

  private show(notification: OsNotification): void {
    if (this.shown.has(notification.id)) return
    const body = this.deps.privacy() ? HIDDEN_BODY : notification.body
    this.post(notification.id, { title: notification.title, body }, () => this.deps.open(notification.target))
  }

  private post(id: string, options: { readonly title: string; readonly body: string }, onClick: () => void): void {
    const shown = this.deps.create(options)
    shown.onClick(() => {
      this.shown.delete(id)
      onClick()
    })
    this.shown.set(id, shown)
    for (const kept of [...this.shown.keys()].slice(0, Math.max(0, this.shown.size - KEPT))) this.shown.delete(kept)
    shown.show()
  }
}
