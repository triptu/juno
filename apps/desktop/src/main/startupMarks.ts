import { app, contentTracing } from 'electron'

/**
 * When main reached each step of its start, in epoch milliseconds like
 * `app.getAppMetrics()[n].creationTime`, so the warm start scenario
 * (`perf.spec.ts`) can split the time before the page starts into
 * Electron's part and main's. `loaded` is set as this module runs, once
 * main's chunks and most of its modules have loaded. Under JUNO_E2E tests
 * read the marks from `globalThis.junoStartupMarks`.
 */
const startupMarks: Record<string, number> = { loaded: now() }

/** Records the first time `name` is reached. */
export function startupMark(name: string): void {
  startupMarks[name] ??= now()
}

function now(): number {
  return performance.timeOrigin + performance.now()
}

// Registered before index.ts's own ready handler, so `ready` is marked first.
void app.whenReady().then(() => {
  startupMark('ready')
  if (process.env.JUNO_E2E === '1') traceStartup(process.env.JUNO_E2E_STARTUP_TRACE)
})
if (process.env.JUNO_E2E === '1') Object.assign(globalThis, { junoStartupMarks: startupMarks })

/**
 * Under JUNO_E2E_STARTUP_TRACE=<file>, a Chromium trace of the start, the
 * renderer and the engine included, written 1.2 s after ready. Tracing
 * starts a few tens of ms late and slows the start, so read where the time
 * goes from it, not how long it takes (performance.md 8.8).
 */
function traceStartup(file: string | undefined): void {
  if (file === undefined) return
  const categories = ['toplevel', 'blink', 'blink.user_timing', 'loading', 'navigation', 'devtools.timeline', 'disabled-by-default-devtools.timeline', 'v8', 'v8.execute', 'disabled-by-default-v8.compile', 'disabled-by-default-v8.cpu_profiler']
  void contentTracing
    .startRecording({ included_categories: categories })
    .then(() => new Promise((resolve) => setTimeout(resolve, 1_200)))
    .then(() => contentTracing.stopRecording(file))
}
