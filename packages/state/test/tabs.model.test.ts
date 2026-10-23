/**
 * The tab rules as a model: seeded random sequences of what a user can do to
 * the strip, with the invariants checked after every step, then the
 * placement rules as named examples and the saved formats older builds wrote.
 */
import { describe, expect, it } from 'bun:test'
import {
  acknowledgeTopic,
  activateTab,
  closeAllTabs,
  closeOtherTabs,
  closeTab,
  closeTabsToRight,
  currentPlace,
  cycleTab,
  devLogPlace,
  dividerIndex,
  ensureTab,
  expireTabs,
  galleryPlace,
  goToEntry,
  historyTarget,
  homePlace,
  huddlePlace,
  junoPagePlace,
  junoPlace,
  allTopicsPlace,
  mountedTabs,
  moveTab,
  noTabs,
  openPlace,
  openSettingsSection,
  parseTabs,
  reopenClosedTab,
  replaceInTab,
  savedTabs,
  setJunoPanel,
  setPinned,
  showInActiveTab,
  stampViewed,
  stepHistory,
  tabByNumber,
  tabTopic,
  topicPlace,
  CLOSED_LIMIT,
  HISTORY_LIMIT,
  MOUNTED_TABS,
  type OpenOptions,
  type Place,
  type Tab,
  type Tabs,
} from '../src/tabs'

/** mulberry32: a small seeded generator, so a failing sequence can be replayed from its seed. */
function random(seed: number) {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (below: number) => Math.floor(next() * below)
  const pick = <A>(items: ReadonlyArray<A>): A => items[int(items.length)]!
  return { next, int, pick }
}

const PENDING = 'p:C1:client-1'
const places: ReadonlyArray<Place> = [
  topicPlace('t:C1:1.000001'),
  topicPlace('t:C1:2.000001'),
  topicPlace('m:C2'),
  topicPlace(PENDING),
  homePlace,
  allTopicsPlace,
  junoPlace,
  junoPagePlace('activity'),
  junoPagePlace('scheduled'),
  huddlePlace('C1'),
  galleryPlace(),
  galleryPlace('pic-1'),
  devLogPlace,
]
const sections = ['general', 'notifications', 'juno', 'connections'] as const

type Step = { readonly name: string; readonly apply: (tabs: Tabs) => Tabs; readonly opensSettings?: true }

