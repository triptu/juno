import { MESSAGE_LANDING_OFFSET } from '@juno/tokens/layout'
/**
 * The Search tab's reader (SPEC 10a): the chosen result's topic itself,
 * with its header, composer, reactions and menus, landed at the match with
 * the matched words marked. Until it is used it marks nothing read
 * (`Topic`'s `reader`).
 *
 * A new selection shows in the frame it was made, and the last topic's
 * messages never stay on screen. A topic whose header and window around
 * the match are local shows at once; the list keeps the rows the arrows
 * and the pointer reach next warm. Otherwise the reader draws the result's
 * header and message from its row (`ReaderPreview`), and the topic takes
 * its place once the match is local, with the match where it was. Slack is
 * asked only once an arrow stops (`KEY_SETTLE_MS`), so a held arrow loads
 * only the result it stops on. A move within the shown topic flashes the
 * match there (`moveReader`).
 */
import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { defaultPersonColor, mainTopicOf, threadTopicOf, type SearchHit, type SearchSnapshot, type TopicDetail } from '@juno/contract'
import { afterPaint, mark, measure } from '@juno/state/perf'
import { flashMessage, loadMessageAt, matchWindow, messageListAtom, messageWindowSpecAtom, nowAtom, readerWindow, registry, scrollSnapshotAtom, searchMatchesAtom, searchSessionAtom, searchStepsAtom, topicAtom, topicView, type SearchSelection } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { ComposerSlot, MessageList, TopicHeader, TopicView as TopicViewFrame, type MessageListItem, type SearchRowItem, type TopicHeaderReader, type TopicHeaderTopic } from '@juno/views'
import { openTopicAtInBackground, openTopicInBackground } from '../navigation'
import { useTopicHeader } from '../topic/header'
import { rowSelector } from '../topic/scroll'
import { Topic } from '../TopicView'
import { markMatches } from './matches'

/** Where a match lands: under the header band, as a notification's message does. */
const READER_TOP = MESSAGE_LANDING_OFFSET
/** After an arrow, how long the selection must stay before its topic asks Slack for anything: longer than a held key repeats. */
const KEY_SETTLE_MS = 120
/** How long the reader keeps a result's own message once the topic is local without it (deleted, or Slack lost it). */
const GONE_WAIT_MS = 400

/** The reader's own view of a topic, apart from any tab's: its window and scroll position. */
const readerView = (sessionId: string, topicId: string) => topicView(topicId, `search:${sessionId}`)

/** The topic each session's reader shows, for `moveReader`. */
const shownTopics = new Map<string, string>()
/** How each session's selection last moved: an arrow's Slack fetches wait for the arrows to stop. */
const lastMoves = new Map<string, 'pointer' | 'keyboard' | 'step'>()

let measureFrom: number | undefined
/** An arrow moved the selection: the reader's paint at it is `juno.search-reader`. */
function startMeasure(): void {
  measureFrom = mark('juno.search-reader', undefined, { replace: true })
}

/** The reader's window around the target's match, which lands under the header band. */
function aim(view: string, target: SearchSelection): void {
  registry.set(messageWindowSpecAtom(view), readerWindow(target.ts))
  registry.set(scrollSnapshotAtom(view), target.ts === undefined ? undefined : { anchorKey: target.ts, offset: READER_TOP })
}

/**
 * The reader follows a new selection. In the topic it shows, it moves to
 * the match and flashes it; for another topic it sets the reader's window
 * around the match and where it lands, before that topic shows.
 */
