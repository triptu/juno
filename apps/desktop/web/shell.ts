import type { NotificationPermission, NotificationTarget } from '@juno/contract'

export const SHELL_SOCKET_PATH = '/__juno/shell'
export type ShellEvent = { readonly event: 'notification'; readonly value: NotificationTarget }
export interface SystemHooks {
  notifications: () => Array<{ readonly title: string; readonly body: string; readonly silent?: true }>
  clickNotification: (index: number) => void
  notificationPermission: (permission: NotificationPermission) => void
  notificationRequests: () => number
  notificationSettingsOpened: () => number
  systemIdle: (seconds: number) => void
  dockBadge: () => string
  clearDockBadge: () => void
  dockBounces: () => number
  frontmost: (value: boolean) => void
  wake: () => void
}
export type SystemCall = { [K in keyof SystemHooks]: { readonly name: K; readonly args: Parameters<SystemHooks[K]> } }[keyof SystemHooks]
