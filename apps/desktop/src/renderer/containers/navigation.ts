/**
 * Opening, switching and closing topic tabs (spec section 6), for every
 * place that opens a topic: sidebar rows, thread links, Main's Threads
 * list, the tab strip, the app menu and the context menus. The rules are
 * `@juno/state`'s; this module adds the timing.
 *
 * A topic that is not open yet becomes the tab only once its header and
 * its first window have arrived (a local query, a few milliseconds when
 * cached or prefetched), so the old tab stays on screen until the new one
 * can paint at its open position, never an empty page in between
 * (performance 4.4). Slack is asked only after that, by the tab itself.
 */
import { MESSAGE_WINDOW_DEFAULT, MESSAGE_WINDOW_MAX, type MenuCommand, type TopicDetail } from '@juno/contract'
import {
  activateTab,
  bottomWindow,
  closeTab,
  cycleTab,
  messageListAtom,
  messageWindowSpecAtom,
  mountedTabs,
  openTab,
  popupContextMenu,
  prefetchTopic,
  registry,
  scrollSnapshotAtom,
  selectedTopicAtom,
  tabsAtom,
  topicAtom,
  updateTabs,
  type MessageWindowSpec,
  type OpenOptions,
  type Tabs,
} from '@juno/state'
import { afterPaint, measure } from '@juno/state/perf'

/** Longest an open waits for the first message window before it shows the tab anyway, with the list loading. It always waits for the header. */
const READY_WAIT_MS = 150
/** Messages above the first unread one when a topic opens at its divider. */
const CONTEXT_ABOVE = 50

/** The open or the switch to an unmounted tab that started last, for the measure the tab ends on its first positioned paint. */
let pending: { readonly id: string; readonly at: number; readonly name: 'juno.topic-open' | 'juno.tab-switch' } | undefined

/** The pending measure for `id`, taken once. */
export function takeOpenStart(id: string): { readonly at: number; readonly name: 'juno.topic-open' | 'juno.tab-switch' } | undefined {
  if (pending?.id !== id) return undefined
  const taken = pending
  pending = undefined
  return taken
}

/** The window a topic opens with: the bottom, tall enough to hold every unread message and some above. */
export function openWindow(detail: TopicDetail): MessageWindowSpec {
  const wanted = detail.unreadCount + CONTEXT_ABOVE
  return wanted <= MESSAGE_WINDOW_DEFAULT ? bottomWindow : { limit: Math.min(MESSAGE_WINDOW_MAX, wanted) }
}

/** What the shown tab does just before another tab replaces it: record its scroll position. */
const leaving = new Map<string, () => void>()

/** Registers what the tab `id` does as it is left, while it is shown. Returns the unregister. */
export function onLeaveTab(id: string, leave: () => void): () => void {
  leaving.set(id, leave)
  return () => {
    if (leaving.get(id) === leave) leaving.delete(id)
  }
}

function apply(change: (tabs: Tabs) => Tabs): Tabs {
  const active = registry.get(tabsAtom).active
  if (active !== undefined) leaving.get(active)?.()
  const next = updateTabs(registry, change)
  registry.set(selectedTopicAtom, next.active)
  return next
}

/**
 * Resolves once the topic's header and first window are local, or, after
 * `READY_WAIT_MS`, once the header is. Showing the tab without its header
 * would paint an empty pane and an empty tab title. A fresh open also
 * picks the window (`openWindow`); a tab coming back keeps the one it had.
 */
function whenReady(id: string, fresh: boolean): Promise<void> {
  return new Promise((resolve) => {
    const releases: Array<() => void> = []
    let done = false
    let specSet = false
    let waited = false
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve()
      // The tab reads the same atoms; let it mount before letting go of these.
      afterPaint(() => releases.forEach((release) => release()))
    }
    const timer = setTimeout(() => {
      waited = true
      check()
    }, READY_WAIT_MS)
    const check = () => {
      if (done) return
      const result = registry.get(topicAtom(id))
      if (result._tag === 'Failure') return finish()
      if (result._tag !== 'Success') return
      const detail = result.value
      if (detail === null) return finish()
      if (!specSet) {
        specSet = true
        if (fresh) registry.set(messageWindowSpecAtom(id), openWindow(detail))
        releases.push(registry.subscribe(messageListAtom(id), check, { immediate: false }))
      }
      if (waited || registry.get(messageListAtom(id)).ready) finish()
    }
    releases.push(registry.subscribe(topicAtom(id), check, { immediate: false }))
    check()
  })
}

