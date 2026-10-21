/**
 * The dock: the unread badge and the incoming huddle's bounce. Keep the
 * current badge. Automatic permission is tied to the first post-setup content view.
 */
import type { PermissionBridge } from './notificationPermission'

export interface AutomaticNotificationPermission {
  readonly enabled: boolean
  readonly asked: () => boolean
  /** Persist before requesting, so a dismissal or interrupted request is not repeated next launch. */
  readonly remember: () => Promise<void>
}

export function createDockBadge(permission: PermissionBridge, show: (text: string) => void, automatic: AutomaticNotificationPermission) {
  let text = ''
  let asking: Promise<void> | undefined
  const refresh = () => { show(text) }
  const request = async () => {
    if (!automatic.asked()) await automatic.remember()
    const status = await permission.request()
    refresh()
    return status
  }
  return {
    set: (next: string) => { text = next; refresh() },
    refresh,
    request,
    contentShown: (): Promise<void> => {
      if (!automatic.enabled || automatic.asked()) return Promise.resolve()
      return asking ??= (async () => {
        await automatic.remember()
        const status = await permission.read()
        if (status.authorization === 'notDetermined') await request()
        refresh()
      })().finally(() => { asking = undefined })
    },
  }
}

/**
 * One informational bounce for an incoming huddle (SPEC 20, "Incoming
 * huddles"), unless one of Juno's windows has focus. It never touches the
 * badge. Under JUNO_E2E bounces are counted, and a test says whether Juno is
 * frontmost; Playwright keeps the window focused, so it starts frontmost.
 */
export function createDockBounce(e2e: boolean, focused: () => boolean, bounce: () => void) {
  let bounces = 0
  let frontmost = true
  return {
    bounce: () => {
      if (e2e ? frontmost : focused()) return
      if (e2e) bounces += 1
      else bounce()
    },
    testHooks: { dockBounces: () => bounces, frontmost: (value: boolean) => void (frontmost = value) },
  }
}
