/** Keep the current badge. Automatic permission is tied to the first post-setup content view. */
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
