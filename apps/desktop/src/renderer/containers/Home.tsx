import { Suspense, useEffect, useRef, useState } from 'react'
import { homeHuddleSeen, viewsSortChannel, type HomeItem } from '@juno/contract'
import { closeWelcome, forgetPicture, holdHome, homeAppears, homeHeading, homeItemLimit, homePicturesOnAtom, homeViewAtom, markFollowUpDone, markMovesSeen, markMovesShown, notePicture, nowAtom, peekKeyAtom, pictureUrl, preparePicture, registry, resolveAllTopics, runAction, runCommand, showToast, syncProgressAtom, takePicture, welcomeAtom, withAsks } from '@juno/state'
import { homeAsksAtom, junoPageActions } from '@juno/state/agent'
import { useAtomValue } from '@juno/state/react'
import { junoAskCopy } from '@juno/agent-contract'
import { Home, HomeSyncLine, WelcomeCard, type ActivateEvent } from '@juno/views'
import { chunk, usePreloaded } from './chunks'
import { gallery } from './galleryChunk'
import { HomeComposer } from './HomeComposer'
import { openGallery, openJuno, openTopic } from './navigation'
import { showChannelMenu } from './placeMenus'

const noop = () => {}
const NO_ITEMS: ReadonlyArray<HomeItem> = []

/** The review sheets open only from a card, so they load after Home, when idle or on the click. */
const reviewSheets = chunk(() => import('./HomeReview'))
const HomeReview = reviewSheets.component((module) => module.HomeReview)

function openItem(topicId: string, event: ActivateEvent): void {
  openTopic(topicId, { newTab: event.metaKey })
}

/** Home's picture, read from disk, and what opening it and a missing file do. */
function pictureProps(picture: NonNullable<ReturnType<typeof takePicture>>) {
  return {
    picture: { src: pictureUrl(picture.id, 'small'), title: picture.title, artist: picture.artist, date: picture.date, ratio: picture.ratio, line: picture.line },
    onOpenPicture: (event: ActivateEvent) => {
      notePicture(registry, picture.id, 'small')
      openGallery(picture.id, { newTab: event.metaKey })
    },
    onPictureMissing: () => forgetPicture(picture.id),
  }
}

/**
 * How long Home's rows keep holding after the pointer and keyboard focus
 * have left them, as the sidebar's list does (SPEC 5, "Holding the order").
 */
const HOLD_GRACE_MS = 400

const NONE: ReadonlySet<string> = new Set()

/**
 * Home's rows through the hold (SPEC 12, "Home is live"): the live items,
 * capped, or while the pointer or keyboard focus is in the rows or a review
 * sheet is open, the rows shown when the hold began with live contents
 * (`holdHome`). `release` is the user acting on an item: it goes, or comes
 * back, at once even while the rows hold.
 */
function useHeldRows(live: ReadonlyArray<HomeItem>, limit: number, sheetOpen: boolean) {
  const [held, setHeld] = useState<ReadonlyArray<HomeItem> | undefined>(undefined)
  const [released, setReleased] = useState(NONE)
  // Recording that Home showed the card hides it from later visits, not this one.
  const [record, setRecord] = useState<HomeItem | undefined>(undefined)
  const items = record === undefined || live.some((item) => item.kind === 'automatedMoves') ? live : [...live, record]
  const inside = useRef({ pointer: false, keyboard: false })
  const letGo = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const rows = held === undefined ? items.slice(0, limit) : holdHome(held, items, released, limit)
  const shownRecord = rows.find((item) => item.kind === 'automatedMoves')
  if (shownRecord !== undefined && shownRecord !== record) setRecord(shownRecord)
  const engaged = (part: 'pointer' | 'keyboard', now: boolean) => {
    inside.current = { ...inside.current, [part]: now }
    clearTimeout(letGo.current)
    if (inside.current.pointer || inside.current.keyboard || sheetOpen) {
      if (held !== undefined) return
      setHeld(rows)
      setReleased(NONE)
      return
    }
    letGo.current = setTimeout(() => {
      setHeld(undefined)
      setReleased(NONE)
    }, HOLD_GRACE_MS)
  }
  // A review sheet holds the rows while it is open. Rows that leave from under the pointer, or take keyboard focus
  // with them, send no leave event: with no row left, or focus gone to the page, the hold ends as if they had left.
  const sheet = useRef(sheetOpen)
  useEffect(() => {
    const pointer = inside.current.pointer && rows.length > 0
    const keyboard = inside.current.keyboard && rows.length > 0 && document.activeElement !== document.body
    if (sheet.current === sheetOpen && pointer === inside.current.pointer && keyboard === inside.current.keyboard) return
    sheet.current = sheetOpen
    inside.current = { pointer, keyboard }
    engaged('pointer', pointer)
  })
  useEffect(() => () => clearTimeout(letGo.current), [])
  // Recorded whether or not the rows hold yet: the press that acts can be the one that starts the hold.
  const release = (itemId: string) => setReleased((before) => (before.has(itemId) ? before : new Set([...before, itemId])))
  return { rows, onHold: engaged, release }
}

