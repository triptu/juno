/**
 * Opening, switching and closing tabs, and moving through a tab's history
 * (spec section 6), for every place that opens a topic: sidebar rows, thread
 * links, Main's Threads list, the tab strip, the title bar, the app menu and
 * the context menus. The rules are `@juno/state`'s; this module adds the
 * timing.
 *
 * A topic that is not on screen yet becomes the tab's page only once its
 * header and its first window have arrived (a local query, a few
 * milliseconds when cached or prefetched), so the old page stays on screen
 * until the new one can paint at its open position, never an empty page in
 * between (performance 4.4). Slack is asked only after that, by the tab
 * itself.
 */
import {
  MESSAGE_WINDOW_BEFORE,
  MESSAGE_WINDOW_DEFAULT,
  MESSAGE_WINDOW_MAX,
  type MenuCommand,
  type PickConversation,
  type TopicDetail,
} from '@juno/contract'
import {
  activateTab,
  activeTab,
  allTopicsLayoutAtom,
  bottomWindow,
  messagesAtom,
  closeAllTabs,
  closeOtherTabs,
  closeTab,
  closeTabsToRight,
  copyText,
  currentPlace,
  cycleTab,
  goToEntry,
  allTopicsPlace,
  allTopicsTab,
  homePlace,
  homeViewAtom,
  flashMessage,
  junoPagePlace,
  locateMessage,
  junoPlace,
  messageListAtom,
  messageWindowSpecAtom,
  mountedTabs,
  newChatAtom,
  newChatPlace,
  notificationsPlace,
  preferencesPlace,
  emptyNewChat,
  openInSlack,
  openPlace,
  pickConversation,
  popupContextMenu,
  prefetchTopic,
  registry,
  reopenClosedTab,
  scrollSnapshotAtom,
  selectedTopicAtom,
  setPinned,
  settleNewChat,
  signedInAtom,
  slackLink,
  tabByNumber,
  tabsAtom,
  tabShowing,
  tabTopic,
  topicAtom,
  topicPlace,
  untouched,
  updateTabs,
  type MessageWindowSpec,
  type OpenOptions,
  type Place,
  type Tabs,
} from '@juno/state'
import { chatCopy, type JunoPage } from '@juno/agent-contract'
import { afterPaint, measure } from '@juno/state/perf'
import { toggleSidebar } from './layout'
import { togglePrivacy } from './privacy'

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

/** What the shown topic does just before another page replaces it: record its scroll position. Keyed by topic id. */
const leaving = new Map<string, () => void>()

/** Registers what the topic `id` does as it is left, while it is shown. Returns the unregister. */
export function onLeaveTab(id: string, leave: () => void): () => void {
  leaving.set(id, leave)
  return () => {
    if (leaving.get(id) === leave) leaving.delete(id)
  }
}

const activeTopic = (tabs: Tabs): string | undefined => {
  const tab = activeTab(tabs)
  return tab === undefined ? undefined : tabTopic(tab)
}

function apply(change: (tabs: Tabs) => Tabs): Tabs {
  const before = activeTopic(registry.get(tabsAtom))
  if (before !== undefined) leaving.get(before)?.()
  const next = updateTabs(registry, change)
  registry.set(selectedTopicAtom, activeTopic(next))
  return next
}

/**
 * Resolves once the topic's header and first window are local, or, after
 * `READY_WAIT_MS`, once the header is. Showing the tab without its header
 * would paint an empty pane and an empty tab title. A fresh open also
 * picks the window (`openWindow`); a topic coming back keeps the one it had.
 * A fresh open at `target`, a message older than that window, then takes
 * the window around the message instead.
 */
