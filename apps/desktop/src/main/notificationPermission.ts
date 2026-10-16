/**
 * Whether macOS lets Juno post notifications (SPEC section 14, Settings ›
 * Notifications). Electron does not say, so main asks
 * `UNUserNotificationCenter` itself through koffi and the Objective-C
 * runtime, as screenWatch.ts does for SkyLight.
 *
 * Both calls take a completion block. Each is one global block literal in
 * memory that is never freed, whose invoke function is a koffi callback.
 * The system calls it on a background queue; koffi holds that thread until
 * the callback has run on the main thread, so the settings object it reads
 * is still alive.
 *
 * macOS keeps the permission per bundle id: `app.juno.desktop` when
 * packaged, Electron's own id in development. An unsigned build can be
 * refused outright, and a reading that does not come back in time is
 * `unknown`; Settings then offers Open Notification Settings anyway.
 */
import type { NotificationPermission } from '@juno/contract'

export interface PermissionBridge {
  /** `getNotificationSettingsWithCompletionHandler:`, as allowed, denied or not determined. */
  readonly read: () => Promise<NotificationPermission>
  /** `requestAuthorizationWithOptions:completionHandler:` (alert, sound, badge), then reads again. */
  readonly request: () => Promise<NotificationPermission>
}

/** System Settings at Juno's own entry, and the Notifications pane when that fails. */
export const settingsUrls = (bundleId: string) => [
  `x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=${bundleId}`,
  'x-apple.systempreferences:com.apple.Notifications-Settings.extension',
] as const

/** How long a completion block may take before the answer is `unknown`. A permission prompt waits on the user, so it gets longer. */
const READ_MS = 3_000
const REQUEST_MS = 120_000

/** `UNAuthorizationStatus`: 0 not determined, 1 denied, 2 authorized, 3 provisional, 4 ephemeral. */
function fromStatus(status: number): NotificationPermission {
  if (status === 0) return 'notDetermined'
  if (status === 1) return 'denied'
  if (status >= 2 && status <= 4) return 'allowed'
  return 'unknown'
}

/** `UNAuthorizationOptionBadge | Sound | Alert`. */
const ALERT_SOUND_BADGE = 0b111
/** `BLOCK_IS_GLOBAL`: the runtime never copies or frees the literal. */
const BLOCK_IS_GLOBAL = 1 << 28
const POINTER = 8
/** isa, flags and reserved, invoke, descriptor. */
const BLOCK_SIZE = POINTER * 4
const DESCRIPTOR_SIZE = POINTER * 2

type Koffi = typeof import('koffi')

/**
 * A global block literal whose invoke is `callback`, in memory that is never freed. Global, so
 * the runtime never copies or releases it, and one literal serves every call.
 */
function globalBlock(koffi: Koffi, malloc: (size: number) => bigint, isa: bigint, callback: Function, signature: string): bigint {
  const invoke = koffi.register(callback, koffi.pointer(koffi.proto(signature)))
  const descriptor = malloc(DESCRIPTOR_SIZE)
  koffi.encode(descriptor, 0, 'uint64_t', 0)
  koffi.encode(descriptor, POINTER, 'uint64_t', BLOCK_SIZE)
  const literal = malloc(BLOCK_SIZE)
  koffi.encode(literal, 0, 'uint64_t', isa)
  koffi.encode(literal, POINTER, 'int32_t', BLOCK_IS_GLOBAL)
  koffi.encode(literal, POINTER + 4, 'int32_t', 0)
  koffi.encode(literal, POINTER * 2, 'uint64_t', invoke)
  koffi.encode(literal, POINTER * 3, 'uint64_t', descriptor)
  return literal
}

/**
 * Callers waiting on a completion block: each call sends its own message, a completion answers
 * everyone waiting, and one that never comes answers `fallback` after `ms`.
 */
function waiters<A>(ms: number, fallback: A) {
  let waiting: Array<(value: A) => void> = []
  return {
    wait: (send: () => void) =>
      new Promise<A>((resolve) => {
        const timer = setTimeout(() => resolve(fallback), ms)
        waiting.push((value) => {
          clearTimeout(timer)
          resolve(value)
        })
        send()
      }),
    answer: (value: A) => {
      const answered = waiting
      waiting = []
      for (const resolve of answered) resolve(value)
    },
  }
}

/** Loads the bridge, or undefined off macOS or when any piece is missing. */
export async function loadPermissionBridge(): Promise<PermissionBridge | undefined> {
  if (process.platform !== 'darwin') return undefined
  try {
    const koffi = await import('koffi')
    const objc = koffi.load('/usr/lib/libobjc.A.dylib')
    const system = koffi.load('/usr/lib/libSystem.B.dylib')
    koffi.load('/System/Library/Frameworks/UserNotifications.framework/UserNotifications')
    const selector = objc.func('void *sel_registerName(const char *name)')
    const sendId = objc.func('void *objc_msgSend(void *self, void *op)')
    const sendLong = objc.func('int64_t objc_msgSend(void *self, void *op)')
    const sendBlock = objc.func('void objc_msgSend(void *self, void *op, void *block)')
    const sendOptionsBlock = objc.func('void objc_msgSend(void *self, void *op, uint64_t options, void *block)')
    const malloc = system.func('void *malloc(size_t size)')
    const isa: bigint = system.symbol('_NSConcreteGlobalBlock')

    const centerClass: bigint = objc.func('void *objc_getClass(const char *name)')('UNUserNotificationCenter')
    const center: bigint | null = centerClass ? sendId(centerClass, selector('currentNotificationCenter')) : null
    if (!center) return undefined
    const authorizationStatus = selector('authorizationStatus')
    const getSettings = selector('getNotificationSettingsWithCompletionHandler:')
    const requestAuthorization = selector('requestAuthorizationWithOptions:completionHandler:')

    const reads = waiters<NotificationPermission>(READ_MS, 'unknown')
    const requests = waiters<void>(REQUEST_MS, undefined)
    const settingsBlock = globalBlock(koffi, malloc, isa, (_block: bigint, settings: bigint) => {
      reads.answer(settings ? fromStatus(Number(sendLong(settings, authorizationStatus))) : 'unknown')
    }, 'void SettingsBlock(void *block, void *settings)')
    const requestBlock = globalBlock(koffi, malloc, isa, () => requests.answer(), 'void RequestBlock(void *block, bool granted, void *error)')

    const read = () => reads.wait(() => sendBlock(center, getSettings, settingsBlock))
    return {
      read,
      request: async () => {
        await requests.wait(() => sendOptionsBlock(center, requestAuthorization, ALERT_SOUND_BADGE, requestBlock))
        return read()
      },
    }
  } catch (cause) {
    console.warn('main: notification permission unknown, the bridge did not load', cause)
    return undefined
  }
}

/** The bridge loaded once, on first use; `unknown` for good when it could not load. */
export function createNotificationPermission(load: () => Promise<PermissionBridge | undefined>): PermissionBridge & { readonly preload: () => void } {
  let loaded: Promise<PermissionBridge | undefined> | undefined
  const bridge = () => (loaded ??= load())
  return {
    preload: () => void bridge(),
    read: async () => (await bridge())?.read() ?? 'unknown',
    request: async () => (await bridge())?.request() ?? 'unknown',
  }
}
