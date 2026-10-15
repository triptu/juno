import { useId, useLayoutEffect, useRef } from 'react'
import { freezeHome, homeShownAtom, homeViewAtom, markFollowUpDone, markHomeItemUsed, registry, resolveAllTopics, showHome } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { Home, type ActivateEvent } from '@juno/views'
import { openAllTopics, openTopic } from './navigation'

function openItem(topicId: string, event: ActivateEvent): void {
  openTopic(topicId, { newTab: event.metaKey })
}

/** "Browse all topics" in the caught-up state: the All topics tab. */
function browseAll(event: ActivateEvent): void {
  openAllTopics({ newTab: event.metaKey })
}

/**
 * Ask Juno opens the Juno chat (SPEC section 12). The renderer has no Juno
 * tab yet; the Juno Agent wiring adds it and this opens it, as ⌘J will.
 */
function askJuno(): void {}

/**
 * Home (SPEC section 12): the Home tab, and what the workspace shows with
 * no tab open. It shows the items `home.view` had when Home appeared
 * (`showHome`, before the first paint, again each time Home comes back
 * from a hidden tab, and once more when the first value arrives); later
 * values change only a row's title line (`freezeHome`). Until there is a
 * value the page is blank, never a spinner, so it paints whole.
 */
export function HomePage() {
  const key = useId()
  const result = useAtomValue(homeViewAtom)
  const latest = result._tag === 'Success' && result.value.ready ? result.value : undefined
  const shown = useAtomValue(homeShownAtom(key))
  const appeared = useRef(false)

  const ready = latest !== undefined
  useLayoutEffect(() => {
    showHome(registry, key, { windowHeight: window.innerHeight, enter: ready && !appeared.current })
    if (ready) appeared.current = true
  }, [key, ready])

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

  return (
    <Home
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
      onAsk={askJuno}
      onBrowseAll={browseAll}
    />
  )
}