/** One thing a user can do, chosen at random against the tabs as they are. */
function step(r: ReturnType<typeof random>, tabs: Tabs, now: number): Step {
  const ids = tabs.tabs.map((tab) => tab.id)
  const anyId = () => (ids.length === 0 || r.next() < 0.05 ? 'tab-404' : r.pick(ids))
  const options = (): OpenOptions => r.pick<OpenOptions>([{}, {}, { newTab: true }, { newTab: true, background: true }, { newTab: true, after: anyId() }, { newTab: true, background: true, after: anyId() }])
  const choices: ReadonlyArray<() => Step> = [
    () => { const place = r.pick(places), o = options(); return { name: `open ${JSON.stringify(place)} ${JSON.stringify(o)}`, apply: (t) => openPlace(t, place, o) } },
    () => { const place = r.pick(places), o = options(); return { name: `open ${JSON.stringify(place)} ${JSON.stringify(o)}`, apply: (t) => openPlace(t, place, o) } },
    () => { const section = r.pick(sections), o = options(); return { name: `settings ${section} ${JSON.stringify(o)}`, apply: (t) => openSettingsSection(t, section, o), opensSettings: true } },
    () => { const place = r.pick(places.filter((p) => p.kind === 'junoPage' || p.kind === 'juno')); return { name: `switch to ${JSON.stringify(place)}`, apply: (t) => showInActiveTab(t, place) } },
    () => { const id = anyId(), place = r.pick([galleryPlace('pic-1'), galleryPlace('pic-2')]); return { name: `step the gallery in ${id}`, apply: (t) => replaceInTab(t, id, place) } },
    () => ({ name: 'acknowledge the pending thread', apply: (t) => acknowledgeTopic(t, PENDING, 't:C1:9.000001') }),
    () => { const s = r.pick([1, -1] as const); return { name: `history ${s}`, apply: (t) => stepHistory(t, s) } },
    () => { const i = r.int(6) - 1; return { name: `history entry ${i}`, apply: (t) => goToEntry(t, i) } },
    () => { const id = anyId(); return { name: `close ${id}`, apply: (t) => closeTab(t, id) } },
    () => { const id = anyId(); return { name: `close ${id}`, apply: (t) => closeTab(t, id) } },
    () => { const id = anyId(); return { name: `close others than ${id}`, apply: (t) => closeOtherTabs(t, id) } },
    () => { const id = anyId(); return { name: `close right of ${id}`, apply: (t) => closeTabsToRight(t, id) } },
    () => ({ name: 'close all', apply: closeAllTabs }),
    () => { const place = r.pick(places); return { name: `open 8 new tabs on ${JSON.stringify(place)}`, apply: (t) => Array.from({ length: 8 }).reduce<Tabs>((acc) => openPlace(acc, place, { newTab: true }), t) } },
    () => ({ name: 'reopen', apply: (t) => reopenClosedTab(t) }),
    () => { const id = tabs.closed.length === 0 ? 'tab-404' : r.pick(tabs.closed).tab.id; return { name: `reopen ${id}`, apply: (t) => reopenClosedTab(t, id) } },
    () => { const id = anyId(), pinned = r.next() < 0.6; return { name: `pin ${id} ${pinned}`, apply: (t) => setPinned(t, id, pinned) } },
    () => { const id = anyId(), to = r.int(ids.length + 4) - 2; return { name: `move ${id} to ${to}`, apply: (t) => moveTab(t, id, to) } },
    () => { const id = anyId(); return { name: `activate ${id}`, apply: (t) => activateTab(t, id) } },
    () => { const s = r.pick([1, -1] as const); return { name: `cycle ${s}`, apply: (t) => cycleTab(t, s) } },
    () => { const id = anyId(), open = r.next() < 0.5; return { name: `Juno panel ${id} ${open}`, apply: (t) => setJunoPanel(t, id, open) } },
    () => { const id = anyId(); return { name: `draft-free expiry, keeping ${id}`, apply: (t) => expireTabs(t, now, 3_600_000, (tab) => tab.id === id) } },
  ]
  return r.pick(choices)()
}

/** What `updateTabs` does around every rule: never no tab, and the tab left and the one shown are viewed now. */
function update(tabs: Tabs, change: (tabs: Tabs) => Tabs, now: number): Tabs {
  const changed = change(tabs)
  const ensured = changed === tabs ? tabs : ensureTab(changed, homePlace)
  return ensured.active === tabs.active ? ensured : stampViewed(ensured, [ensured.active, tabs.active], now)
}

const everyTab = (tabs: Tabs): ReadonlyArray<Tab> => [...tabs.tabs, ...tabs.closed.map((entry) => entry.tab)]
const roundTrip = (tabs: Tabs) => parseTabs(JSON.parse(JSON.stringify(savedTabs(tabs))))
const saved = (tab: Tab) => ({ id: tab.id, pinned: tab.pinned, place: currentPlace(tab), junoPanel: tab.junoPanel === true, lastViewedAt: tab.lastViewedAt })