export function moveReader(sessionId: string, target: SearchSelection, how: 'pointer' | 'keyboard' | 'step'): void {
  if (how === 'keyboard') startMeasure()
  lastMoves.set(sessionId, how)
  const view = readerView(sessionId, target.topicId)
  if (shownTopics.get(sessionId) !== target.topicId) return aim(view, target)
  const ts = target.ts
  if (ts === undefined) return
  const land = () => {
    if (!registry.get(messageListAtom(view)).rows.has(ts)) registry.set(messageWindowSpecAtom(view), matchWindow(ts))
    flashMessage(registry, target.topicId, ts)
  }
  if (target.stored !== false) return land()
  // A match only Slack found is fetched first, and landed on if it is still the selection.
  void loadMessageAt(registry, target.topicId, ts).then(() => {
    if (registry.get(searchSessionAtom(sessionId)).selected?.ts === ts) land()
  })
}

/** Open in new tab, and ⌘Enter on a row: the topic at the match in a tab behind this one. */
export async function openResultBehind(target: SearchSelection): Promise<void> {
  if (target.ts === undefined) return openTopicInBackground(target.topicId)
  if (target.stored === false) await loadMessageAt(registry, target.topicId, target.ts)
  openTopicAtInBackground(target.topicId, target.ts)
}

export interface SearchReaderProps {
  readonly sessionId: string
  readonly selection: SearchSelection | undefined
  /** The selected row, for the result's header and message while its topic is not local. */
  readonly row: SearchRowItem | undefined
  readonly snapshot: SearchSnapshot | undefined
  /** The panel covers the results: Back to results leads the header. Beside them, Close ends it. */
  readonly narrow: boolean
  readonly readerRef: RefObject<HTMLDivElement | null>
  /** While a topic shows: how ⌘↑ and ⌘↓ from the list or the field step its matches. */
  readonly onStepper: (step: ((direction: 1 | -1) => void) | undefined) => void
  /** Back to results, or Close: the panel goes and the selected card takes focus. */
  readonly onBack: () => void
  /** Esc in the empty composer: back to the list. */
  readonly onEscape: () => void
  /** ⌘↑, ⌘↓ or the header's arrows moved to another match in the topic. */
  readonly onStep: (ts: string) => void
  /** The reader was used: the search counts as a recent one. */
  readonly onUsed: () => void
}

export function SearchReader(props: SearchReaderProps) {
  const { selection } = props
  return selection === undefined ? null : <ReaderTopic key={selection.topicId} {...props} selection={selection} />
}

function ReaderTopic({ sessionId, selection, row, snapshot, narrow, readerRef, onStepper, onBack, onEscape, onStep, onUsed }: SearchReaderProps & { readonly selection: SearchSelection }) {
  const { topicId, ts } = selection
  const view = readerView(sessionId, topicId)
  const result = useAtomValue(topicAtom(topicId))
  const detail = result._tag === 'Success' ? result.value : undefined
  const list = useAtomValue(messageListAtom(view))
  // A restored selection had no move to aim the reader's view.
  useLayoutEffect(() => {
    if (registry.get(messageWindowSpecAtom(view)).anchor !== ts) aim(view, selection)
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- Once, as the topic comes in; later moves aim the view themselves.
  }, [])
  const fetch = useSettled(sessionId, ts)
  const asked = useLoadAt(selection, fetch)
  const local = list.ready && (ts === undefined || list.rows.has(ts))
  const gone = useAfter(asked && list.ready && list.spec.anchor === ts && !local, GONE_WAIT_MS)
  // The match the topic landed on, once its rows are local; from then on the topic shows.
  const [landed, setLanded] = useState<{ readonly at: string | undefined } | undefined>(undefined)
  if (landed === undefined && detail != null && (local || gone)) setLanded({ at: ts })
  const shown = landed !== undefined && detail != null

  const painted = !shown || local || gone
  useEffect(() => {
    if (!painted || measureFrom === undefined) return
    const from = measureFrom
    measureFrom = undefined
    afterPaint(() => measure('juno.search-reader', from, { detail: { reader: shown ? 'topic' : 'preview' } }))
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- A same-topic move starts a new measure even while `painted` stays true.
  }, [painted, ts])

  const generation = snapshot?.generation ?? 0
  const steps = useAtomValue(searchStepsAtom(sessionId, generation, topicId, ts))
  const nav = steps._tag === 'Success' ? steps.value : undefined
  const marked = useMarked(sessionId, generation, selection, shown ? list.order : undefined)
  const words = (snapshot?.query.clauses ?? []).flatMap((clause) => (clause.kind === 'term' || clause.kind === 'phrase') && !clause.negated ? [clause.value] : [])
  const go = (direction: 1 | -1) => {
    const next = direction === -1 ? nav?.previous : nav?.next
    if (next != null) onStep(next)
  }
  const stepTo = useEffectEvent(go)
  useEffect(() => {
    onStepper((direction) => stepTo(direction))
    return () => onStepper(undefined)
  }, [onStepper])
  useLayoutEffect(() => {
    if (!shown) return
    shownTopics.set(sessionId, topicId)
    return () => {
      if (shownTopics.get(sessionId) === topicId) shownTopics.delete(sessionId)
    }
  }, [shown, sessionId, topicId])
  useMarks(readerRef, marked, ts, words)

  const step = nav !== undefined && nav.count > 1 ? { index: nav.index, count: nav.count, onPrevious: () => go(-1), onNext: () => go(1) } : undefined
  const header = { onOpenInNewTab: () => void openResultBehind(selection), ...(narrow ? { onBack } : { onClose: onBack }), ...(step === undefined ? {} : { step }) }
  if (landed !== undefined && detail != null) return <Topic id={topicId} view={view} detail={detail} reader={{ header, onEscape, onUsed, landing: landed.at, fetch }} />
  return <ReaderPreview view={view} selection={selection} row={row} detail={detail ?? undefined} header={header} />
}