function whenReady(id: string, fresh: boolean, target?: string): Promise<void> {
  return new Promise((resolve) => {
    // The messages are asked for with the header, not after it, so the two queries overlap. A topic
    // coming back keeps its window; a fresh open usually gets the bottom one (`openWindow`), and one
    // with more unread than that asks for its own window once the header says so.
    const releases: Array<() => void> = [registry.mount(messagesAtom(id, fresh ? bottomWindow : registry.get(messageWindowSpecAtom(id))))]
    let done = false
    let specSet = false
    let anchored = false
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
      const list = registry.get(messageListAtom(id))
      if (fresh && target !== undefined && !anchored && list.ready && !waited) {
        const first = list.order[0]
        if (first !== undefined && target < first && !list.order.includes(target)) {
          anchored = true
          registry.set(messageWindowSpecAtom(id), { anchor: target, before: MESSAGE_WINDOW_BEFORE, limit: MESSAGE_WINDOW_DEFAULT })
          return
        }
      }
      if (waited || (list.ready && (!anchored || list.spec.anchor === target))) finish()
    }
    releases.push(registry.subscribe(topicAtom(id), check, { immediate: false }))
    check()
  })
}

/** Changes apply in the order they were asked for. */
let queue: Promise<void> = Promise.resolve()
/** Bumped by each change of what the window shows: a change that waited applies only if nothing replaced it since. */
let currentTicket = 0

/**
 * Applies `change` once `topic` (the topic the change brings on screen) can
 * paint, unless something newer replaced it meanwhile. With no topic to
 * wait for, it applies after the supplied readiness wait, or now.
 */
function show(
  change: (tabs: Tabs) => Tabs,
  topic: { readonly id: string; readonly fresh: boolean; readonly name: 'juno.topic-open' | 'juno.tab-switch'; readonly target?: string } | undefined,
  replaceable = true,
  ready?: Promise<void>,
): void {
  const at = performance.now()
  const ticket = replaceable ? ++currentTicket : currentTicket
  if (topic === undefined) {
    queue = queue.then(() => ready).then(() => {
      if (ticket === currentTicket) apply(change)
    })
    return
  }
  registry.set(selectedTopicAtom, topic.id)
  pending = { id: topic.id, at, name: topic.name }
  const topicReady = whenReady(topic.id, topic.fresh, topic.target)
  queue = queue
    .then(() => topicReady)
    .then(() => {
      if (!replaceable || ticket === currentTicket) apply(change)
    })
}

/** Opens a topic: in the current tab, a new tab with `newTab`, or the tab that already shows it. */
export function openTopic(id: string, options: OpenOptions = {}): void {
  openTopicFresh(id, options, undefined)
}

function openTopicFresh(id: string, options: OpenOptions, target: string | undefined): void {
  const showing = tabShowing(registry.get(tabsAtom), id)
  if (showing !== undefined) {
    switchToTab(showing.id)
    return
  }
  // A fresh open starts at the divider or the bottom, not where it was left.
  registry.set(scrollSnapshotAtom(id), undefined)
  // A new tab does not replace the current one, so a later open in the current tab does not cancel it.
  show((tabs) => openHere(tabs, topicPlace(id), options), { id, fresh: true, name: 'juno.topic-open', ...(target === undefined ? {} : { target }) }, options.newTab !== true)
}

/**
 * Opens `place` (`openPlace`). A New chat with a draft or a destination in
 * the current tab stays in its history, so Back returns to what was written.
 */
function openHere(tabs: Tabs, place: Place, options: OpenOptions = {}): Tabs {
  const tab = tabs.tabs.find((each) => each.id === tabs.active)
  const keepNewChat = tab !== undefined && currentPlace(tab).kind === 'newChat' && !untouched(registry.get(newChatAtom(tab.id)))
  return openPlace(tabs, place, { ...options, keepNewChat })
}

/**
 * ⌘T, ⌘N, "+" and the sidebar's New chat button: a New chat in a new tab
 * (spec section 9), or the New chat tab that is still untouched.
 */
export function openNewTab(): void {
  const blank = registry.get(tabsAtom).tabs.find((tab) => currentPlace(tab).kind === 'newChat' && untouched(registry.get(newChatAtom(tab.id))))
  if (blank !== undefined) {
    switchToTab(blank.id)
    return
  }
  show((tabs) => openHere(tabs, newChatPlace, { newTab: true }), undefined)
}

