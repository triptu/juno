import type { ElectronApplication } from '@playwright/test'

/** What main exposes on `globalThis.junoTest` under JUNO_E2E. */
interface JunoTestHooks {
  readonly enginePid: () => number | undefined
  readonly aiCalls: () => Record<string, number>
  readonly engineState: () => string
  /** Makes the supervisor give up on the engine, as after too many crashes. */
  readonly failEngine: () => void
  /** `stopped` until a provider is set up: launch with `agent: true`, or set one through `window.juno.agent`. */
  readonly agentState: () => string
  /** The host name from the agent's `host.hello`, once it reached the engine. */
  readonly agentHost: () => string | undefined
  readonly agentPid: () => number | undefined
  /** The OS notifications main showed, recorded instead of shown. */
  readonly notifications: () => Array<{ readonly title: string; readonly body: string }>
  readonly clickNotification: (index?: number) => void
  readonly dockBadge: () => string
  /** How many times Open Notification Settings opened System Settings. */
  readonly notificationSettingsOpened: () => number
  /** How many times Mute opened System Settings at Microphone while macOS blocked it. */
  readonly microphoneSettingsOpened: () => number
  /** How many times the share sheet opened System Settings at Screen Recording. */
  readonly screenRecordingSettingsOpened: () => number
  /** As if the Mac woke from sleep. */
  readonly wake: () => void
}

/** Reads one of main's test hooks. */
export function hooks<K extends keyof JunoTestHooks>(app: ElectronApplication, name: K): Promise<ReturnType<JunoTestHooks[K]>> {
  return app.evaluate((_electron, hook) => {
    const testHooks = (globalThis as unknown as { junoTest: JunoTestHooks }).junoTest
    return testHooks[hook]() as ReturnType<JunoTestHooks[K]>
  }, name)
}
