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
 *
 * A topic's window and scroll position belong to the tab that shows it
 * (`topicView`), so two tabs on one topic scroll apart. A fresh open waits
 * on the topic's own view and hands its window to the tab it lands in.
 */
import {
  MESSAGE_WINDOW_BEFORE,
  MESSAGE_WINDOW_DEFAULT,
  MESSAGE_WINDOW_MAX,
  type MenuCommand,
  type PickConversation,
  type TopicDetail,
} from '@juno/contract'
import { holdKeys } from '@juno/views'
import {
  activateTab,
  activeTab,
  allTopicsLayoutAtom,
  flushSidebar,
  bottomWindow,
  messagesAtom,
  closeAllTabs,
  closeOtherTabs,
  closeTab,
  moveTab,
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
  junoPanelViewAtom,
  messageListAtom,
  messageWindowSpecAtom,
  mountedTabs,
  homeDraftAtom,
  setHomeDraft,
  emptyHomeDraft,
  requestHomeFocus,
  openInSlack,
  openPlace,
  showInActiveTab,
  openSettingsSection,
  pickConversation,
  popupContextMenu,
  prefetchHome,
  prefetchTopic,
  registry,
  reopenClosedTab,
  scrollSnapshotAtom,
  selectedTopicAtom,
  setPinned,
  showWelcome,
  tickWelcome,
  signedInAtom,
  slackLink,
  tabByNumber,
  tabsAtom,
  tabShowing,
  tabShowingPlace,
  tabTopic,
  topicAtom,
  topicOfView,
  topicPlace,
  topicView,
  traceSend,
  untouched,
  updateTabs,
  type MessageWindowSpec,
  type OpenOptions,
  type Place,
  type ScrollSnapshot,
  type Tabs,
} from '@juno/state'
import type { JunoPage } from '@juno/agent-contract'
import type { JunoView } from '@juno/state'
import { junoViewReady } from '@juno/state/agent'
import type { SettingsSection } from '@juno/contract'
import { afterPaint, measure } from '@juno/state/perf'
import { chunk } from './chunks'
import { toggleSidebar } from './layout'
import { paletteTakesTabNumber } from './paletteActions'
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

/** What the shown topic does just before another page replaces it: record its scroll position. Keyed by topic view. */
const leaving = new Map<string, () => void>()

/** Registers what the topic view `view` does as it is left, while it is shown. Returns the unregister. */
export function onLeaveTab(view: string, leave: () => void): () => void {
  leaving.set(view, leave)
  return () => {
    if (leaving.get(view) === leave) leaving.delete(view)
  }
}

const activeTopic = (tabs: Tabs): string | undefined => {
  const tab = activeTab(tabs)
  return tab === undefined ? undefined : tabTopic(tab)
}

/** The topic view the active tab shows, if it shows a topic. */
const activeView = (tabs: Tabs): string | undefined => {
  const tab = activeTab(tabs)
  const topic = tab === undefined ? undefined : tabTopic(tab)
  const place = tab === undefined ? undefined : currentPlace(tab)
  return topic === undefined ? undefined : topicView(place?.kind === 'topic' ? place.viewId ?? topic : topic, tab!.id)
}

function apply(change: (tabs: Tabs) => Tabs): Tabs {
  const before = activeView(registry.get(tabsAtom))
  if (before !== undefined) leaving.get(before)?.()
  const next = updateTabs(registry, change)
  registry.set(selectedTopicAtom, activeTopic(next))
  traceSend('tabs applied', () => ({ active: next.active, topic: activeTopic(next) }))
  return next
}

/**
 * A fresh open landed: the tab that now shows the topic takes the window
 * the open waited for, and starts at `snapshot` (a message a link asked
 * for) or else at the divider or the bottom. A tab that already showed the
 * topic before the change keeps its own. The tab's window is its own
 * subscription; if the topic's first fetch covers its history only after
 * that subscription started, the tab asks for it again (`refreshMessages`
 * in `TopicView`).
 */
function landFresh(before: Tabs, next: Tabs, topicId: string, snapshot: ScrollSnapshot | undefined): void {
  const tab = activeTab(next)
  if (tab === undefined || tabTopic(tab) !== topicId) return
  const prior = before.tabs.find((other) => other.id === tab.id)
  if (prior !== undefined && prior.history === tab.history) return
  const view = topicView(topicId, tab.id)
  registry.set(messageWindowSpecAtom(view), registry.get(messageWindowSpecAtom(topicId)))
  registry.set(scrollSnapshotAtom(view), snapshot)
}

