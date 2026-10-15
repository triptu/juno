/**
 * OS notifications and the dock badge (architecture 2.2 and 11).
 *
 * The engine decides; main only shows. `notify` shows one notification,
 * once per id, and a click brings the window forward and hands the target
 * to the renderer, which opens the topic at the message (or, for the
 * hours-start summary, the Juno chat once it exists). `badge` sets the
 * dock's `•` while any topic has an unread mention.
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
  /** To the engine over parentPort. */
  readonly send: (message: MainToEngine) => void
}

/** Notifications kept alive for their click handler. Electron drops the handler of one it no longer references. */
const KEPT = 20

export const DOCK_BADGE = '•'

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

  private show(notification: OsNotification): void {
    if (this.shown.has(notification.id)) return
    const shown = this.deps.create({ title: notification.title, body: notification.body })
    shown.onClick(() => {
      this.shown.delete(notification.id)
      this.deps.open(notification.target)
    })
    this.shown.set(notification.id, shown)
    for (const id of [...this.shown.keys()].slice(0, Math.max(0, this.shown.size - KEPT))) this.shown.delete(id)
    shown.show()
  }
}
