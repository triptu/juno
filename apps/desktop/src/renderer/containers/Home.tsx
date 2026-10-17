import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { viewsSortChannel, type HomeItem, type UndoCommand } from '@juno/contract'
import { actOnSettled, fillHome, freezeHome, homeGreeting, homeShownAtom, homeViewAtom, markFollowUpDone, markHomeItemUsed, registry, resolveAllTopics, runAction, showHome, undoOne, undoStackAtom } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { Home, SettledReview, SheetLayer, type ActivateEvent, type SettledStatus } from '@juno/views'
import { HomeComposer } from './HomeComposer'
import { openSettings, openTopic } from './navigation'
import { showChannelMenu } from './placeMenus'

const noop = () => {}

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
 * Slack.", and rows fill reserved slots as they land (`fillHome`).
 */
export function HomePage({ tabId }: { readonly tabId: string }) {
  const key = useId()
  // Tidy up's review, open over Home (`SettledReview`), with the item it shows.
  const [reviewing, setReviewing] = useState<HomeItem | undefined>(undefined)
  const result = useAtomValue(homeViewAtom)
  const value = result._tag === 'Success' ? result.value : undefined
  const latest = value?.ready === true ? value : undefined
  const shown = useAtomValue(homeShownAtom(key))

  // Nothing yet, the first sync running, or ready: Home is taken again at each step.
  useShowHome(key, latest !== undefined ? 2 : value !== undefined ? 1 : 0, value)

  // Until Home has a value (a few milliseconds) the column is blank, never a spinner, and the composer is already in place.
  if (shown === undefined) return <Home waiting scene="morning" title="" items={[]} now={0} onOpen={openItem} onMarkDone={noop} onResolveAll={noop} onReview={noop} onSort={noop} onItemMenu={noop} composer={<HomeComposer tabId={tabId} />} />
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
  const review = (itemId: string) => {
    const item = itemOf(itemId)
    if (item !== undefined) setReviewing(item)
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
    <>
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
      onReview={review}
      onSort={sort}
      onItemMenu={itemMenu}
      composer={<HomeComposer tabId={tabId} />}
    />
    {reviewing === undefined ? null : (
      <Review
        item={reviewing}
        now={shown.now}
        onClose={(allDone) => {
          if (allDone) markHomeItemUsed(registry, key, reviewing.id)
          setReviewing(undefined)
        }}
      />
    )}
    </>
  )
}

/**
 * Tidy up's review in a sheet: Resolve and Keep open per row, each with
 * the usual toast, and Undo on the row itself, which puts back just that
 * topic. Opening a topic closes the sheet; ⌘ opens it in a new tab and
 * keeps the review. Closing it with nothing left open retires Home's row.
 */
function Review({ item, now, onClose }: { readonly item: HomeItem; readonly now: number; readonly onClose: (allDone: boolean) => void }) {
  const [statuses, setStatuses] = useState<ReadonlyMap<string, SettledStatus>>(new Map())
  // Per row: the undo on the stack that covers it, and the one that puts back just this topic.
  const undos = useRef(new Map<string, { readonly entry: UndoCommand; readonly own: UndoCommand }>())
  const stack = useAtomValue(undoStackAtom)
  const set = (entries: ReadonlyArray<readonly [string, SettledStatus]>) => setStatuses((before) => new Map([...before, ...entries]))
  // ⌘Z and the toast's Undo replay the newest undo: a row whose undo left the stack is open again.
  useEffect(() => {
    const undone = [...undos.current].filter(([, { entry }]) => !stack.includes(entry)).map(([id]) => id)
    for (const id of undone) undos.current.delete(id)
    if (undone.length > 0) set(undone.map((id) => [id, 'open'] as const))
  }, [stack])
  const open = item.topics.filter((topic) => (statuses.get(topic.id) ?? 'open') === 'open')
  const act = async (id: string, action: 'resolve' | 'keep') => {
    const topic = item.topics.find((candidate) => candidate.id === id)
    if (topic === undefined || (statuses.get(id) ?? 'open') !== 'open') return
    set([[id, action === 'resolve' ? 'resolved' : 'kept']])
    const undo = await actOnSettled(registry, topic, action)
    if (undo === undefined) return set([[id, 'open']])
    undos.current.set(id, { entry: undo, own: undo })
  }
  const undo = async (id: string) => {
    const kept = undos.current.get(id)
    undos.current.delete(id)
    set([[id, 'open']])
    if (kept !== undefined) await undoOne(registry, kept.own)
  }
  const resolveRest = async () => {
    const ids = open.map((topic) => topic.id)
    set(ids.map((id) => [id, 'resolved'] as const))
    const restores = await resolveAllTopics(registry, ids)
    const entry = registry.get(undoStackAtom).at(-1)
    for (const restore of restores) undos.current.set(restore.id, { entry: entry ?? restore, own: restore })
    const failed = ids.filter((id) => !restores.some((restore) => restore.id === id))
    if (failed.length > 0) set(failed.map((id) => [id, 'open'] as const))
  }
  const close = () => onClose(open.length === 0)
  return (
    <SheetLayer onClose={close}>
      <SettledReview
        topics={item.topics}
        statuses={statuses}
        now={now}
        autoFocus
        onOpen={(topicId, event) => {
          if (!event.metaKey) close()
          openTopic(topicId, { newTab: event.metaKey })
        }}
        onResolve={(id) => void act(id, 'resolve')}
        onKeep={(id) => void act(id, 'keep')}
        onUndo={(id) => void undo(id)}
        onResolveAll={() => void resolveRest()}
        onSettings={() => {
          close()
          openSettings('tidy-up')
        }}
        onClose={close}
      />
    </SheetLayer>
  )
}