/**
 * Resolves once the topic's header and first window are local, or, after
 * `READY_WAIT_MS`, once the header is. Showing the tab without its header
 * would paint an empty pane and an empty tab title. A fresh open also
 * picks the window (`openWindow`); a topic coming back keeps the one it had.
 * A fresh open at `target`, a message older than that window, then takes
 * the window around the message instead.
 */
function whenReady(view: string, fresh: boolean, target?: string): Promise<void> {
  const id = topicOfView(view)
  return new Promise((resolve) => {
    // The messages are asked for with the header, not after it, so the two queries overlap. A topic
    // coming back keeps its window; a fresh open usually gets the bottom one (`openWindow`), and one
    // with more unread than that asks for its own window once the header says so.
    const releases: Array<() => void> = [registry.mount(messagesAtom(id, fresh ? bottomWindow : registry.get(messageWindowSpecAtom(view))))]
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
        if (fresh) registry.set(messageWindowSpecAtom(view), openWindow(detail))
        releases.push(registry.subscribe(messageListAtom(view), check, { immediate: false }))
      }
      const list = registry.get(messageListAtom(view))
      if (fresh && target !== undefined && !anchored && list.ready && !waited) {
        const first = list.order[0]
        if (first !== undefined && target < first && !list.order.includes(target)) {
          anchored = true
          registry.set(messageWindowSpecAtom(view), { anchor: target, before: MESSAGE_WINDOW_BEFORE, limit: MESSAGE_WINDOW_DEFAULT })
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
 * Runs `f` once the changes asked for so far have applied. A topic open waits for the topic to paint, so a
 * command that depends on the place, such as ⌘J right after a click on a topic, acts on the place chosen last.
 */
export function afterNavigation(f: () => void): void {
  void queue.then(f)
}

/** A topic a change brings on screen. A fresh open waits on the topic's own view; a tab coming back on its view. */
interface Arriving {
  readonly id: string
  /** The view to wait on: `topicView(id, tabId)` for a tab coming back. Default the topic's own, as a fresh open has. */
  readonly view?: string
  readonly fresh: boolean
  readonly name: 'juno.topic-open' | 'juno.tab-switch'
  /** A fresh open at a message older than the first window: the window around it. */
  readonly target?: string
  /** A fresh open's starting position instead of the divider or the bottom. */
  readonly snapshot?: ScrollSnapshot
}

/**
 * Applies `change` once `topic` (the topic the change brings on screen) can
 * paint, unless something newer replaced it meanwhile. With no topic to
 * wait for, it applies after the supplied readiness wait, or now.
 */
function show(change: (tabs: Tabs) => Tabs, topic: Arriving | undefined, replaceable = true, ready?: Promise<void>): void {
  const at = performance.now()
  const ticket = replaceable ? ++currentTicket : currentTicket
  traceSend('tabs asked', () => ({ ticket, replaceable, ...(topic === undefined ? {} : { view: (topic.view ?? topic.id).replace('\u0000', '@'), fresh: topic.fresh }) }))
  if (topic === undefined) {
    queue = queue.then(() => ready).then(() => {
      if (!replaceable || ticket === currentTicket) apply(change)
      else traceSend('tabs dropped', () => ({ ticket, current: currentTicket }))
    })
    return
  }
  registry.set(selectedTopicAtom, topic.id)
  pending = { id: topicOfView(topic.view ?? topic.id), at, name: topic.name }
  const topicReady = whenReady(topic.view ?? topic.id, topic.fresh, topic.target)
  const landing = topic.fresh
    ? (tabs: Tabs) => {
        const next = change(tabs)
        landFresh(tabs, next, topic.id, topic.snapshot)
        return next
      }
    : change
  queue = queue
    .then(() => topicReady)
    .then(() => {
      if (!replaceable || ticket === currentTicket) apply(landing)
      else traceSend('tabs dropped', () => ({ ticket, current: currentTicket }))
    })
}

/**
 * Opens a topic: in the current tab, or the tab that already shows it; with
 * `newTab`, in a new tab even when another tab shows it (SPEC 6).
 */
export function openTopic(id: string, options: OpenOptions = {}): void {
  // An open from anywhere but the sidebar list shows the list's held changes (SPEC 5, "Holding the order").
  flushSidebar(registry)
  openTopicFresh(id, options, undefined, undefined)
}

/** A sidebar row's open: the list goes on holding its order under the pointer. */
export function openTopicFromList(id: string, options: OpenOptions = {}): void {
  openTopicFresh(id, options, undefined, undefined)
}

/**
 * ⌘-click on Start thread or Open thread (SPEC 6 and 7): the topic in a new
 * tab after the current one, which stays active with its scroll and focus.
 * The new tab gets a fresh open's window once the topic is local, so it
 * opens at the divider or the bottom when it is chosen. A send from Home
 * passes its tab as `after`, and `unlessShown` so a tab that already shows
 * the topic is enough (SPEC 12).
 */
export function openTopicInBackground(id: string, { after, unlessShown = false }: { readonly after?: string; readonly unlessShown?: boolean } = {}): void {
  queue = queue.then(() => {
    const shownIn = unlessShown ? tabShowing(registry.get(tabsAtom), id) : undefined
    traceSend('background', () => ({ topic: id, ...(shownIn === undefined ? {} : { reused: shownIn.id }) }))
    if (shownIn !== undefined) return
    const before = new Set(registry.get(tabsAtom).tabs.map((tab) => tab.id))
    const next = updateTabs(registry, (tabs) => openPlace(tabs, topicPlace(id), { newTab: true, background: true, ...(after === undefined ? {} : { after }) }))
    const tab = next.tabs.find((each) => !before.has(each.id))
    traceSend('background opened', () => ({ topic: id, tab: tab?.id }))
    if (tab === undefined) return
    void whenReady(id, true).then(() => {
      registry.set(messageWindowSpecAtom(topicView(id, tab.id)), registry.get(messageWindowSpecAtom(id)))
      traceSend('background window', () => ({ topic: id, tab: tab.id }))
    })
  })
}

function openTopicFresh(id: string, options: OpenOptions, target: string | undefined, snapshot: ScrollSnapshot | undefined): void {
  // A topic in a new tab: the welcome card's second hint (SPEC 4).
  if (options.newTab === true) tickWelcome(registry, 'tab')
  const showing = options.newTab === true ? undefined : tabShowing(registry.get(tabsAtom), id)
  if (showing !== undefined) {
    switchToTab(showing.id)
    return
  }
  // A fresh open starts at the divider or the bottom (or `snapshot`), not where it was left: `landFresh`.
  // A new tab does not replace the current one, so a later open in the current tab does not cancel it.
  show(
    (tabs) => openPlace(tabs, topicPlace(id), options),
    { id, fresh: true, name: 'juno.topic-open', ...(target === undefined ? {} : { target }), ...(snapshot === undefined ? {} : { snapshot }) },
    options.newTab !== true,
  )
}

/**
 * A new tab with Home, its field focused; with `list`, its destination list
 * open; with `conversation`, that destination chosen.
 */
function openHomeTab(list: boolean, conversation?: PickConversation): void {
  // The new tab mounts a moment later. Until its composer takes focus, keys typed after ⌘T must not land in
  // the field the old tab had focused; they are held, and Home types them into its field or search.
  holdKeys()
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  // A new tab does not replace the current one, so an open still waiting there is not cancelled.
  show((tabs) => {
    const next = openPlace(tabs, homePlace, { newTab: true })
    if (next.active !== undefined) {
      if (conversation !== undefined) setHomeDraft(registry, next.active, pickConversation(emptyHomeDraft, conversation))
      requestHomeFocus(registry, next.active, list)
    }
    return next
  }, undefined, false)
}

/** ⌘T and the strip's "+": a new tab with Home, ready to write (SPEC 6). */
export function openNewTab(): void {
  openHomeTab(false)
}

/**
 * ⌘N (SPEC 12, "Writing"): write a message from Home. It uses this tab if it
 * is Home, else a tab that shows Home, else a new one, and a new one too
 * when that Home already has a draft, so nothing written is disturbed. The
 * destination list opens; with `conversation` (⌘K's result for a person
 * never messaged) that destination is chosen instead.
 */
export function newMessage(conversation?: PickConversation): void {
  const tabs = registry.get(tabsAtom)
  const current = activeTab(tabs)
  const home = current !== undefined && currentPlace(current).kind === 'home' ? current : tabShowingPlace(tabs, homePlace)
  if (home === undefined || !untouched(registry.get(homeDraftAtom(home.id)))) return openHomeTab(conversation === undefined, conversation)
  if (conversation !== undefined) setHomeDraft(registry, home.id, pickConversation(registry.get(homeDraftAtom(home.id)), conversation))
  // Keys typed before the list's search has focus go into it once it does (`useFocusRequest`).
  holdKeys()
  if (home.id !== tabs.active) switchToTab(home.id)
  requestHomeFocus(registry, home.id, conversation === undefined)
}

/**
 * Keep the topic on screen until Home has a value (its rows, or the
 * syncing state of a first sync). After the
 * subscription expires, replacing it first would lay out an empty page
 * and then Home in separate frames. The wait is bounded as for All topics.
 */
/** Help › Show the Tour, ⌘K and Settings › About: the welcome card again, on Home (SPEC 4). */
export function showTheTour(): void {
  showWelcome(registry)
  openHome()
}

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
      if (result._tag === 'Failure' || result._tag === 'Success') finish()
    }
    const timer = setTimeout(finish, READY_WAIT_MS)
    const off = registry.subscribe(homeViewAtom, check, { immediate: false })
    check()
  })
  // A new tab does not replace the current one, so a later open in the current tab does not cancel it.
  show((tabs) => openPlace(tabs, homePlace, options), undefined, options.newTab !== true, ready)
}