/** What Home's row buttons do, for the items `items`; `release` lets the item an action is on skip the hold. */
function itemActions(items: ReadonlyArray<HomeItem>, setReviewing: (item: HomeItem) => void, release: (itemId: string) => void, movesSeen: () => void) {
  const itemOf = (itemId: string) => items.find((candidate) => candidate.id === itemId)
  const markDone = (itemId: string) => {
    const item = itemOf(itemId)
    if (item === undefined) return
    release(itemId)
    void markFollowUpDone(registry, item)
  }
  const resolveAll = (itemId: string) => {
    const item = itemOf(itemId)
    if (item === undefined) return
    release(itemId)
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
      release(itemId)
      movesSeen()
      markMovesSeen(registry, item)
    }
  }
  // Dismiss on Automated's record: its moves are seen without opening it.
  const dismiss = (itemId: string) => {
    const item = itemOf(itemId)
    if (item === undefined) return
    release(itemId)
    movesSeen()
    markMovesSeen(registry, item)
  }

  // Automated's question: Move or Keep in All, remembered, with Undo; right-click has the conversation's menu, with Ignore.
  const sort = (itemId: string, to: 'automated' | 'kept') => {
    const channel = itemOf(itemId)?.channel
    if (channel === undefined) return
    release(itemId)
    void runAction(registry, viewsSortChannel, { channel: channel.id, to }, { text: to === 'automated' ? `Moved ${channel.label} to Automated` : `Keeping ${channel.label} in All` })
  }
  const itemMenu = (itemId: string) => {
    const item = itemOf(itemId)
    if (item?.channel === undefined) return
    // The menu's Ignore removes the row at once.
    release(itemId)
    const main = item.topics[0]?.id
    void showChannelMenu({ ...item.channel, ...(main === undefined ? {} : { mainId: main }) })
  }
  // A proactive ask: Start runs the learning pass in the background, Not now puts it away, and the row opens the chat at it.
  const ask = (itemId: string, answer: 'start' | 'dismiss' | 'open') => {
    const id = itemOf(itemId)?.ask?.id
    if (id === undefined) return
    if (answer === 'open') return openJuno()
    release(itemId)
    void pageActions.answerAsk(id, answer).then((outcome) => {
      if (answer === 'start' && outcome === 'ok') showToast(registry, { text: junoAskCopy.learn.started })
    })
  }
  return { markDone, resolveAll, review, dismiss, sort, itemMenu, ask }
}

const pageActions = junoPageActions(registry)

const closeCard = () => closeWelcome(registry)

/**
 * Tells the engine once per Home on screen that it showed Automated's
 * record, so the card waits a day before it shows again. Its moves stay
 * until the record is opened or the card dismissed.
 */
function useMovesShown(items: ReadonlyArray<HomeItem>): void {
  const told = useRef(false)
  const record = items.some((item) => item.kind === 'automatedMoves')
  useEffect(() => {
    if (!record || told.current) return
    told.current = true
    markMovesShown(registry)
  }, [record])
}

/**
 * The welcome card (SPEC 4) as this Home shows it. Once it has shown, its
 * room stays while this Home is on screen, empty after Hide or Done.
 */
function useWelcome() {
  const welcome = useAtomValue(welcomeAtom)
  const peekKey = useAtomValue(peekKeyAtom)
  const [last, setLast] = useState(welcome)
  if (welcome !== undefined && welcome !== last) setLast(welcome)
  const shown = welcome ?? last
  if (shown === undefined) return undefined
  return <WelcomeCard done={shown.done} peekKey={peekKey} onClose={closeCard} hidden={welcome === undefined || !welcome.ready} />
}

/**
 * Home's picture (SPEC 12, "A picture"): when idle after Home paints, the next picture is picked and downloaded,
 * so the next caught-up Home has it on disk in its first frame, and the picture page's code loads, so opening the
 * picture shows its page in the next frame.
 */
function usePicture(): void {
  const on = useAtomValue(homePicturesOnAtom)
  useEffect(() => {
    if (!on) return
    const idle = requestIdleCallback(() => {
      void preparePicture(registry, new Date())
      void gallery.load()
    }, { timeout: 5_000 })
    return () => cancelIdleCallback(idle)
  }, [on])
}

