import { MESSAGE_LANDING_OFFSET } from '@juno/tokens/layout'
/**
 * The Search tab's reader (SPEC 10a): the chosen result's topic itself,
 * with its header, composer, reactions and menus, landed at the match with
 * the matched words marked. It reads the local store, so a cached topic
 * shows in the frame the selection moved (the list warms the neighbours).
 * Until it is used it marks nothing read (`Topic`'s `reader`). Another
 * topic replaces the shown one once its header and window are local, so
 * the reader never flashes empty; a move within the shown topic flashes
 * the match there (`moveReader`).
 */
import { useEffect, useEffectEvent, useLayoutEffect, useState, type RefObject } from 'react'
import { afterPaint, mark, measure } from '@juno/state/perf'
import { searchMatchesAtom, searchSessionAtom, bottomWindow, flashMessage, loadOlderMessages, matchWindow, messageListAtom, messageWindowSpecAtom, registry, scrollSnapshotAtom, topicAtom, topicView, type SearchSelection } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { openTopicAtInBackground, openTopicInBackground } from '../navigation'
import { justAfter } from '../slackLinks'
import { Topic } from '../TopicView'
import { markMatches } from './matches'
import type { SearchSnapshot } from '@juno/contract'

/** Where a match lands: under the header band, as a notification's message does. */
const READER_TOP = MESSAGE_LANDING_OFFSET
/** The longest the reader keeps the last topic while the next one loads. */
const READY_WAIT_MS = 1500

/** The reader's own view of a topic, apart from any tab's: its window and scroll position. */
const readerView = (sessionId: string, topicId: string) => topicView(topicId, `search:${sessionId}`)

/** The topic each session's reader shows, for `moveReader`. */
const shownTopics = new Map<string, string>()

let measureFrom: number | undefined
/** An arrow moved the selection: the reader's paint at it is `juno.search-reader`. */
function startMeasure(): void {
  measureFrom = mark('juno.search-reader', undefined, { replace: true })
}

/**
 * The reader follows a new selection. In the topic it shows, it moves to
 * the match and flashes it; for another topic it sets the reader's window
 * around the match and where it lands, before that topic shows.
 */
export function moveReader(sessionId: string, target: SearchSelection, how: 'pointer' | 'keyboard' | 'step'): void {
  if (how === 'keyboard') startMeasure()
  const view = readerView(sessionId, target.topicId)
  if (shownTopics.get(sessionId) === target.topicId) {
    const ts = target.ts
    if (ts === undefined) return
    const land = () => {
      if (!registry.get(messageListAtom(view)).rows.has(ts)) registry.set(messageWindowSpecAtom(view), matchWindow(ts))
      flashMessage(registry, target.topicId, ts)
    }
    if (target.stored !== false) return land()
    // A match only Slack found is fetched first, as for another topic (`Waiter`), and landed on if it is still the selection.
    void loadOlderMessages(registry, target.topicId, justAfter(ts)).then(() => {
      if (registry.get(searchSessionAtom(sessionId)).selected?.ts === ts) land()
    })
    return
  }
  // The newest messages first, as a topic opens; the waiter moves the window to an older match (`Waiter`).
  registry.set(messageWindowSpecAtom(view), bottomWindow)
  registry.set(scrollSnapshotAtom(view), target.ts === undefined ? undefined : { anchorKey: target.ts, offset: READER_TOP })
}

/** Open in new tab, and ⌘Enter on a row: the topic at the match in a tab behind this one. */
export async function openResultBehind(target: SearchSelection): Promise<void> {
  if (target.ts === undefined) return openTopicInBackground(target.topicId)
  if (target.stored === false) await loadOlderMessages(registry, target.topicId, justAfter(target.ts))
  openTopicAtInBackground(target.topicId, target.ts)
}

export interface SearchReaderProps {
  readonly sessionId: string
  readonly selection: SearchSelection | undefined
  readonly snapshot: SearchSnapshot | undefined
  /** The page is one column: Back to results leads the header. */
  readonly narrow: boolean
  readonly readerRef: RefObject<HTMLDivElement | null>
  /** While a topic shows: how ⌘↑ and ⌘↓ from the list or the field step its matches. */
  readonly onStepper: (step: ((direction: 1 | -1) => void) | undefined) => void
  readonly onBack: () => void
  /** Esc in the empty composer: back to the list. */
  readonly onEscape: () => void
  /** ⌘↑, ⌘↓ or the header's arrows moved to another match in the topic. */
  readonly onStep: (ts: string) => void
  /** The reader was used: the search counts as a recent one. */
  readonly onUsed: () => void
}

export function SearchReader(props: SearchReaderProps) {
  const { sessionId, selection } = props
  const [shown, setShown] = useState<SearchSelection | undefined>(undefined)
  if (selection === undefined && shown !== undefined) setShown(undefined)
  const sameTopic = shown !== undefined && selection !== undefined && shown.topicId === selection.topicId
  const displayed = sameTopic ? selection : shown
  const waiting = selection !== undefined && !sameTopic ? selection : undefined

  return (
    <>
      {waiting === undefined ? null : <Waiter key={`${waiting.topicId}\n${waiting.ts ?? ''}`} sessionId={sessionId} target={waiting} onReady={() => setShown(waiting)} />}
      {displayed === undefined ? null : <ShownTopic key={displayed.topicId} {...props} selection={displayed} />}
    </>
  )
}

