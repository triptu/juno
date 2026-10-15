import { useId, useLayoutEffect, useRef } from 'react'
import { viewsSortChannel } from '@juno/contract'
import { freezeHome, homeShownAtom, homeViewAtom, markFollowUpDone, markHomeItemUsed, registry, resolveAllTopics, runAction, showHome } from '@juno/state'
import { junoNavAtom } from '@juno/state/agent'
import { useAtomValue } from '@juno/state/react'
import { Home, type ActivateEvent } from '@juno/views'
import { openJunoTab } from './juno/actions'
import { openAllTopics, openTopic } from './navigation'
import { showChannelMenu } from './placeMenus'

function openItem(topicId: string, event: ActivateEvent): void {
  openTopic(topicId, { newTab: event.metaKey })
}

/** "Browse all topics" in the caught-up state: the All topics tab. */
function browseAll(event: ActivateEvent): void {
  openAllTopics({ newTab: event.metaKey })
}

/** Ask Juno opens the Juno chat with its composer focused (SPEC section 12), as ⌘J does outside a topic. */
function askJuno(): void {
  openJunoTab()
}

/**
 * Home (SPEC section 12): the Home tab, and what the workspace shows with
 * no tab open. It shows the items `home.view` had when Home appeared
 * (`showHome`, before the first paint, again each time Home comes back
 * from a hidden tab, and once more when the first value arrives); later
 * values change only a row's title line (`freezeHome`). Until the first
 * sync is done it shows the scene and the greeting with "Syncing with
 * Slack." and no items. Until there is any value (a few milliseconds) the
 * page is blank, never a spinner, so it paints whole.
 */
export function HomePage() {
  const key = useId()
  const result = useAtomValue(homeViewAtom)
  const value = result._tag === 'Success' ? result.value : undefined
  const latest = value?.ready === true ? value : undefined
  const shown = useAtomValue(homeShownAtom(key))
  const appeared = useRef(false)
  // The newest running job's state line replaces the field's placeholder (SPEC 13.4).
  const jobLine = useAtomValue(junoNavAtom, (nav) => nav.jobLine)

  // Nothing yet, the first sync running, or ready: Home is taken again at each step.
  const stage = latest !== undefined ? 2 : value !== undefined ? 1 : 0
  useLayoutEffect(() => {
    // The entrance plays once, when Home first has something to show; the items arriving after the sync just appear.
    showHome(registry, key, { windowHeight: window.innerHeight, enter: stage > 0 && !appeared.current })
    if (stage > 0) appeared.current = true
  }, [key, stage])

  if (shown === undefined) return <div data-home="" data-home-waiting="" />
  const view = latest === undefined ? shown.view : freezeHome(shown.view, latest)

  const itemOf = (itemId: string) => view.items.find((candidate) => candidate.id === itemId)
  const markDone = (itemId: string) => {
    const item = itemOf(itemId)
    if (item === undefined) return
    markHomeItemUsed(registry, key, itemId)
    void markFollowUpDone(registry, item)
  }
  const resolveAll = (itemId: string) => {
    const item = itemOf(itemId)
    if (item === undefined) return
    markHomeItemUsed(registry, key, itemId)
    void resolveAllTopics(
      registry,
      item.topics.map((topic) => topic.id),
    )
  }

  // Automated's question: Move or Keep in All, remembered, with Undo; right-click has the conversation's menu, with Ignore.
  const sort = (itemId: string, to: 'automated' | 'kept') => {
    const channel = itemOf(itemId)?.channel
    if (channel === undefined) return
    markHomeItemUsed(registry, key, itemId)
    void runAction(registry, viewsSortChannel, { channel: channel.id, to }, { text: to === 'automated' ? `Moved ${channel.label} to Automated` : `Keeping ${channel.label} in All` })
  }
  const itemMenu = (itemId: string) => {
    const item = itemOf(itemId)
    if (item?.channel === undefined) return
    const main = item.topics[0]?.id
    void showChannelMenu({ ...item.channel, ...(main === undefined ? {} : { mainId: main }) })
  }

  return (
    <Home
      loading={shown.loading}
      scene={shown.scene}
      title={shown.title}
      line={shown.line}
      items={view.items}
      done={shown.used}
      now={shown.now}
      caughtUp={shown.caughtUp}
      enter={shown.enter}
      onOpen={openItem}
      onMarkDone={markDone}
      onResolveAll={resolveAll}
      onSort={sort}
      onItemMenu={itemMenu}
      onAsk={askJuno}
      {...(jobLine === undefined ? {} : { askLine: jobLine })}
      onBrowseAll={browseAll}
    />
  )
}