/**
 * The picture while Home is caught up (`wanted`): the current pick, already on this Mac, taken in the render
 * Home becomes caught up and kept while it stays so. With none on disk then, the scene stays for that stretch,
 * so a picture never arrives after the first frame.
 */
function useCaughtUpPicture(wanted: boolean, now: number): ReturnType<typeof takePicture> {
  const [taken, setTaken] = useState<{ readonly picture: ReturnType<typeof takePicture> } | undefined>(undefined)
  if (!wanted) {
    if (taken !== undefined) setTaken(undefined)
    return undefined
  }
  if (taken !== undefined) return taken.picture
  const picture = takePicture(now)
  setTaken({ picture })
  return picture
}

/** The syncing line with the first sync's count. Its own component, so a new count redraws the line and not Home. */
function SyncLine({ line }: { readonly line: string }) {
  return <HomeSyncLine line={line} progress={useAtomValue(syncProgressAtom)} />
}

/**
 * Home (SPEC section 12): the Home tab, with its composer (`HomeComposer`)
 * at the bottom. It shows `home.view`'s items as they are now, capped, and
 * holds them while the pointer or keyboard focus is in the rows or a
 * review sheet is open (`useHeldRows`); what the user does to a row shows
 * at once. Until Home is ready it shows the scene and the greeting with
 * "Syncing with Slack.", then the sync's count, and rows as they land.
 */
export function HomePage({ tabId }: { readonly tabId: string }) {
  const [appearance] = useState(() => homeAppears(registry))
  // A card's review, open over Home (`HomeReview`), with the item it shows.
  const [reviewing, setReviewing] = useState<HomeItem | undefined>(undefined)
  const [movesSeen, setMovesSeen] = useState(false)
  const reviewReady = usePreloaded(reviewSheets, reviewing !== undefined)
  const result = useAtomValue(homeViewAtom)
  const value = result._tag === 'Success' ? result.value : undefined
  const asks = useAtomValue(homeAsksAtom)
  const now = useAtomValue(nowAtom)
  const welcome = useWelcome()
  const picturesOn = useAtomValue(homePicturesOnAtom)
  usePicture()
  const live = value === undefined ? NO_ITEMS : withAsks(value, asks).items
  const { rows, onHold, release } = useHeldRows(live, homeItemLimit(window.innerHeight, welcome !== undefined), reviewing !== undefined)
  useMovesShown(rows)
  const heading = value === undefined ? undefined : homeHeading(value, rows, appearance)
  const picture = useCaughtUpPicture(heading?.caughtUp === true && picturesOn && welcome === undefined, now)

  // Until Home has a value (a few milliseconds) the column is blank, never a spinner, and the composer is already in place.
  if (heading === undefined) return <Home waiting scene="morning" title="" items={[]} now={0} onOpen={openItem} onMarkDone={noop} onResolveAll={noop} onReview={noop} onSort={noop} onItemMenu={noop} composer={<HomeComposer tabId={tabId} />} />

  const { markDone, resolveAll, review, dismiss, sort, itemMenu, ask } = itemActions(rows, setReviewing, release, () => setMovesSeen(true))
  const closeReview = (item: HomeItem) => {
    // What was done in the sheet shows as it closes.
    release(item.id)
    setReviewing(undefined)
  }

  return (
    <>
    <Home
      loading={heading.line !== undefined}
      scene={heading.scene}
      title={heading.title}
      line={heading.line === undefined ? undefined : <SyncLine line={heading.line} />}
      items={rows}
      now={now}
      onHold={onHold}
      onOpen={(topicId, event) => {
        const item = rows.find((entry) => entry.topics.some((topic) => topic.id === topicId))
        if (item !== undefined) release(item.id)
        if (item?.kind === 'missedHuddle' && item.huddleId !== undefined) void runCommand(registry, homeHuddleSeen, { callId: item.huddleId })
        openItem(topicId, event)
      }}
      onMarkDone={markDone}
      onResolveAll={resolveAll}
      onReview={review}
      onSort={sort}
      onItemMenu={itemMenu}
      {...(movesSeen ? {} : { onDismiss: dismiss })}
      onAsk={ask}
      composer={<HomeComposer tabId={tabId} />}
      welcome={welcome}
      {...(picture === undefined ? {} : pictureProps(picture))}
    />
    {reviewing === undefined || !reviewReady ? null : (
      <Suspense fallback={null}>
        <HomeReview item={reviewing} now={now} onClose={() => closeReview(reviewing)} />
      </Suspense>
    )}
    </>
  )
}
