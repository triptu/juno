/**
 * ⌘K (spec section 10, inventory 9, performance 5.3). Local results come
 * from `searchAtom` through `useDeferredValue`, so a keystroke paints the
 * text at once and the rows follow in the same frame budget. After a pause
 * in typing, the command reading and Slack's search are asked for; a
 * command shows above the results, and Slack's matches are added under the
 * rows already shown, never moving them. Rows open topics (at a message,
 * which then flashes), a channel's Main or a person's DM, narrow the
 * sidebar, start a New chat to someone never messaged, or run the command.
 * Its own chunk: `Palette.tsx` loads it on idle after the first paint.
 */
import { useDeferredValue, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ConversationKind, PaletteCommand, SearchChannel, SearchMessage, SearchPerson, SearchResult } from '@juno/contract'
import {
  appendUnseen,
  COMMAND_DELAY_MS,
  loadOlderMessages,
  nowAtom,
  PALETTE_RECENT,
  PALETTE_RESULTS,
  PALETTE_SLACK_RESULTS,
  readCommand,
  registry,
  searchAtom,
  searchSlackMessages,
  sendMessage,
  showToast,
  SLACK_DELAY_MS,
  SLACK_MIN_LENGTH,
  type OpenOptions,
  type Registry,
} from '@juno/state'
import { afterPaint, measure } from '@juno/state/perf'
import { useAtomValue } from '@juno/state/react'
import { CommandPalette, type PaletteIconName, type PaletteItem, type PaletteSection } from '@juno/views'
import { junoCommands, openJunoTab } from './juno/actions'
import { openNewChatTo, openTopic, openTopicAt, warmTopic } from './navigation'
import { closePalette } from './paletteActions'
import { resolveTopic } from './topicActions'
import { scopeToChannel, showChannelMenu, type MenuChannel } from './placeMenus'

/** The ts just after `ts`, so a page fetched "before" it includes it. */
function justAfter(ts: string): string {
  const [seconds = '0', micros = '0'] = ts.split('.')
  const next = Number(micros) + 1
  return next >= 1_000_000 ? `${Number(seconds) + 1}.000000` : `${seconds}.${String(next).padStart(6, '0')}`
}

/**
 * A message result: its topic, opened at it, and it flashes. A match only
 * Slack's search found is fetched first, with the page that ends at it, so
 * the topic opens at it rather than at the bottom.
 */
async function openMessage(message: SearchMessage, options: OpenOptions): Promise<void> {
  if (!message.stored) await loadOlderMessages(registry, message.topicId, justAfter(message.ts))
  openTopicAt(message.topicId, message.ts, { ...options, flash: true })
}

/** A person's result: your Main with them, or a New chat addressed to them when you have never messaged (spec section 10). */
function openPerson(person: Pick<SearchPerson, 'person' | 'mainId'>, options: OpenOptions): void {
  if (person.mainId !== undefined) return openTopic(person.mainId, options)
  openNewChatTo({ key: `u:${person.person.id}`, name: person.person.name, kind: 'im', tint: 'dm', person: person.person, empty: true })
}

/**
 * Runs a command row. A send posts at once into that Main; sends are final
 * (ADR 0010), so the toast has no Undo. "Ask" opens Juno with the request.
 */
async function runPaletteCommand(command: PaletteCommand): Promise<void> {
  switch (command.kind) {
    case 'send-dm':
    case 'post': {
      const to = command.kind === 'send-dm' ? { kind: 'person' as const, userId: command.userId } : { kind: 'channel' as const, channelId: command.channelId }
      const exit = await sendMessage(registry, to, command.text)
      showToast(registry, { text: exit._tag === 'Success' ? `Posted in ${command.place} · Main` : `Could not post in ${command.place}` })
      return
    }
    case 'open-dm':
      return openPerson(command, {})
    case 'ask':
      openJunoTab()
      junoCommands.send(command.prompt)
      return
    case 'resolve':
      return resolveTopic(command.topicId)
  }
}

/** Rows under a command (inventory 9). */
const RESULTS_UNDER_COMMAND = 6
/** The grammar reads nothing shorter (`MIN_COMMAND_LENGTH` in `@juno/domain`). */
const COMMAND_MIN_LENGTH = 4