/** A New chat addressed to `conversation`, as ⌘K's result for a person never messaged (spec section 10). */
export function openNewChatTo(conversation: PickConversation): void {
  show((tabs) => {
    const blank = tabs.tabs.find((tab) => currentPlace(tab).kind === 'newChat' && untouched(registry.get(newChatAtom(tab.id))))
    const next = blank === undefined ? openHere(tabs, newChatPlace, { newTab: true }) : activateTab(tabs, blank.id)
    if (next.active !== undefined) registry.set(newChatAtom(next.active), pickConversation(emptyNewChat, conversation))
    return next
  }, undefined)
}

/**
 * Keep the topic on screen until Home's local rows are ready. After the
 * subscription expires, replacing it first would lay out an empty page
 * and then Home in separate frames. The wait is bounded as for All topics.
 */
export function openHome(options: OpenOptions = {}): void {
  const ready = new Promise<void>((resolve) => {
    const release = registry.mount(homeViewAtom)
    let done = false
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      off()
      resolve()
      afterPaint(release)
    }
    const check = () => {
      const result = registry.get(homeViewAtom)
      if (result._tag === 'Failure' || (result._tag === 'Success' && result.value.ready)) finish()
    }
    const timer = setTimeout(finish, READY_WAIT_MS)
    const off = registry.subscribe(homeViewAtom, check, { immediate: false })
    check()
  })
  show((tabs) => openHere(tabs, homePlace, options), undefined, true, ready)
}

/** A page behind the Juno menu, or Settings › Juno (SPEC 13.10). Each shows in one tab. */
export function openJunoPage(page: JunoPage, options: OpenOptions = {}): void {
  show((tabs) => openHere(tabs, junoPagePlace(page), options), undefined)
}

/** The Juno tab (SPEC 13). One chat, so one tab: the tab that shows it is focused. */
export function openJuno(options: OpenOptions = {}): void {
  show((tabs) => openHere(tabs, junoPlace, options), undefined)
}

/** The Notifications page (SPEC 14), a singleton like Home. */
export function openNotifications(options: OpenOptions = {}): void {
  show((tabs) => openHere(tabs, notificationsPlace, options), undefined)
}

/** Preferences (SPEC 14), a singleton like Home. */
export function openPreferences(options: OpenOptions = {}): void {
  show((tabs) => openHere(tabs, preferencesPlace, options), undefined)
}

/** Below the header band, where a message a notification opens lands. */
const MESSAGE_TOP = 80

/**
 * Opens a topic at one message, as a clicked notification or a Juno source
 * link does: a fresh open lands with that message near the top, taking the
 * window around it when it is older than the first window. A tab that
 * already shows the topic is focused, and its window moves to the message
 * when the message is not in it. With `flash`, the topic scrolls to the
 * message once shown (letting go of the bottom) and flashes it.
 */
export function openTopicAt(id: string, ts: string, options: OpenOptions & { readonly flash?: boolean } = {}): void {
  if (options.flash === true) flashMessage(registry, id, ts)
  if (tabShowing(registry.get(tabsAtom), id) !== undefined) {
    const list = registry.get(messageListAtom(id))
    if (list.ready && !list.order.includes(ts)) registry.set(messageWindowSpecAtom(id), { anchor: ts, before: MESSAGE_WINDOW_BEFORE, limit: MESSAGE_WINDOW_DEFAULT })
    return openTopic(id)
  }
  openTopicFresh(id, options.newTab === true ? { newTab: true } : {}, ts)
  registry.set(scrollSnapshotAtom(id), { anchorKey: ts, offset: MESSAGE_TOP })
}

/** A Juno source link (SPEC 13.1): the topic that holds the message, opened at it, and the message flashes. */
export async function openSlackMessage(channel: string, ts: string, options: OpenOptions = {}): Promise<void> {
  const located = await locateMessage(registry, channel, ts)
  if (located._tag === 'Success') openTopicAt(located.value.topicId, ts, { ...options, flash: true })
}