/**
 * A page behind the Juno menu (SPEC 13.10). A plain open focuses a tab that
 * shows it. Its Settings and Connections are sections of Settings, so links
 * to them open there.
 */
export function openJunoPage(page: JunoPage, options: OpenOptions = {}): void {
  if (page === 'settings') return openSettings('juno', options)
  if (page === 'connections') return openSettings('connections', options)
  show((tabs) => openPlace(tabs, junoPagePlace(page), options), undefined)
}

const junoViewReadyFor = (view: JunoView) => junoViewReady(registry, view, READY_WAIT_MS)

/**
 * The Juno header's switcher in a Juno tab (SPEC 13.10): the chat or a page
 * in this same tab, as a new history entry, so Back returns. Connections and
 * Settings open their sections of Settings.
 */
export function showJunoView(target: JunoView | 'connections' | 'settings'): void {
  if (target === 'settings' || target === 'connections') return openJunoPage(target)
  switchStartedAt = target === 'chat' ? undefined : performance.now()
  const place = target === 'chat' ? junoPlace : junoPagePlace(target)
  show((tabs) => showInActiveTab(tabs, place), undefined, true, junoViewReadyFor(target))
}

/** The same switcher in the Juno panel: the panel shows the chat or the page in place, beside the topic. */
export function showJunoPanelView(tabId: string, target: JunoView | 'connections' | 'settings'): void {
  if (target === 'settings' || target === 'connections') return openJunoPage(target)
  switchStartedAt = target === 'chat' ? undefined : performance.now()
  // The last pick wins, however long each page took to be ready.
  const ticket = ++panelTicket
  void junoViewReadyFor(target).then(() => {
    if (ticket === panelTicket) registry.set(junoPanelViewAtom(tabId), target)
  })
}