/** A row, and what choosing it does. */
interface Row extends PaletteItem {
  /** The topic it opens, for a prefetch. */
  readonly topicId?: string
  readonly channel?: MenuChannel
  readonly run: (options: OpenOptions) => void
}

const kindLabel: Record<ConversationKind, string> = { public: 'Public channel', private: 'Private channel', im: 'Direct message', mpim: 'Group DM' }
const placeIcon: Record<ConversationKind, PaletteIconName> = { public: 'public', private: 'private', im: 'dm', mpim: 'group' }

const menuChannel = (result: SearchChannel): MenuChannel => ({
  id: result.id,
  kind: result.place.kind,
  name: result.place.name,
  label: result.place.label,
  tint: result.place.tint,
  ...(result.mainId === undefined ? {} : { mainId: result.mainId }),
})

const messageRow = (result: SearchMessage): Row => ({
  id: `message:${result.id}`,
  icon: 'message',
  label: result.title,
  sub: result.place.label,
  snippet: { sender: result.sender, text: result.text },
  opensTab: true,
  topicId: result.topicId,
  run: (options) => void openMessage(result, options),
})

/** The palette rows for a result: one, or two for a channel (its Main, and "show its topics"). */
function rowsOf(result: SearchResult): ReadonlyArray<Row> {
  switch (result.kind) {
    case 'topic': {
      const main = result.id.startsWith('m:')
      return [{ id: `topic:${result.id}`, icon: main ? placeIcon[result.place.kind] : 'thread', label: result.title, sub: result.place.label, at: result.at, opensTab: true, topicId: result.id, run: (options) => openTopic(result.id, options) }]
    }
    case 'message':
      return [messageRow(result)]
    case 'channel': {
      const channel = menuChannel(result)
      const scope: Row = { id: `scope:${result.id}`, icon: 'scope', label: result.place.label, sub: `${kindLabel[result.place.kind]} · show its topics`, menu: true, channel, run: () => scopeToChannel(result.id) }
      if (result.mainId === undefined) return [scope]
      const mainId = result.mainId
      return [{ id: `channel:${result.id}`, icon: placeIcon[result.place.kind], label: result.place.label, sub: `${kindLabel[result.place.kind]} · Main`, opensTab: true, menu: true, channel, topicId: mainId, run: (options) => openTopic(mainId, options) }, scope]
    }
    case 'person':
      return [
        {
          id: `person:${result.id}`,
          icon: 'person',
          label: `Message ${result.person.name}`,
          sub: result.mainId === undefined ? 'Starts a conversation' : 'Direct message · Main',
          ...(result.mainId === undefined ? {} : { opensTab: true, topicId: result.mainId }),
          run: (options) => openPerson(result, options),
        },
      ]
  }
}

const commandIcon: Record<PaletteCommand['kind'], PaletteIconName> = { 'send-dm': 'send', post: 'send', 'open-dm': 'open-dm', ask: 'ask', resolve: 'resolve' }

const commandRow = (command: PaletteCommand): Row => ({
  id: 'command',
  icon: commandIcon[command.kind],
  label: command.label,
  sub: command.sub,
  badge: `${Math.round(Math.min(1, Math.max(0, command.confidence)) * 100)}%`,
  hint: command.hint,
  run: () => void runPaletteCommand(command),
})

/** Each edit owns its async answers, including when the same text is typed again. */
interface Query {
  readonly text: string
}