/** False while an arrow may still move on: after an arrow, the selection must stay `KEY_SETTLE_MS` before Slack is asked. */
function useSettled(sessionId: string, ts: string | undefined): boolean {
  const key = ts ?? ''
  const [settled, setSettled] = useState<string | undefined>(() => (lastMoves.get(sessionId) === 'keyboard' ? undefined : key))
  useEffect(() => {
    if (settled === key) return
    const timer = setTimeout(() => setSettled(key), lastMoves.get(sessionId) === 'keyboard' ? KEY_SETTLE_MS : 0)
    return () => clearTimeout(timer)
  }, [sessionId, key, settled])
  return settled === key
}

/** A match only Slack found is fetched once `fetch` is set; true once the store has had its answer. A move on drops the answer. */
function useLoadAt({ topicId, ts, stored }: SearchSelection, fetch: boolean): boolean {
  const [loaded, setLoaded] = useState<string | undefined>(undefined)
  const needed = stored === false && ts !== undefined
  useEffect(() => {
    if (!needed || !fetch || ts === undefined) return
    let current = true
    void loadMessageAt(registry, topicId, ts).then(() => {
      if (current) setLoaded(ts)
    })
    return () => {
      current = false
    }
  }, [needed, fetch, topicId, ts])
  return !needed || loaded === ts
}

/** True once `on` has held for `ms`. */
function useAfter(on: boolean, ms: number): boolean {
  const [done, setDone] = useState(false)
  if (!on && done) setDone(false)
  useEffect(() => {
    if (!on) return
    const timer = setTimeout(() => setDone(true), ms)
    return () => clearTimeout(timer)
  }, [on, ms])
  return on && done
}

/**
 * The matches to mark among the drawn rows (`order`, once the topic shows); the current one alone before that.
 * While a new window's answer is on its way the last ones stay, so marks never blink.
 */
function useMarked(sessionId: string, generation: number, { topicId, ts }: SearchSelection, order: ReadonlyArray<string> | undefined): ReadonlyArray<string> {
  const first = order?.[0]
  const last = order?.at(-1)
  // Without the drawn range this is the steps query, so a preview asks for nothing more.
  const range = first === undefined || last === undefined ? {} : { first, last }
  const result = useAtomValue(searchMatchesAtom({ sessionId, generation, topicId, ...(ts === undefined ? {} : { ts }), ...range }))
  const found = order !== undefined && result._tag === 'Success' ? result.value.marked : undefined
  const [held, setHeld] = useState<ReadonlyArray<string> | undefined>(undefined)
  if (found !== undefined && found !== held) setHeld(found)
  const own = useMemo(() => (ts === undefined ? [] : [ts]), [ts])
  return order === undefined ? own : (held ?? own)
}