/** When the last All topics open started, for the page's first paint with rows to end its measure on. */
let allTopicsOpenStart: number | undefined

export function takeAllTopicsOpenStart(): number | undefined {
  const start = allTopicsOpenStart
  allTopicsOpenStart = undefined
  return start
}

/** The All topics page's code, loaded once; the sidebar loads it on idle after its first paint. */
export const loadAllTopicsPage = (() => {
  let loading: Promise<typeof import('./AllTopics')> | undefined
  return () => (loading ??= import('./AllTopics'))
})()

/**
 * Resolves once the page's code is loaded and its first window is local,
 * or after `READY_WAIT_MS` without the window, so the page does not paint
 * an empty table when the engine answers within a frame or two.
 */
function whenAllTopicsReady(): Promise<void> {
  return loadAllTopicsPage().then(
    () =>
      new Promise((resolve) => {
        let done = false
        const release = registry.mount(allTopicsLayoutAtom)
        const finish = () => {
          if (done) return
          done = true
          clearTimeout(timer)
          off()
          resolve()
          afterPaint(release)
        }
        const check = () => {
          if (registry.get(allTopicsLayoutAtom).ready) finish()
        }
        const timer = setTimeout(finish, READY_WAIT_MS)
        const off = registry.subscribe(allTopicsLayoutAtom, check, { immediate: false })
        check()
      }),
  )
}

/** The sidebar's All topics item and the "View all topics" empty states. All topics is a singleton, like Home. */
export function openAllTopics(options: OpenOptions = {}): void {
  if (allTopicsTab(registry.get(tabsAtom)) !== undefined) {
    show((tabs) => openHere(tabs, allTopicsPlace, options), undefined)
    return
  }
  const ticket = ++currentTicket
  allTopicsOpenStart = performance.now()
  const ready = whenAllTopicsReady()
  queue = queue
    .then(() => ready)
    .then(() => {
      if (ticket === currentTicket) apply((tabs) => openHere(tabs, allTopicsPlace, options))
    })
}

/**
 * A New chat sent to `topicId`: its tab becomes the topic, in the frame the
 * topic can paint, or closes when another tab shows it (`settleNewChat`).
 * Never replaced by a later open, so the sent message always shows. The
 * draft is cleared even when the tab was closed during the send, so
 * reopening it can never send the message again.
 */
export function settleSentChat(tabId: string, topicId: string): void {
  registry.set(scrollSnapshotAtom(topicId), undefined)
  show(
    (tabs) => {
      registry.set(newChatAtom(tabId), emptyNewChat)
      return settleNewChat(tabs, tabId, topicId)
    },
    { id: topicId, fresh: true, name: 'juno.topic-open' },
    false,
  )
}

/** The topic a tab change brings on screen, if it has to wait for one. */
function arriving(tabs: Tabs, tabId: string, place: Place | undefined, fresh: boolean) {
  if (place?.kind !== 'topic') return undefined
  // A mounted tab that keeps its page shows in the next frame.
  const tab = tabs.tabs.find((other) => other.id === tabId)
  if (tab !== undefined && mountedTabs(tabs).has(tabId) && tabTopic(tab) === place.topicId) return undefined
  return { id: place.topicId, fresh, name: 'juno.tab-switch' as const }
}

/**
 * Focuses an open tab. A mounted tab shows in the next frame; one that was
 * unmounted waits, like an open, until its data is local, then comes back
 * at its scroll snapshot.
 */
export function switchToTab(tabId: string): void {
  const at = performance.now()
  const tabs = registry.get(tabsAtom)
  if (tabs.active === tabId) return
  const tab = tabs.tabs.find((other) => other.id === tabId)
  if (tab === undefined) return
  const topic = arriving(tabs, tabId, currentPlace(tab), false)
  if (topic === undefined) {
    ++currentTicket
    apply((current) => activateTab(current, tabId))
    afterPaint(() => measure('juno.tab-switch', at, { detail: { id: tabTopic(tab) ?? tabId, mounted: true } }))
    return
  }
  show((current) => activateTab(current, tabId), topic)
}

