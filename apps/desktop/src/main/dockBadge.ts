/** Keep the current badge and apply it again after macOS authorization, focus or wake. */
import type { NotificationPermission } from '@juno/contract'
import type { PermissionBridge } from './notificationPermission'

export function createDockBadge(permission: PermissionBridge, show: (text: string) => void) {
  let text = ''
  let refreshing: Promise<void> | undefined
  let requested = false
  const refresh = (): Promise<void> => text === '' ? Promise.resolve() : refreshing ??= (async () => {
    const status = await permission.read()
    // Ask on the first unread badge, even if no banner notification has ever been shown.
    if (text !== '' && status === 'notDetermined' && !requested) {
      requested = true
      await permission.request()
    }
    // Unread state may have changed while the owner answered the prompt.
    show(text)
  })().finally(() => { refreshing = undefined })
  return {
    set: (next: string) => {
      text = next
      show(text)
      if (text !== '') void refresh()
    },
    refresh,
  }
}

/** macOS stand-in for fake-server flows. Never used outside JUNO_E2E. */
export function testNotificationPermission() {
  let status: NotificationPermission = 'allowed'
  let requests = 0
  return {
    preload: () => {},
    read: () => Promise.resolve(status),
    request: () => {
      requests += 1
      if (status === 'notDetermined') status = 'allowed'
      return Promise.resolve(status)
    },
    set: (next: NotificationPermission) => { status = next },
    requests: () => requests,
  }
}