interface PreviewProps {
  readonly view: string
  readonly selection: SearchSelection
  readonly row: SearchRowItem | undefined
  readonly detail: TopicDetail | null | undefined
  readonly header: TopicHeaderReader
}

/**
 * A result whose topic is not local yet: its header from the topic when that is local, else from the row, and its
 * message from the row, drawn as the topic draws it. The topic lands its match where this row sits, so the
 * message does not move when the rest of the topic fills in around it.
 */
function ReaderPreview({ view, selection, row, detail, header }: PreviewProps) {
  const now = useAtomValue(nowAtom, (time) => Math.floor(time / 60_000) * 60_000)
  const group = row !== undefined && 'group' in row ? row.group : undefined
  const hit = selection.ts === undefined ? undefined : group?.messages.find((message) => message.ts === selection.ts)
  const item = hit === undefined ? undefined : previewItem(hit, selection.topicId)
  const main = detail != null ? detail.kind === 'main' : group !== undefined && selection.topicId === mainTopicOf(group.place.id)
  const label = detail?.channel.label ?? group?.place.label
  const scrollRef = useRef<HTMLElement>(null)
  const ts = item?.message.ts
  useLayoutEffect(() => {
    const scroller = scrollRef.current
    const element = scroller === null || ts === undefined ? null : scroller.querySelector(rowSelector(ts))
    if (scroller === null || element === null || ts === undefined) return
    registry.set(scrollSnapshotAtom(view), { anchorKey: ts, offset: element.getBoundingClientRect().top - scroller.getBoundingClientRect().top })
  }, [view, ts])
  const topic: TopicHeaderTopic | undefined = group === undefined ? undefined : { kind: main ? 'main' : 'thread', title: group.title, subscribed: true, resolved: false, channel: group.place }
  const head = detail != null ? <KnownHeader detail={detail} reader={header} /> : topic === undefined ? null : <TopicHeader detail={topic} onMenu={() => {}} reader={header} />
  return (
    <TopicViewFrame header={head} composer={label === undefined ? undefined : <ComposerSlot placeholder={main ? `Message ${label}` : 'Reply'} />}>
      <MessageList items={item === undefined ? [] : [item]} eager={ts === undefined ? undefined : new Set([ts])} main={main} now={now} status="pending" scrollRef={scrollRef} />
    </TopicViewFrame>
  )
}

function KnownHeader({ detail, reader }: { readonly detail: TopicDetail; readonly reader: TopicHeaderReader }) {
  return useTopicHeader(detail, false, false, reader)
}

/** A search hit as the topic draws its message: its card's sender, body, files and reactions, or its sender's name and the text the row shows. */
function previewItem(hit: SearchHit, topicId: string): MessageListItem {
  const card = hit.card
  const senderId = card?.sender.id ?? hit.senderId ?? hit.id
  return {
    message: {
      id: hit.id,
      rev: 0,
      ts: hit.ts,
      at: Math.round(Number(hit.ts) * 1000),
      kind: 'message',
      senderId,
      fromMe: false,
      body: card?.body ?? { blocks: [{ kind: 'paragraph', children: [{ kind: 'text', text: hit.text }] }] },
      edited: false,
      groupStart: true,
      broadcast: false,
      root: topicId === threadTopicOf(hit.place.id, hit.ts),
      reactions: card?.reactions ?? [],
      files: card?.files ?? [],
    },
    sender: card?.sender ?? { id: senderId, name: hit.sender, color: defaultPersonColor(senderId), ...(hit.senderId === undefined ? { unreachable: true as const } : {}) },
  }
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
