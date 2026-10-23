/** Notification permission stand-in for JUNO_E2E. */
import type { NotificationPermission } from '@juno/contract'

export function testNotificationPermission(options: { readonly initial?: string; readonly response?: string } = { initial: process.env.JUNO_E2E_NOTIFICATION_INITIAL, response: process.env.JUNO_E2E_NOTIFICATION_RESPONSE }) {
  let status: NotificationPermission = options.initial === 'notDetermined'
    ? { authorization: 'notDetermined', badges: 'unknown' } : { authorization: 'allowed', badges: 'enabled' }
  let requests = 0
  return {
    preload: () => {},
    read: () => Promise.resolve(status),
    request: () => {
      requests += 1
      if (status.authorization === 'notDetermined') status = options.response === 'denied'
        ? { authorization: 'denied', badges: 'disabled' }
        : { authorization: 'allowed', badges: 'enabled' }
      return Promise.resolve(status)
    },
    set: (next: NotificationPermission) => { status = next },
    requests: () => requests,
  }
}