/** Back (-1) or Forward (1) in the active tab. The topic comes back where it was left. */
export function stepTabHistory(step: 1 | -1): void {
  const tabs = registry.get(tabsAtom)
  const tab = activeTab(tabs)
  if (tab === undefined) return
  goToTabEntry(tab.history.index + step)
}

/** Shows entry `index` of the active tab's history (Back, Forward and the history menu). */
export function goToTabEntry(index: number): void {
  const tabs = registry.get(tabsAtom)
  const tab = activeTab(tabs)
  const place = tab?.history.entries[index]
  if (tab === undefined || place === undefined || index === tab.history.index) return
  const topic = place.kind === 'topic' ? { id: place.topicId, fresh: false, name: 'juno.topic-open' as const } : undefined
  show((current) => goToEntry(current, index), topic)
}

/**
 * The last tab change still waiting for its topic. A tab change that comes
 * before it applies (⌘W held down, ⌘⇧T twice) builds on it rather than
 * replacing it, so each press counts.
 */
let waitingTabChange: { readonly ticket: number; readonly change: (tabs: Tabs) => Tabs } | undefined

/** Brings the tab that is active after `change` on screen, waiting for its topic when it was not mounted. */
function changeTabs(change: (tabs: Tabs) => Tabs): void {
  const waiting = waitingTabChange?.ticket === currentTicket ? waitingTabChange.change : undefined
  waitingTabChange = undefined
  const tabs = registry.get(tabsAtom)
  const base = waiting === undefined ? tabs : waiting(tabs)
  if (change(base) === base && waiting === undefined) return
  const both = waiting === undefined ? change : (current: Tabs) => change(waiting(current))
  const next = both(tabs)
  const tab = activeTab(next)
  const topic = tab === undefined || tab.id === tabs.active ? undefined : arriving(tabs, tab.id, currentPlace(tab), false)
  if (topic === undefined) {
    ++currentTicket
    apply(both)
    return
  }
  const applying = (current: Tabs) => {
    if (waitingTabChange?.change === applying) waitingTabChange = undefined
    return both(current)
  }
  show(applying, topic)
  waitingTabChange = { ticket: currentTicket, change: applying }
}

export function closeTabById(tabId: string): void {
  changeTabs((tabs) => closeTab(tabs, tabId))
}

/** ⌘W: closes whichever tab is active once the changes before it apply. */
function closeActiveTab(): void {
  changeTabs((tabs) => (tabs.active === undefined ? tabs : closeTab(tabs, tabs.active)))
}

/** The app menu and the three-finger swipe. */
export function runMenuCommand(command: MenuCommand): void {
  const tabs = registry.get(tabsAtom)
  switch (command) {
    case 'tab.new':
      return openNewTab()
    case 'tab.close':
      return closeActiveTab()
    case 'tab.reopen':
      return changeTabs(reopenClosedTab)
    case 'tab.next':
    case 'tab.previous': {
      const next = cycleTab(tabs, command === 'tab.next' ? 1 : -1)
      if (next.active !== undefined && next.active !== tabs.active) switchToTab(next.active)
      return
    }
    case 'history.back':
      return stepTabHistory(-1)
    case 'history.forward':
      return stepTabHistory(1)
    case 'sidebar.toggle':
      return toggleSidebar()
    case 'privacy.toggle':
      return togglePrivacy()
    case 'juno.toggle':
      // `juno/actions.ts` handles it.
      return
    case 'edit.undo':
      // `topicActions.ts` handles it.
      return
    case 'palette.toggle':
      // `Palette.tsx` handles it.
      return
    case 'preferences.open':
      return openPreferences()
    default: {
      const tab = tabByNumber(tabs, Number(command.slice('tab.select.'.length)))
      if (tab !== undefined) switchToTab(tab.id)
    }
  }
}

