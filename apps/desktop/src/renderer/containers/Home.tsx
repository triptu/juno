import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { viewsSortChannel, type HomeItem } from '@juno/contract'
import { closeWelcome, fillHome, freezeHome, homeGreeting, homeShownAtom, homeViewAtom, markFollowUpDone, markHomeItemUsed, markMovesSeen, markMovesShown, peekKeyAtom, registry, resolveAllTopics, runAction, showHome, syncProgressAtom, welcomeAtom, type Welcome } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { Home, HomeSyncLine, WelcomeCard, type ActivateEvent } from '@juno/views'
import { HomeComposer } from './HomeComposer'
import { openTopic } from './navigation'
import { AutomatedMovesReview } from './AutomatedMovesReview'
import { TidyUpReview } from './TidyUpReview'
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
    showHome(registry, key, { windowHeight: window.innerHeight, enter: stage > 0 && !appeared.current, welcome: registry.get(welcomeAtom) !== undefined })
    if (stage > 0) appeared.current = true
  }, [key, stage])
  useLayoutEffect(() => {
    if (stage === 1) fillHome(registry, key)
  }, [key, stage, value])
}

/** What Home's row buttons do, for the items `items` (Home's `key`). */
function itemActions(key: string, items: ReadonlyArray<HomeItem>, setReviewing: (item: HomeItem) => void) {
  const itemOf = (itemId: string) => items.find((candidate) => candidate.id === itemId)
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
    if (item === undefined) return
    setReviewing(item)
    // Opening Automated's record is seeing its moves: they are not listed again, and Dismiss has nothing left to do.
    if (item.kind === 'automatedMoves') {
      markHomeItemUsed(registry, key, itemId)
      markMovesSeen(registry, item)
    }
  }
  // Dismiss on Automated's record: its moves are seen without opening it.
  const dismiss = (itemId: string) => {
    const item = itemOf(itemId)
    if (item === undefined) return
    markHomeItemUsed(registry, key, itemId)
    markMovesSeen(registry, item)
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
  return { markDone, resolveAll, review, dismiss, sort, itemMenu }
}

const closeCard = () => closeWelcome(registry)

/**
 * Tells the engine once per appearance that Home showed Automated's record,
 * so the card waits a day before it shows again. Its moves stay until the
 * record is opened or the card dismissed.
 */
function useMovesShown(items: ReadonlyArray<HomeItem> | undefined, appearedAt: number | undefined): void {
  const told = useRef<number | undefined>(undefined)
  const record = items?.find((item) => item.kind === 'automatedMoves')
  useEffect(() => {
    if (record === undefined || appearedAt === undefined || told.current === appearedAt) return
    told.current = appearedAt
    markMovesShown(registry)
  }, [record, appearedAt])
}

/**
 * The welcome card (SPEC 4) as this Home shows it. Once it has shown, its
 * room stays until Home appears again (`appearedAt` changes), empty after
 * Hide or Done, so the rows above it never move.
 */
function useWelcome(appearedAt: number | undefined) {
  const welcome = useAtomValue(welcomeAtom)
  const peekKey = useAtomValue(peekKeyAtom)
  // The card as this appearance last showed it, so its room stays after it goes.
  const [kept, setKept] = useState<{ readonly at: number | undefined; readonly last: Welcome | undefined }>({ at: appearedAt, last: welcome })
  const same = kept.at === appearedAt
  if (!same || (welcome !== undefined && welcome !== kept.last)) setKept({ at: appearedAt, last: welcome ?? (same ? kept.last : undefined) })
  const last = welcome ?? (same ? kept.last : undefined)
  if (last === undefined) return undefined
  return <WelcomeCard done={last.done} peekKey={peekKey} onClose={closeCard} hidden={welcome === undefined || !welcome.ready} />
}

/** The syncing line with the first sync's count. Its own component, so a new count redraws the line and not Home. */
function SyncLine({ line }: { readonly line: string }) {
  return <HomeSyncLine line={line} progress={useAtomValue(syncProgressAtom)} />
}

/**
 * Home (SPEC section 12): the Home tab, with its composer (`HomeComposer`)
 * at the bottom. It shows the items `home.view` had when Home appeared
 * (`showHome`, before the first paint, again each time Home comes back
 * from a hidden tab, and once more when the first value arrives); later
 * values change only a row's title line (`freezeHome`). Until the first
 * sync is done it shows the scene and the greeting with "Syncing with
 * Slack.", then the sync's count, and rows fill reserved slots as they land (`fillHome`).
 */
export function HomePage({ tabId }: { readonly tabId: string }) {
  const key = useId()
  // Tidy up's review or Automated's record, open over Home, with the item it shows.
  const [reviewing, setReviewing] = useState<HomeItem | undefined>(undefined)
  const result = useAtomValue(homeViewAtom)
  const value = result._tag === 'Success' ? result.value : undefined
  const latest = value?.ready === true ? value : undefined
  const shown = useAtomValue(homeShownAtom(key))
  const welcome = useWelcome(shown?.now)
  useMovesShown(shown?.view.items, shown?.now)

  // Nothing yet, the first sync running, or ready: Home is taken again at each step.
  useShowHome(key, latest !== undefined ? 2 : value !== undefined ? 1 : 0, value)

  // Until Home has a value (a few milliseconds) the column is blank, never a spinner, and the composer is already in place.
  if (shown === undefined) return <Home waiting scene="morning" title="" items={[]} now={0} onOpen={openItem} onMarkDone={noop} onResolveAll={noop} onReview={noop} onSort={noop} onItemMenu={noop} composer={<HomeComposer tabId={tabId} />} />
  const view = value === undefined ? shown.view : freezeHome(shown.view, value)

  const { markDone, resolveAll, review, dismiss, sort, itemMenu } = itemActions(key, view.items, setReviewing)

  return (
    <>
    <Home
      loading={shown.loading}
      reservedItems={shown.reservedItems}
      scene={shown.scene}
      // While syncing there are no rows to hold still, so the greeting takes the name once the boot has stored it.
      title={shown.loading && value !== undefined ? homeGreeting({ now: new Date(shown.now), firstName: value.firstName, caughtUp: false }).title : shown.title}
      line={shown.line === undefined ? undefined : <SyncLine line={shown.line} />}
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
      onDismiss={dismiss}
      composer={<HomeComposer tabId={tabId} />}
      welcome={welcome}
    />
    {reviewing?.kind === 'automatedMoves' ? (
      <AutomatedMovesReview item={reviewing} now={shown.now} onClose={() => setReviewing(undefined)} />
    ) : reviewing === undefined ? null : (
      <TidyUpReview
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
