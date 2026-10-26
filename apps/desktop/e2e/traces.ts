import type { Page, TestInfo } from '@playwright/test'
import type { FakeSlack } from '@juno/fake-slack'

/**
 * Counts the page's timer callbacks from its start (`__junoTimerFires`), for `juno.expectAtRest()`: an interval or a
 * timeout that schedules itself again runs its callback many times a second. The browser lane installs it on every page.
 */
export const countTimers = () => {
  const g = globalThis as unknown as { __junoTimerFires?: number; setTimeout: typeof setTimeout; setInterval: typeof setInterval }
  if (g.__junoTimerFires !== undefined) return
  g.__junoTimerFires = 0
  const counted = (callback: unknown) => (typeof callback === 'function' ? (...args: unknown[]) => { g.__junoTimerFires!++; return (callback as (...a: unknown[]) => unknown)(...args) } : callback)
  const timeout = g.setTimeout
  const interval = g.setInterval
  g.setTimeout = ((callback: unknown, ...rest: unknown[]) => timeout(counted(callback) as () => void, ...(rest as [number]))) as typeof setTimeout
  g.setInterval = ((callback: unknown, ...rest: unknown[]) => interval(counted(callback) as () => void, ...(rest as [number]))) as typeof setInterval
}

/** Puts an empty sidebar trace on the window, which turns the recording on (`@juno/state`'s `sidebarTrace.ts`). */
export const startSidebarTrace = () => {
  const g = globalThis as { __junoSidebarTrace?: unknown }
  g.__junoSidebarTrace ??= { hold: [], list: { values: 0, errors: 0 } }
}

/** A failing test's sidebar trace: attached, and printed on one line so a remote run's log has it. */
export async function attachSidebarTrace(win: Page, testInfo: TestInfo): Promise<void> {
  const trace = await win.evaluate(() => (globalThis as { __junoSidebarTrace?: unknown }).__junoSidebarTrace).catch(() => undefined)
  if (trace === undefined) return
  await testInfo.attach('sidebar-trace', { body: JSON.stringify(trace, null, 1), contentType: 'application/json' })
  console.log(`sidebar trace (${testInfo.titlePath.slice(1).join(' › ')}): ${JSON.stringify(trace)}`)
}

/** Puts an empty send trace on the window, which turns the recording on (`@juno/state`'s `sendTrace.ts`). */
export const startSendTrace = () => {
  const g = globalThis as { __junoSendTrace?: unknown }
  g.__junoSendTrace ??= { events: [] }
}

/** The fake's calls a send makes, with no text: when each came and how it was answered. */
const POST_METHODS = new Set(['chat.postMessage', 'conversations.open', 'chat.update', 'chat.delete'])

/** A failing test's send trace and the fake's post calls: attached, and printed on one line so a remote run's log has it. */
export async function attachSendTrace(win: Page, fake: FakeSlack, testInfo: TestInfo): Promise<void> {
  const trace = await win.evaluate(() => (globalThis as { __junoSendTrace?: unknown }).__junoSendTrace).catch(() => undefined)
  if (trace === undefined) return
  const posts = fake.calls.filter((call) => POST_METHODS.has(call.method)).map((call) => ({ at: call.at, method: call.method, channel: call.args.channel, ok: call.ok, ...(call.error === undefined ? {} : { error: call.error }) }))
  const body = { ...trace, posts }
  await testInfo.attach('send-trace', { body: JSON.stringify(body, null, 1), contentType: 'application/json' })
  console.log(`send trace (${testInfo.titlePath.slice(1).join(' › ')}): ${JSON.stringify(body)}`)
}