/** Pointer enter, focus or keyboard selection of something that opens a topic. */
export function warmTopic(id: string): void {
  prefetchTopic(registry, id)
}

/** The tab menu (inventory 15.5). Copy Slack link and Open in Slack only on a topic tab whose header is local. */
export async function showTabMenu(tabId: string): Promise<void> {
  const tabs = registry.get(tabsAtom)
  const at = tabs.tabs.findIndex((tab) => tab.id === tabId)
  const tab = tabs.tabs[at]
  if (tab === undefined) return
  const topicId = tabTopic(tab)
  const header = topicId === undefined ? undefined : registry.get(topicAtom(topicId))
  const detail = header?._tag === 'Success' ? header.value : null
  const chosen = await popupContextMenu([
    { id: 'pin', label: tab.pinned ? 'Unpin tab' : 'Pin tab' },
    { separator: true },
    { id: 'close', label: 'Close tab', accelerator: 'CommandOrControl+W' },
    { id: 'close-others', label: 'Close other tabs', enabled: tabs.tabs.some((other) => other.id !== tabId && !other.pinned) },
    { id: 'close-right', label: 'Close tabs to the right', enabled: tabs.tabs.slice(at + 1).some((other) => !other.pinned) },
    { id: 'close-all', label: 'Close all tabs', enabled: tabs.tabs.some((other) => !other.pinned) },
    ...(detail === null
      ? []
      : [{ separator: true } as const, { id: 'copy-link', label: 'Copy Slack link' }, { id: 'open-in-slack', label: 'Open in Slack' }]),
  ])
  switch (chosen) {
    case 'pin':
      return void apply((current) => setPinned(current, tabId, !tab.pinned))
    case 'close':
      return closeTabById(tabId)
    case 'close-others':
      return changeTabs((current) => closeOtherTabs(current, tabId))
    case 'close-right':
      return changeTabs((current) => closeTabsToRight(current, tabId))
    case 'close-all':
      return changeTabs(closeAllTabs)
    case 'copy-link': {
      const session = registry.get(signedInAtom)
      if (detail !== null && session !== undefined) copyText(slackLink(session.workspaceUrl, detail))
      return
    }
    case 'open-in-slack': {
      const session = registry.get(signedInAtom)
      if (detail !== null && session !== undefined) openInSlack({ teamId: session.teamId, channelId: detail.channel.id })
      return
    }
  }
}

/** What the history menu calls a place: the tab's title for it. */
function placeLabel(place: Place): string {
  if (place.kind === 'newChat') return 'New chat'
  if (place.kind === 'home') return 'Home'
  if (place.kind === 'juno') return 'Juno'
  if (place.kind === 'junoPage') return chatCopy.pageTitles[place.page]
  if (place.kind === 'notifications') return 'Notifications'
  if (place.kind === 'preferences') return 'Preferences'
  if (place.kind === 'allTopics') return 'All topics'
  const result = registry.get(topicAtom(place.topicId))
  const detail = result._tag === 'Success' ? result.value : null
  if (detail === null) return 'Topic'
  return detail.kind === 'main' ? detail.channel.label : detail.title
}

/** A long press on Back (-1) or Forward (1): the active tab's history that way, nearest first, as in Safari. */
export async function showHistoryMenu(step: 1 | -1): Promise<void> {
  const tab = activeTab(registry.get(tabsAtom))
  if (tab === undefined) return
  const items: Array<{ id: string; label: string }> = []
  for (let index = tab.history.index + step; index >= 0 && index < tab.history.entries.length && items.length < 20; index += step) {
    items.push({ id: String(index), label: placeLabel(tab.history.entries[index]!) })
  }
  if (items.length === 0) return
  const chosen = await popupContextMenu(items)
  if (chosen !== undefined && registry.get(tabsAtom).active === tab.id) goToTabEntry(Number(chosen))
}