/** Opens apply in the order they were asked for. */
let queue: Promise<void> = Promise.resolve()
/** Bumped by each open in the current tab and each tab switch: an open in the current tab applies only if nothing replaced it since. */
let currentTicket = 0

/** Opens a topic: in the current tab, a new tab with `newTab`, or its own tab when it is already open. */
export function openTopic(id: string, options: OpenOptions = {}): void {
  const at = performance.now()
  registry.set(selectedTopicAtom, id)
  if (registry.get(tabsAtom).tabs.some((tab) => tab.id === id)) {
    switchToTab(id)
    return
  }
  pending = { id, at, name: 'juno.topic-open' }
  const replaces = options.newTab !== true
  const ticket = replaces ? ++currentTicket : currentTicket
  // A fresh open starts at the divider or the bottom, not where an earlier tab of it was.
  registry.set(scrollSnapshotAtom(id), undefined)
  const ready = whenReady(id, true)
  queue = queue
    .then(() => ready)
    .then(() => {
      if (!replaces || ticket === currentTicket) apply((tabs) => openTab(tabs, id, options))
    })
}

/**
 * Focuses an open tab. A mounted tab shows in the next frame; one that was
 * unmounted waits, like an open, until its data is local, then comes back
 * at its scroll snapshot.
 */
export function switchToTab(id: string): void {
  const at = performance.now()
  const ticket = ++currentTicket
  const tabs = registry.get(tabsAtom)
  if (tabs.active === id) return
  registry.set(selectedTopicAtom, id)
  if (mountedTabs(tabs).has(id)) {
    apply((current) => activateTab(current, id))
    afterPaint(() => measure('juno.tab-switch', at, { detail: { id, mounted: true } }))
    return
  }
  pending = { id, at, name: 'juno.tab-switch' }
  const ready = whenReady(id, false)
  queue = queue
    .then(() => ready)
    .then(() => {
      if (ticket === currentTicket) apply((current) => activateTab(current, id))
    })
}

export function closeTopicTab(id: string): void {
  apply((tabs) => closeTab(tabs, id))
  registry.set(scrollSnapshotAtom(id), undefined)
}

/** ⌘W, ⌘⇧] and ⌘⇧[ from the app menu. */
export function runMenuCommand(command: MenuCommand): void {
  const tabs = registry.get(tabsAtom)
  if (command === 'tab.close') {
    if (tabs.active !== undefined) closeTopicTab(tabs.active)
    return
  }
  const next = cycleTab(tabs, command === 'tab.next' ? 1 : -1)
  if (next.active !== undefined && next.active !== tabs.active) switchToTab(next.active)
}

/** Pointer enter, focus or keyboard selection of something that opens a topic. */
export function warmTopic(id: string): void {
  prefetchTopic(registry, id)
}

/** The menu on a sidebar row or a thread entry (M5 adds the rest). */
export async function showTopicMenu(id: string): Promise<void> {
  const chosen = await popupContextMenu([
    { id: 'new-tab', label: 'Open in new tab' },
    { id: 'stealth', label: 'Open in stealth' },
  ])
  if (chosen === 'new-tab') openTopic(id, { newTab: true })
  else if (chosen === 'stealth') openTopic(id, { stealth: true })
}

/** The menu on a tab. */
export async function showTabMenu(id: string): Promise<void> {
  const chosen = await popupContextMenu([{ id: 'close', label: 'Close tab' }])
  if (chosen === 'close') closeTopicTab(id)
}