function checkInvariants(tabs: Tabs, seen: Set<string>, before: Tabs) {
  const ids = tabs.tabs.map((tab) => tab.id)
  const all = everyTab(tabs).map((tab) => tab.id)
  const previous = new Set(everyTab(before).map((tab) => tab.id))
  expect(new Set(all).size, `ids are unique`).toBe(all.length)
  for (const id of all) {
    // An id is either one the tabs held a step ago, or one never used before.
    expect(previous.has(id) || !seen.has(id), `${id} is not reused`).toBe(true)
    seen.add(id)
  }
  const firstUnpinned = tabs.tabs.findIndex((tab) => !tab.pinned)
  expect(firstUnpinned < 0 || tabs.tabs.slice(firstUnpinned).every((tab) => !tab.pinned), `pinned tabs come first`).toBe(true)
  expect(ids.length, `there is always a tab`).toBeGreaterThan(0)
  expect(ids, `the active tab is open`).toContain(tabs.active!)
  expect(new Set(tabs.recent).size, `recent has no repeats`).toBe(tabs.recent.length)
  for (const id of tabs.recent) expect(ids, `recent tabs are open`).toContain(id)
  for (const tab of everyTab(tabs)) {
    expect(tab.history.entries.length, `history is kept to ${HISTORY_LIMIT}`).toBeLessThanOrEqual(HISTORY_LIMIT)
    expect(tab.history.index >= 0 && tab.history.index < tab.history.entries.length, `history points at an entry`).toBe(true)
  }
  expect(tabs.closed.length, `the reopen stack is kept to ${CLOSED_LIMIT}`).toBeLessThanOrEqual(CLOSED_LIMIT)
  const mounted = mountedTabs(tabs)
  expect(mounted.size, `at most ${MOUNTED_TABS} tabs stay mounted`).toBeLessThanOrEqual(MOUNTED_TABS)
  expect(mounted.has(tabs.active!), `the active tab is mounted`).toBe(true)

  // A restart reads back what each tab shows, its pin, its Juno panel, when it was viewed, and the active tab.
  // The developer log is not saved, and a restart keeps one Settings tab, the first.
  const firstSettings = tabs.tabs.find((tab) => currentPlace(tab).kind === 'settings')
  const kept = tabs.tabs.filter((tab) => currentPlace(tab).kind !== 'devLog' && (currentPlace(tab).kind !== 'settings' || tab === firstSettings))
  const restored = roundTrip(tabs)
  expect(restored.tabs.map(saved), `a restart keeps the tabs`).toEqual(kept.map(saved))
  expect(restored.tabs.every((tab) => tab.history.entries.length === 1), `a restart keeps no history`).toBe(true)
  expect(restored.active, `a restart keeps the active tab`).toBe(kept.some((tab) => tab.id === tabs.active) ? tabs.active : kept[0]?.id)

  // Closing a tab and reopening it puts it back as it was, with its history, active.
  const id = tabs.tabs[Math.floor(tabs.tabs.length / 2)]!.id
  const reopened = reopenClosedTab(closeTab(tabs, id))
  expect(reopened.tabs, `⌘W then ⌘⇧T restores ${id}`).toEqual(tabs.tabs)
  expect(reopened.active, `⌘⇧T makes ${id} active`).toBe(id)
}

describe('the tab model', () => {
  it.each(Array.from({ length: 300 }, (_, i) => i + 1))('keeps its invariants over a random sequence (seed %i)', (seed) => {
    const r = random(seed)
    const log: string[] = []
    const seen = new Set<string>()
    let now = 1_000_000_000_000
    let tabs = ensureTab(noTabs, homePlace)
    for (let i = 0; i < 80; i++) {
      now += r.int(2 * 3_600_000)
      const next = step(r, tabs, now)
      log.push(next.name)
      const before = tabs
      tabs = update(tabs, next.apply, now)
      try {
        checkInvariants(tabs, seen, before)
        if (next.opensSettings) {
          // Settings has one tab: opening it shows the tab that has it. (Back, Forward and ⌘⇧T can still
          // bring a second Settings tab back; a restart keeps the first.)
          const settingsTabs = (t: Tabs) => t.tabs.filter((tab) => currentPlace(tab).kind === 'settings').length
          expect(settingsTabs(tabs), 'opening Settings adds no second Settings tab').toBeLessThanOrEqual(Math.max(1, settingsTabs(before)))
          expect(settingsTabs(tabs), 'opening Settings shows it').toBeGreaterThan(0)
        }
      } catch (error) {
        // The steps replay the failure: the same seed gives the same sequence.
        if (error instanceof Error) error.message += `\nseed ${seed}, steps:\n  ${log.join('\n  ')}`
        throw error
      }
    }
  })
})

