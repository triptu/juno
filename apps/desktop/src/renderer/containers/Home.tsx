import { useId, useLayoutEffect, useRef } from 'react'
import { viewsSortChannel } from '@juno/contract'
import { fillHome, freezeHome, homeGreeting, homeShownAtom, homeViewAtom, markFollowUpDone, markHomeItemUsed, registry, resolveAllTopics, runAction, showHome } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { Home, type ActivateEvent } from '@juno/views'
import { HomeComposer } from './HomeComposer'
import { openTopic } from './navigation'
import { showChannelMenu } from './placeMenus'

function openItem(topicId: string, event: ActivateEvent): void {
  openTopic(topicId, { newTab: event.metaKey })
}

/** Takes Home at each stage (`showHome`), and while the first sync runs adds the items each new value brings (`fillHome`). */
function useShowHome(key: string, stage: 0 | 1 | 2, value: unknown): void {
  const appeared = useRef(false)
  useLayoutEffect(() => {
    // The entrance plays once, when Home first has something to show; the items arriving later just appear.
    showHome(registry, key, { windowHeight: window.innerHeight, enter: stage > 0 && !appeared.current })
    if (stage > 0) appeared.current = true
  }, [key, stage])
  useLayoutEffect(() => {
    if (stage === 1) fillHome(registry, key)
  }, [key, stage, value])
}

/**
 * Home (SPEC section 12): the Home tab, with its composer (`HomeComposer`)
 * at the bottom. It shows the items `home.view` had when Home appeared
 * (`showHome`, before the first paint, again each time Home comes back
 * from a hidden tab, and once more when the first value arrives); later
 * values change only a row's title line (`freezeHome`). Until the first
 * sync is done it shows the scene and the greeting with "Syncing with
 * Slack.", and rows fill reserved slots as they land (`fillHome`). Until there is any value (a few milliseconds) the
 * page is blank, never a spinner, so it paints whole.
 */
export function HomePage({ tabId }: { readonly tabId: string }) {
  const key = useId()
  const result = useAtomValue(homeViewAtom)
  const value = result._tag === 'Success' ? result.value : undefined
  const latest = value?.ready === true ? value : undefined
  const shown = useAtomValue(homeShownAtom(key))

  // Nothing yet, the first sync running, or ready: Home is taken again at each step.
  useShowHome(key, latest !== undefined ? 2 : value !== undefined ? 1 : 0, value)

  if (shown === undefined) return <div data-home="" data-home-waiting="" />
  const view = value === undefined ? shown.view : freezeHome(shown.view, value)

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
      reservedItems={shown.reservedItems}
      scene={shown.scene}
      // While syncing there are no rows to hold still, so the greeting takes the name once the boot has stored it.
      title={shown.loading && value !== undefined ? homeGreeting({ now: new Date(shown.now), firstName: value.firstName, caughtUp: false }).title : shown.title}
      line={shown.line}
      items={view.items}
      done={shown.used}
      now={shown.now}
      enter={shown.enter}
      onOpen={openItem}
      onMarkDone={markDone}
      onResolveAll={resolveAll}
      onSort={sort}
      onItemMenu={itemMenu}
      composer={<HomeComposer tabId={tabId} />}
    />
  )
}