let panelTicket = 0

let switchStartedAt: number | undefined

/** When the switcher was last picked from, once, for `juno.page-switch`. */
export function takeJunoSwitchStart(): number | undefined {
  const at = switchStartedAt
  switchStartedAt = undefined
  return at
}

/** The Juno tab (SPEC 13). A plain open focuses a tab that shows it; each Juno tab shows the one chat. */
export function openJuno(options: OpenOptions = {}): void {
  show((tabs) => openPlace(tabs, junoPlace, options), undefined)
}

/**
 * Settings at a section (SPEC 14), in its one tab. Every way in comes here:
 * ⌘,, the avatar menu, the Juno menu and "Add a provider" (Juno, which
 * puts focus in the key field while no provider is set up).
 */
export function openSettings(section: SettingsSection = 'general', options: OpenOptions = {}): void {
  show((tabs) => openSettingsSection(tabs, section, options), undefined)
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
  flushSidebar(registry)
  if (options.flash === true) flashMessage(registry, id, ts)
  const showing = options.newTab === true ? undefined : tabShowing(registry.get(tabsAtom), id)
  if (showing !== undefined) {
    const place = currentPlace(showing)
    const view = topicView(place.kind === 'topic' ? place.viewId ?? id : id, showing.id)
    const list = registry.get(messageListAtom(view))
    if (list.ready && !list.order.includes(ts)) registry.set(messageWindowSpecAtom(view), { anchor: ts, before: MESSAGE_WINDOW_BEFORE, limit: MESSAGE_WINDOW_DEFAULT })
    return switchToTab(showing.id)
  }
  openTopicFresh(id, options.newTab === true ? { newTab: true } : {}, ts, { anchorKey: ts, offset: MESSAGE_TOP })
}

