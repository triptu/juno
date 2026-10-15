/**
 * ⌘K (spec section 10, inventory 9, performance 4.3). Local results come
 * from `searchAtom` through `useDeferredValue`, so a keystroke paints the
 * text at once and the rows follow in the same frame budget. After a pause
 * in typing, the command reading and Slack's search are asked for; a
 * command shows above the results, and Slack's matches are added under the
 * rows already shown, never moving them. Its own chunk: `Palette.tsx`
 * loads it on idle after the first paint.
 */
import { useDeferredValue, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ConversationKind, PaletteCommand, SearchChannel, SearchMessage, SearchResult } from '@juno/contract'
import {
  appendUnseen,
  COMMAND_DELAY_MS,
  nowAtom,
  PALETTE_RECENT,
  PALETTE_RESULTS,
  PALETTE_SLACK_RESULTS,
  readCommand,
  registry,
  searchAtom,
  searchSlackMessages,
  SLACK_DELAY_MS,
  SLACK_MIN_LENGTH,
  type OpenOptions,
  type Registry,
} from '@juno/state'
import { afterPaint, measure } from '@juno/state/perf'
import { useAtomValue } from '@juno/state/react'
import { CommandPalette, type PaletteIconName, type PaletteItem, type PaletteSection } from '@juno/views'
import { openTopic, warmTopic } from './navigation'
import { closePalette, openMessage, openPerson, runPaletteCommand } from './paletteActions'
import { scopeToChannel, showChannelMenu, type MenuChannel } from './placeMenus'

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

/** The palette while it is open: mounted on open, so each open starts empty. */
export function OpenPalette() {
  const [query, setQuery] = useState('')
  const deferred = useDeferredValue(query)
  const text = deferred.trim()
  const result = useAtomValue(searchAtom(deferred))
  const now = useAtomValue(nowAtom)

  // The rows of the last text that has results, held until the next text's arrive, so typing never flashes an empty list.
  const [held, setHeld] = useState<{ readonly text: string; readonly results: ReadonlyArray<SearchResult> } | undefined>(undefined)
  if (result._tag === 'Success' && (held?.text !== text || held.results !== result.value)) setHeld({ text, results: result.value })
  const local = result._tag === 'Success' ? { text, results: result.value } : held
  const settled = local !== undefined && local.text === query.trim()

  const command = useLater(query, COMMAND_MIN_LENGTH, COMMAND_DELAY_MS, readCommand)
  const slack = useLater(query, SLACK_MIN_LENGTH, SLACK_DELAY_MS, searchSlackMessages)

  const results = local?.results ?? []
  const shownCommand = local !== undefined && command?.text === local.text ? command.value : null
  const max = local?.text === '' ? PALETTE_RECENT : shownCommand !== null ? RESULTS_UNDER_COMMAND : PALETTE_RESULTS
  const localRows = results.flatMap(rowsOf).slice(0, max)
  const rows = local !== undefined && slack?.text === local.text && local.text !== '' ? appendUnseen(localRows, slack.value.map(messageRow), PALETTE_SLACK_RESULTS) : localRows
  const sections: ReadonlyArray<PaletteSection> = [
    ...(shownCommand === null ? [] : [{ heading: 'Juno' as const, items: [commandRow(shownCommand)] }]),
    { heading: local?.text === '' ? ('Recent' as const) : ('Results' as const), items: rows },
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
    if (keystroke !== undefined && keystroke.text === local?.text) {
      typed.current = undefined
      afterPaint(() => measure('juno.palette-results', keystroke.at, { detail: { rows: rows.length } }))
    }
  })

  const onQuery = (next: string) => {
    typed.current = { text: next.trim(), at: performance.now() }
    setQuery(next)
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
 * Answers for older text arrive with their own text, so a late one is never
 * shown against newer typing.
 */
function useLater<A>(
  query: string,
  minLength: number,
  delay: number,
  ask: (target: Registry, text: string) => Promise<{ readonly _tag: 'Success'; readonly value: A } | { readonly _tag: 'Failure' }>,
): { readonly text: string; readonly value: A } | undefined {
  const [answer, setAnswer] = useState<{ readonly text: string; readonly value: A } | undefined>(undefined)
  useEffect(() => {
    const text = query.trim()
    if (text.length < minLength) return
    let live = true
    const timer = setTimeout(() => {
      void ask(registry, text).then((exit) => {
        if (live && exit._tag === 'Success') setAnswer({ text, value: exit.value })
      })
    }, delay)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [query, minLength, delay, ask])
  return answer
}