/** The palette while it is open: mounted on open, so each open starts empty. */
export function OpenPalette() {
  const [request, setRequest] = useState<Query>({ text: '' })
  const query = request.text
  const deferred = useDeferredValue(request)
  const result = useAtomValue(searchAtom(deferred.text))
  const now = useAtomValue(nowAtom)

  // The rows of the last text that has results, held until the next text's arrive, so typing never flashes an empty list.
  const [held, setHeld] = useState<{ readonly request: Query; readonly results: ReadonlyArray<SearchResult> } | undefined>(undefined)
  const current = deferred === request && result._tag === 'Success'
  if (current && (held?.request !== request || held.results !== result.value)) setHeld({ request, results: result.value })
  const local = current ? { request, results: result.value } : held
  const settled = local?.request === request

  const command = useLater(request, COMMAND_MIN_LENGTH, COMMAND_DELAY_MS, readCommand)
  const slack = useLater(request, SLACK_MIN_LENGTH, SLACK_DELAY_MS, searchSlackMessages)

  const results = local?.results ?? []
  const shownCommand = settled ? command ?? null : null
  const max = local?.request.text.trim() === '' ? PALETTE_RECENT : shownCommand !== null ? RESULTS_UNDER_COMMAND : PALETTE_RESULTS
  const localRows = results.flatMap(rowsOf).slice(0, max)
  const rows = settled && slack !== undefined && query.trim() !== '' ? appendUnseen(localRows, slack.map(messageRow), PALETTE_SLACK_RESULTS) : localRows
  const sections: ReadonlyArray<PaletteSection> = [
    ...(shownCommand === null ? [] : [{ heading: 'Juno' as const, items: [commandRow(shownCommand)] }]),
    { heading: local?.request.text.trim() === '' ? ('Recent' as const) : ('Results' as const), items: rows },
  ]
  const byId = new Map<string, Row>([...(shownCommand === null ? [] : [commandRow(shownCommand)]), ...rows].map((row) => [row.id, row]))

  // juno.palette-open: from ⌘K or the button to the first paint with rows. juno.palette-results: from a keystroke to its rows painted.
  const opened = useRef(false)
  const typed = useRef<{ readonly text: string; readonly at: number } | undefined>(undefined)
  useLayoutEffect(() => {
    if (!settled) return
    if (!opened.current) {
      opened.current = true
      afterPaint(() => measure('juno.palette-open', 'juno.palette-open'))
    }
    const keystroke = typed.current
    if (keystroke !== undefined && keystroke.text === local?.request.text.trim()) {
      typed.current = undefined
      afterPaint(() => measure('juno.palette-results', keystroke.at, { detail: { rows: rows.length } }))
    }
  })

  const onQuery = (next: string) => {
    typed.current = { text: next.trim(), at: performance.now() }
    setRequest({ text: next })
  }

  const onSelect = (id: string, options: { readonly newTab: boolean }) => {
    const row = byId.get(id)
    if (row === undefined) return
    closePalette(false)
    row.run(options.newTab ? { newTab: true } : {})
  }

  const onMenu = (id: string, at: { readonly x: number; readonly y: number } | undefined) => {
    const channel = byId.get(id)?.channel
    if (channel === undefined) return
    void showChannelMenu(channel, at).then((chosen) => {
      if (chosen === 'show-topics' || chosen === 'open-main' || chosen === 'ask-juno') closePalette(false)
    })
  }

  return (
    <CommandPalette
      query={query}
      resultsQuery={local?.request.text.trim() ?? ''}
      onQuery={onQuery}
      sections={sections}
      settled={settled}
      now={now}
      onSelect={onSelect}
      onActiveChange={(id) => {
        const topic = byId.get(id)?.topicId
        if (topic !== undefined) warmTopic(topic)
      }}
      onMenu={onMenu}
      onClose={() => closePalette()}
    />
  )
}

/**
 * A one-shot answer for the text, asked once typing pauses for `delay`.
 * Answers carry the edit that requested them, so an older answer cannot
 * replace the current one, even when the user types the same text again.
 */
function useLater<A>(
  query: Query,
  minLength: number,
  delay: number,
  ask: (target: Registry, text: string) => Promise<{ readonly _tag: 'Success'; readonly value: A } | { readonly _tag: 'Failure' }>,
): A | undefined {
  const [answer, setAnswer] = useState<{ readonly query: Query; readonly value: A } | undefined>(undefined)
  useEffect(() => {
    const text = query.text.trim()
    if (text.length < minLength) return
    let live = true
    const timer = setTimeout(() => {
      void ask(registry, text).then((exit) => {
        if (live && exit._tag === 'Success') setAnswer({ query, value: exit.value })
      })
    }, delay)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [query, minLength, delay, ask])
  return answer?.query === query ? answer.value : undefined
}
