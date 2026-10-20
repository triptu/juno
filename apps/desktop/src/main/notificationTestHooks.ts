/** Notification permission stand-in for JUNO_E2E. */
import type { NotificationPermission } from '@juno/contract'

export function testNotificationPermission() {
  let status: NotificationPermission = process.env.JUNO_E2E_NOTIFICATION_INITIAL === 'notDetermined'
    ? { authorization: 'notDetermined', badges: 'unknown' } : { authorization: 'allowed', badges: 'enabled' }
  let requests = 0
  return {
    preload: () => {},
    read: () => Promise.resolve(status),
    request: () => {
      requests += 1
      if (status.authorization === 'notDetermined') status = process.env.JUNO_E2E_NOTIFICATION_RESPONSE === 'denied'
        ? { authorization: 'denied', badges: 'disabled' }
        : { authorization: 'allowed', badges: 'enabled' }
      return Promise.resolve(status)
    },
    set: (next: NotificationPermission) => { status = next },
    requests: () => requests,
  }
}