/** Says when the next topic's header and the window around its match are local, or after a bounded wait. */
function Waiter({ sessionId, target, onReady }: { readonly sessionId: string; readonly target: SearchSelection; readonly onReady: () => void }) {
  const view = readerView(sessionId, target.topicId)
  const detail = useAtomValue(topicAtom(target.topicId))
  const list = useAtomValue(messageListAtom(view))
  useLayoutEffect(() => {
    // A restored selection had no event to set the view; a match only Slack found is fetched first, as ⌘K does.
    moveReader(sessionId, target, 'pointer')
    if (target.stored === false && target.ts !== undefined) void loadOlderMessages(registry, target.topicId, justAfter(target.ts))
  }, [sessionId, target])
  const [late, setLate] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setLate(true), READY_WAIT_MS)
    return () => clearTimeout(timer)
  }, [])
  // A match older than the newest messages: the window around it instead, as a link to an old message opens.
  const ts = target.ts
  const older = list.ready && list.spec.anchor === undefined && ts !== undefined && !list.rows.has(ts)
  useLayoutEffect(() => {
    if (older && ts !== undefined) registry.set(messageWindowSpecAtom(view), matchWindow(ts))
  }, [older, view, ts])
  const known = detail._tag === 'Success'
  const ready = known && (detail.value === null || late || (list.ready && (target.ts === undefined || list.rows.has(target.ts))))
  const report = useEffectEvent(onReady)
  useLayoutEffect(() => {
    if (ready) report()
  }, [ready])
  return null
}

function ShownTopic({ sessionId, selection, snapshot, narrow, readerRef, onStepper, onBack, onEscape, onStep, onUsed }: SearchReaderProps & { readonly selection: SearchSelection }) {
  const view = readerView(sessionId, selection.topicId)
  const result = useAtomValue(topicAtom(selection.topicId))
  const detail = result._tag === 'Success' ? result.value : undefined
  const list = useAtomValue(messageListAtom(view))
  const painted = list.ready && (selection.ts === undefined || list.rows.has(selection.ts))
  useEffect(() => {
    if (!painted || measureFrom === undefined) return
    const from = measureFrom
    measureFrom = undefined
    afterPaint(() => measure('juno.search-reader', from))
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- A same-topic move starts a new measure even while `painted` stays true.
  }, [painted, selection.ts])

  const navigation = useAtomValue(searchMatchesAtom({ sessionId, generation: snapshot?.generation ?? 0, topicId: selection.topicId, ...(selection.ts === undefined ? {} : { ts: selection.ts }), ...(list.order[0] === undefined ? {} : { first: list.order[0] }), ...(list.order.at(-1) === undefined ? {} : { last: list.order.at(-1)! }) }))
  const nav = navigation._tag === 'Success' ? navigation.value : undefined
  const words = (snapshot?.query.clauses ?? []).flatMap((clause) => (clause.kind === 'term' || clause.kind === 'phrase') && !clause.negated ? [clause.value] : [])
  const go = (direction: 1 | -1) => {
    const ts = direction === -1 ? nav?.previous : nav?.next
    if (ts != null) onStep(ts)
  }
  const stepTo = useEffectEvent(go)
  useEffect(() => {
    shownTopics.set(sessionId, selection.topicId)
    onStepper((direction) => stepTo(direction))
    return () => {
      if (shownTopics.get(sessionId) === selection.topicId) shownTopics.delete(sessionId)
      onStepper(undefined)
    }
  }, [sessionId, selection.topicId, onStepper])
  useMarks(readerRef, nav?.marked ?? [], selection.ts, words)

  if (detail == null) return null
  const step = nav !== undefined && nav.count > 1 ? { index: nav.index, count: nav.count, onPrevious: () => go(-1), onNext: () => go(1) } : undefined
  const header = { onOpenInNewTab: () => void openResultBehind(selection), ...(narrow ? { onBack } : {}), ...(step === undefined ? {} : { step }) }
  return <Topic id={selection.topicId} view={view} detail={detail} reader={{ header, onEscape, onUsed }} />
}

/** The matched words, marked once the rows are drawn, and again as more rows draw. */
function useMarks(readerRef: RefObject<HTMLDivElement | null>, found: ReadonlyArray<string>, current: string | undefined, words: ReadonlyArray<string>) {
  useEffect(() => {
    const root = readerRef.current
    if (root === null) return
    let undo = () => {}
    let frame: number | undefined
    const run = () => {
      frame = undefined
      undo()
      undo = markMatches(root, found, current, words)
    }
    const soon = () => {
      if (frame === undefined) frame = requestAnimationFrame(run)
    }
    soon()
    const observer = new MutationObserver(soon)
    observer.observe(root, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      if (frame !== undefined) cancelAnimationFrame(frame)
      undo()
    }
  }, [readerRef, found, current, words])
}
