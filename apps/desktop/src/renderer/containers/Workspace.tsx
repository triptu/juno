import { Activity, useEffect, useLayoutEffect } from 'react'
import type { MenuCommand, TopicDetail } from '@juno/contract'
import { mountedTabs, onMenuCommand, tabsAtom, tabStripAtom, type TabSummary } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { TopicArt, Workspace as WorkspaceView, type ActivateEvent, type WorkspaceTab, type WorkspaceTabIcon } from '@juno/views'
import { closeTopicTab, runMenuCommand, showTabMenu, switchToTab } from './navigation'
import { hasArt, TopicTab } from './TopicView'

const kindIcons: Record<TopicDetail['channel']['kind'], WorkspaceTabIcon> = {
  public: 'hash',
  private: 'lock',
  im: 'user',
  mpim: 'users',
}

const tabs = new WeakMap<TabSummary, WorkspaceTab>()

/** A tab as the strip draws it: the topic title, or the channel name for Main, with the topic's art in the icon slot. */
function stripTab(summary: TabSummary): WorkspaceTab {
  const held = tabs.get(summary)
  if (held !== undefined) return held
  const { detail } = summary
  const tab: WorkspaceTab = {
    id: summary.id,
    title: detail == null ? '' : detail.kind === 'main' ? detail.channel.name : detail.title,
    icon: detail == null ? 'hash' : kindIcons[detail.channel.kind],
    stealth: summary.stealth,
    ...(detail != null && hasArt(detail) ? { art: <TopicArt topicId={detail.id} recipe={detail.art} size={16} /> } : {}),
  }
  tabs.set(summary, tab)
  return tab
}

function selectTab(id: string, _event: ActivateEvent): void {
  switchToTab(id)
}

function tabMenu(id: string): void {
  void showTabMenu(id)
}

const STRIP = 'section[aria-label="Workspace"] [role="tablist"]'
const TAB = '[role="tab"]'

/**
 * Where keyboard focus goes after a close: the position in the strip of
 * the tab that was closed. Undefined when focus was somewhere that the
 * close does not take away (the sidebar, say).
 */
let refocusAt: number | undefined

/**
 * Notes where focus was before a tab closes. Focus on the tab or its close
 * button, or in the page that goes away with it (⌘W), would otherwise fall
 * to the body and the next Tab would start from the top of the window.
 */
function rememberFocus(): void {
  const tabs = [...(document.querySelector(STRIP)?.querySelectorAll<HTMLElement>(TAB) ?? [])]
  const focused = document.activeElement
  const onTab = tabs.findIndex((tab) => tab.contains(focused))
  const inPage = focused === null || focused === document.body || focused.closest('section[aria-label="Workspace"] main') !== null
  refocusAt = onTab >= 0 ? onTab : inPage ? tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true') : undefined
  if (refocusAt !== undefined && refocusAt < 0) refocusAt = undefined
}

/** Focuses the tab that took the closed one's place, the last tab, or the New message button when none is left. */
function restoreFocus(): void {
  if (refocusAt === undefined) return
  const at = refocusAt
  refocusAt = undefined
  const strip = document.querySelector(STRIP)
  const tabs = strip?.querySelectorAll<HTMLElement>(TAB) ?? []
  const target = tabs[Math.min(at, tabs.length - 1)] ?? strip?.querySelector<HTMLElement>('button[aria-label="New message"]')
  target?.focus()
}

function closeTab(id: string): void {
  rememberFocus()
  closeTopicTab(id)
}

function menuCommand(command: MenuCommand): void {
  if (command === 'tab.close') rememberFocus()
  runMenuCommand(command)
}

/**
 * The tab strip and the open topics. The active tab and the 4 most
 * recently active stay mounted in `<Activity>` (performance 4.3), so a
 * switch is a display toggle; older tabs unmount and come back at their
 * scroll snapshot. With no tab open the page shows the empty workspace.
 */
export function Workspace() {
  const state = useAtomValue(tabsAtom)
  const strip = useAtomValue(tabStripAtom)
  const mounted = mountedTabs(state)

  useEffect(() => onMenuCommand(menuCommand), [])
  // The strip after a close is in the DOM now; move focus before paint.
  useLayoutEffect(restoreFocus, [state])

  return (
    <WorkspaceView tabs={strip.map(stripTab)} {...(state.active === undefined ? {} : { activeId: state.active })} onSelectTab={selectTab} onCloseTab={closeTab} onTabContextMenu={tabMenu}>
      {state.active === undefined
        ? undefined
        : state.tabs
            .filter((tab) => mounted.has(tab.id))
            .map((tab) => (
              <Activity key={tab.id} mode={tab.id === state.active ? 'visible' : 'hidden'}>
                <TopicTab id={tab.id} stealth={tab.stealth} />
              </Activity>
            ))}
    </WorkspaceView>
  )
}