/** Tabs a, b, c with b active. */
const open = (tabs: Tabs, topicId: string, options?: OpenOptions) => openPlace(tabs, topicPlace(topicId), options)
const three = open(open(open(open(noTabs, 'a'), 'b', { newTab: true }), 'c', { newTab: true }), 'b')
const shows = (tab: Tab) => {
  const place = currentPlace(tab)
  return tabTopic(tab) ?? (place.kind === 'settings' ? `settings:${place.section}` : place.kind)
}
const shown = (tabs: Tabs) => tabs.tabs.map(shows)
const activeShows = (tabs: Tabs) => shows(tabs.tabs.find((tab) => tab.id === tabs.active)!)
const idOf = (tabs: Tabs, topicId: string) => tabs.tabs.find((tab) => tabTopic(tab) === topicId)!.id

describe('where a tab opens', () => {
  it('a plain open shows in the current tab, with Back to what it showed', () => {
    const tabs = open(three, 'd')
    expect(shown(tabs)).toEqual(['a', 'd', 'c'])
    expect(historyTarget(tabs, -1)).toEqual(topicPlace('b'))
  })

  it('a new tab goes right after the current one and becomes active', () => {
    const tabs = open(three, 'd', { newTab: true })
    expect(shown(tabs)).toEqual(['a', 'b', 'd', 'c'])
    expect(activeShows(tabs)).toBe('d')
  })

  it('a plain open of a topic another tab shows focuses that tab, the one shown last of two', () => {
    expect(activeShows(open(three, 'c'))).toBe('c')
    const twice = open(three, 'a', { newTab: true })
    expect(shown(twice)).toEqual(['a', 'b', 'a', 'c'])
    expect(open(open(twice, 'c'), 'a').active).toBe(twice.active)
  })

  it('a new tab with Home keeps Home in Back when a topic opens in it', () => {
    const tabs = open(openPlace(three, homePlace, { newTab: true }), 'd')
    expect(shown(tabs)).toEqual(['a', 'b', 'd', 'c'])
    expect(historyTarget(tabs, -1)).toEqual(homePlace)
  })

  it('a background tab goes after the current one, which stays active and first in recent', () => {
    const tabs = open(three, 'c', { newTab: true, background: true })
    expect(shown(tabs)).toEqual(['a', 'b', 'c', 'c'])
    expect(tabs.active).toBe(three.active)
    expect(tabs.recent).toEqual(three.recent)
  })

  it('a tab opened from another tab goes right after that one', () => {
    expect(shown(open(three, 'd', { newTab: true, background: true, after: idOf(three, 'a') }))).toEqual(['a', 'd', 'b', 'c'])
  })

  it('a new tab opened from a pinned tab goes after the pinned ones', () => {
    const pinned = activateTab(setPinned(three, idOf(three, 'a'), true), idOf(three, 'a'))
    expect(shown(open(pinned, 'd', { newTab: true }))).toEqual(['a', 'd', 'b', 'c'])
  })

  it('Settings has one tab: another section shows in it, with nothing added to Back', () => {
    const general = openSettingsSection(three, 'general', { newTab: true })
    const juno = openSettingsSection(activateTab(general, idOf(general, 'a')), 'juno', { newTab: true })
    expect(shown(juno)).toEqual(['a', 'b', 'settings:juno', 'c'])
    expect(activeShows(juno)).toBe('settings:juno')
    expect(historyTarget(juno, -1)).toBeUndefined()
  })

  it('the Juno switcher moves within its own tab, even to a page another tab shows', () => {
    const elsewhere = openPlace(openPlace(three, junoPlace, { newTab: true }), junoPagePlace('activity'), { newTab: true })
    const switched = showInActiveTab(openPlace(elsewhere, junoPlace), junoPagePlace('activity'))
    expect(shown(switched)).toEqual(['a', 'b', 'junoPage', 'junoPage', 'c'])
    expect(activeShows(stepHistory(switched, -1))).toBe('juno')
  })
})