/**
 * ⌘-click on a Slack link in a message (SPEC 8, "Links"): the topic in a new
 * tab after the current one, which stays active, as `openTopicInBackground`.
 * The new tab takes the window around the message and starts at it, and the
 * message flashes when the tab is first shown.
 */
export function openTopicAtInBackground(id: string, ts: string): void {
  flushSidebar(registry)
  flashMessage(registry, id, ts)
  queue = queue.then(() => {
    const before = new Set(registry.get(tabsAtom).tabs.map((tab) => tab.id))
    const next = updateTabs(registry, (tabs) => openPlace(tabs, topicPlace(id), { newTab: true, background: true }))
    const tab = next.tabs.find((each) => !before.has(each.id))
    if (tab === undefined) return
    const view = topicView(id, tab.id)
    registry.set(messageWindowSpecAtom(view), { anchor: ts, before: MESSAGE_WINDOW_BEFORE, limit: MESSAGE_WINDOW_DEFAULT })
    registry.set(scrollSnapshotAtom(view), { anchorKey: ts, offset: MESSAGE_TOP })
  })
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

/** The All topics page, its own chunk (performance 2.1), loaded once; the workspace loads it on idle after its first paint. */
const allTopicsChunk = chunk(() => import('./AllTopics'))
export const loadAllTopicsPage = allTopicsChunk.load
export const AllTopicsPage = allTopicsChunk.component((module) => module.default)

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

/** The sidebar's All topics item and the "View all topics" empty states. A plain open focuses a tab that shows it, as for Home. */
export function openAllTopics(options: OpenOptions = {}): void {
  if (options.newTab !== true && allTopicsTab(registry.get(tabsAtom)) !== undefined) {
    show((tabs) => openPlace(tabs, allTopicsPlace, options), undefined)
    return
  }
  const ticket = ++currentTicket
  allTopicsOpenStart = performance.now()
  const ready = whenAllTopicsReady()
  queue = queue
    .then(() => ready)
    .then(() => {
      if (ticket === currentTicket) apply((tabs) => openPlace(tabs, allTopicsPlace, options))
    })
}

/** The topic a tab change brings on screen, if it has to wait for one. */
function arriving(tabs: Tabs, tabId: string, place: Place | undefined, fresh: boolean) {
  if (place?.kind !== 'topic') return undefined
  // A mounted tab that keeps its page shows in the next frame.
  const tab = tabs.tabs.find((other) => other.id === tabId)
  if (tab !== undefined && mountedTabs(tabs).has(tabId) && tabTopic(tab) === place.topicId) return undefined
  return { id: place.topicId, view: topicView(place.viewId ?? place.topicId, tabId), fresh, name: 'juno.tab-switch' as const }
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
  traceSend('switch', () => ({ tab: tabId, from: tabs.active }))
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
  const topic = place.kind === 'topic' ? { id: place.topicId, view: topicView(place.viewId ?? place.topicId, tab.id), fresh: false, name: 'juno.topic-open' as const } : undefined
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

/** A tab dragged, or moved with ⌃⇧← and ⌃⇧→, to `index` in the strip. */
export function moveTabTo(tabId: string, index: number): void {
  changeTabs((tabs) => moveTab(tabs, tabId, index))
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
    case 'chat.new':
      return newMessage()
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
    case 'settings.open':
      return openSettings()
    case 'tour.show':
      return showTheTour()
    default: {
      const number = Number(command.slice('tab.select.'.length))
      if (paletteTakesTabNumber(number)) return
      const tab = tabByNumber(tabs, number)
      if (tab !== undefined) switchToTab(tab.id)
    }
  }
}

/** Pointer enter, focus or keyboard selection of something that opens a topic. */
export function warmTopic(id: string): void {
  prefetchTopic(registry, id)
}

/** Pointer enter or focus on the sidebar's Home button: after the idle TTL, `openHome` then has a value at once. */
export function warmHome(): void {
  prefetchHome(registry)
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
