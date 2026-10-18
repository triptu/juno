/**
 * Main's side of the process diagnostics (processes.ts) in the app:
 * Electron's metrics, the engine and agent pids, the window's state, and
 * what the renderer reports. Input to the window and a sync running reset
 * the idle time the self-check waits for.
 */
import { app, type BrowserWindow } from 'electron'
import type { AppState, Diagnostics } from '@juno/contract'
import type { AgentSupervisor } from './agent'
import type { EngineSupervisor } from './engine'
import { mainLog } from './logging'
import { createProcessMonitor, readings, SAMPLE_MS, type Sample } from './processes'

export interface ProcessWatchDeps {
  readonly supervisor: EngineSupervisor
  readonly agent: AgentSupervisor
  readonly window: () => BrowserWindow | undefined
}

export function createProcessWatch({ supervisor, agent, window }: ProcessWatchDeps) {
  let rendererState: AppState = { view: 'starting', syncing: true }
  let lastInput = Date.now()
  const pids = () => ({ engine: supervisor.pid, agent: agent.pid })
  const windowState = (): string => {
    const shown = window()
    if (shown === undefined) return 'no window'
    return shown.isMinimized() ? 'window minimized' : !shown.isVisible() ? 'window hidden' : shown.isFocused() ? 'window focused' : 'window in the background'
  }
  const monitor = createProcessMonitor({
    metrics: () => app.getAppMetrics(),
    now: () => Date.now(),
    pids,
    idle: () => !rendererState.syncing && Date.now() - lastInput >= SAMPLE_MS,
    context: () => `${windowState()}, view ${rendererState.view}, engine ${supervisor.currentState}, agent ${agent.currentState}`,
    log: (line) => {
      const match = /^main: (Main|Window|Engine|Juno agent|Graphics|Network|Other) \([^,]+, pid (\d+)\) used (\d+)/.exec(line)
      mainLog.log('WARN', 'busy while idle', { process: match?.[1], pid: Number(match?.[2]), cpu: Number(match?.[3]), view: ['starting', 'topic', 'Home', 'All topics', 'Settings', 'Juno', 'no tab'].find((view) => rendererState.view.startsWith(view)) })
    },
  })
  return {
    /** Starts the monitor with the first window; input to `shown` counts as use, which the self-check waits 2 minutes without. Its timer does not hold the app open. */
    watch(shown: BrowserWindow): void {
      monitor.start()
      shown.webContents.on('input-event', () => {
        lastInput = Date.now()
      })
    },
    diagnostics(): Diagnostics {
      const busy = monitor.lastBusy()
      return {
        processes: monitor.read(),
        engine: supervisor.currentState,
        agent: agent.currentState,
        uptime: Math.round(process.uptime()),
        window: windowState(),
        ...(busy === undefined ? {} : { busyWhileIdle: busy }),
      }
    },
    reportState(state: AppState): void {
      rendererState = state
    },
    /** Under JUNO_E2E: a sample now, and each process's share of one core since one (idle-cpu.spec.ts). */
    testHooks: {
      processSample: () => monitor.sample(),
      processesSince: (before: Sample) => readings(before, monitor.sample(), pids()),
    },
  }
}