describe('closing and moving', () => {
  it('closing the active tab focuses its right neighbour, or the left one at the end', () => {
    expect(activeShows(closeTab(three, idOf(three, 'b')))).toBe('c')
    const last = open(three, 'c')
    expect(activeShows(closeTab(last, idOf(last, 'c')))).toBe('b')
  })

  it('close others, to the right and all leave pinned tabs open, and ⌘⇧T brings them back left to right', () => {
    const tabs = setPinned(open(three, 'd', { newTab: true }), idOf(three, 'c'), true)
    expect(shown(tabs)).toEqual(['c', 'a', 'b', 'd'])
    expect(shown(closeOtherTabs(tabs, idOf(tabs, 'b')))).toEqual(['c', 'b'])
    expect(shown(closeTabsToRight(tabs, idOf(tabs, 'a')))).toEqual(['c', 'a'])
    const none = closeAllTabs(tabs)
    expect(shown(none)).toEqual(['c'])
    expect(shown(reopenClosedTab(reopenClosedTab(reopenClosedTab(none))))).toEqual(['c', 'a', 'b', 'd'])
  })

  it('Undo on "Draft closed" reopens that tab, wherever it is on the stack', () => {
    const two = closeTab(closeTab(three, idOf(three, 'c')), idOf(three, 'a'))
    const back = reopenClosedTab(two, idOf(three, 'c'))
    expect(shown(back)).toEqual(['b', 'c'])
    expect(activeShows(back)).toBe('c')
  })

  it('a move is clamped to the strip and to the tab’s pinned or unpinned group', () => {
    expect(shown(moveTab(three, idOf(three, 'a'), 9))).toEqual(['b', 'c', 'a'])
    expect(shown(moveTab(three, idOf(three, 'c'), -4))).toEqual(['c', 'a', 'b'])
    const pinned = setPinned(setPinned(three, idOf(three, 'a'), true), idOf(three, 'b'), true)
    expect(moveTab(pinned, idOf(pinned, 'c'), 0)).toBe(pinned)
    expect(shown(moveTab(pinned, idOf(pinned, 'a'), 2))).toEqual(['b', 'a', 'c'])
  })

  it('keeps the last 50 places a tab showed and the last 20 closed tabs', () => {
    let tabs = open(noTabs, 't0')
    for (let i = 1; i < 60; i++) tabs = open(tabs, `t${i}`)
    expect(tabs.tabs[0]!.history.entries).toHaveLength(HISTORY_LIMIT)
    expect(tabs.tabs[0]!.history.entries[0]).toEqual(topicPlace('t10'))
    for (let i = 0; i < 25; i++) tabs = open(tabs, `n${i}`, { newTab: true })
    expect(closeAllTabs(tabs).closed).toHaveLength(CLOSED_LIMIT)
  })

  it('never gives a new tab the id of a tab that fell off the reopen stack (regression)', () => {
    // A tab's Home draft and Juno panel view are kept by its id, so a reused id would show the old tab's draft.
    let tabs = noTabs
    for (let i = 1; i <= CLOSED_LIMIT + 2; i++) tabs = open(tabs, `t${i}`, { newTab: true })
    const newest = tabs.tabs.at(-1)!.id
    tabs = closeTab(tabs, newest)
    for (const tab of tabs.tabs.slice(1)) tabs = closeTab(tabs, tab.id)
    expect(tabs.closed.map((entry) => entry.tab.id)).not.toContain(newest)
    expect(open(tabs, 'later', { newTab: true }).active).not.toBe(newest)
  })

  it('a tab saved before tabs kept a time gets the full time from now', () => {
    const unstamped = openPlace(open(noTabs, 'a', { newTab: true }), homePlace, { newTab: true })
    const swept = expireTabs(unstamped, 5_000, 1_000)
    expect(shown(swept)).toEqual(['a', 'home'])
    expect(swept.tabs.every((tab) => tab.lastViewedAt === 5_000)).toBe(true)
    expect(shown(expireTabs(swept, 6_001, 1_000))).toEqual(['home'])
  })

  it('⌘1 to ⌘8 count from the left, and ⌘9 is the last tab', () => {
    const tabs = open(three, 'd', { newTab: true })
    expect(tabTopic(tabByNumber(tabs, 3)!)).toBe('d')
    expect(tabByNumber(tabs, 8)).toBeUndefined()
    expect(tabTopic(tabByNumber(tabs, 9)!)).toBe('c')
  })

  it('a thread started by a send keeps its view when Slack acknowledges it, open or closed', () => {
    const before = open(open(noTabs, 'm:C1'), PENDING)
    const after = acknowledgeTopic(before, PENDING, 't:C1:100.000001')
    expect(after.tabs[0]!.history.entries).toEqual([topicPlace('m:C1'), { kind: 'topic', topicId: 't:C1:100.000001', viewId: PENDING }])
    const reopened = reopenClosedTab(acknowledgeTopic(closeTab(before, before.active!), PENDING, 't:C1:100.000001'))
    expect(reopened.tabs[0]!.history).toEqual(after.tabs[0]!.history)
  })
})

