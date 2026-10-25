import type { NotificationPermission, NotificationTarget, ProviderState } from '@juno/contract'

export const AGENT_SOCKET_PATH = '/__juno/agent'
export const SHELL_SOCKET_PATH = '/__juno/shell'
export type ShellEvent = { readonly event: 'notification'; readonly value: NotificationTarget } | { readonly event: 'provider'; readonly value: ProviderState }
export interface SystemHooks {
  pickFolder: (folder: string | null) => void
  agentState: () => string
  notifications: () => Array<{ readonly title: string; readonly body: string; readonly silent?: true }>
  clickNotification: (index: number) => void
  notificationPermission: (permission: NotificationPermission) => void
  notificationRequests: () => number
  notificationSettingsOpened: () => number
  dockBadge: () => string
  clearDockBadge: () => void
  dockBounces: () => number
  frontmost: (value: boolean) => void
  wake: () => void
}
export type SystemCall = { [K in keyof SystemHooks]: { readonly name: K; readonly args: Parameters<SystemHooks[K]> } }[keyof SystemHooks]