describe('tabs saved by older builds', () => {
  const tab = (id: string, place: unknown, extra: object = {}) => ({ id, pinned: false, place, ...extra })
  it.each<[string, unknown, ReadonlyArray<string>, string | undefined]>([
    ['before history, a tab was its topic', { tabs: [{ id: 'a' }, { id: 'b' }], active: 'b', recent: ['b', 'a'] }, ['a', 'b'], 'b'],
    ['the old stealth flag', { tabs: [{ id: 'a', stealth: false }, { id: 'b', stealth: true }], active: 'b', recent: [] }, ['a', 'b'], 'b'],
    ['the stealth flag beside a place', { tabs: [tab('tab-1', { kind: 'topic', topicId: 'a' }, { stealth: true })], active: 'tab-1', recent: [] }, ['a'], 'a'],
    ['New chat before Home took its place', { tabs: [tab('tab-1', { kind: 'newChat' }, { newChat: { draft: 'hi', mentions: [] } })], active: 'tab-1', recent: [] }, ['home'], 'home'],
    ['Preferences', { tabs: [tab('tab-1', { kind: 'preferences' })], active: 'tab-1', recent: [] }, ['settings:general'], 'settings:general'],
    ['Settings › Juno as a Juno page', { tabs: [tab('tab-1', { kind: 'junoPage', page: 'settings' })], active: 'tab-1', recent: [] }, ['settings:juno'], 'settings:juno'],
    [
      'Connections, Preferences and Notifications as one Settings tab, at the first one’s section',
      {
        tabs: [
          tab('tab-1', { kind: 'topic', topicId: 'a' }),
          tab('tab-2', { kind: 'junoPage', page: 'connections' }),
          tab('tab-3', { kind: 'preferences' }),
          tab('tab-4', { kind: 'notifications' }),
          tab('tab-5', { kind: 'junoPage', page: 'activity' }),
        ],
        active: 'tab-4',
        recent: ['tab-4', 'tab-2'],
      },
      ['a', 'settings:connections', 'junoPage'],
      // The active tab was dropped, so the first tab is active.
      'a',
    ],
    ['an active tab that is gone', { tabs: [{ id: 'a' }], active: 'gone', recent: ['gone'] }, ['a'], 'a'],
    ['two tabs with one id', { tabs: [{ id: 'a' }, { id: 'a' }], active: 'a', recent: [] }, [], undefined],
    ['nothing readable', { tabs: 'nope' }, [], undefined],
  ])('%s', (_, value, expected, active) => {
    const restored = parseTabs(value)
    expect(shown(restored)).toEqual([...expected])
    expect(restored.tabs.every((t) => !('stealth' in t))).toBe(true)
    expect(restored.active === undefined ? undefined : activeShows(restored)).toBe(active)
    expect(restored.recent.every((id) => restored.tabs.some((t) => t.id === id))).toBe(true)
  })
})

describe('the "N new" divider', () => {
  it('goes before the first message after the read pointer, never before the user’s own, sent or still sending', () => {
    const order = ['1.000001', '1.000002', 'pending:c1', '1.000003']
    const mine = (ts: string) => ts === '1.000002' || ts === 'pending:c1'
    expect(dividerIndex(order, '1.000001')).toBe(1)
    expect(dividerIndex(order, '1.000001', mine)).toBe(3)
    expect(dividerIndex(order.slice(0, 3), '1.000001', mine)).toBe(-1)
    expect(dividerIndex(['1.000001', '1.000002'], '1.000002')).toBe(-1)
    // A topic never read opens at the bottom with no divider.
    expect(dividerIndex(order, undefined)).toBe(-1)
  })
})
