/**
 * ⌘K (spec section 10, inventory 9, performance 5.3), in two tabs.
 *
 * Conversations, the default: DMs, group DMs and channels from
 * `paletteConversationsAtom`, by use with an empty query; the commands
 * that match the text (`paletteCommands.ts`), or all of them after a
 * leading ">", with the open topic's own commands first under its name.
 *
 * Messages: the message search. Local results come from `searchAtom`;
 * after a pause in typing, Slack's search is asked for and its matches are
 * added under the rows already shown, never moving them.
 *
 * Both tabs' local rows follow the text through `useDeferredValue`, so a
 * keystroke paints the text at once and the rows follow in the same frame
 * budget, and switching tabs shows rows that are already there. The
 * command reading is asked for after a pause in typing and shows as
 * "Juno": above the Messages results, under the conversations. Rows open
 * topics (at a message, which then flashes), a channel's Main or a
 * person's DM, narrow the sidebar, start a New chat to someone never
 * messaged, or run a command. Its own chunk: `Palette.tsx` loads it on
 * idle after the first paint.
 */
import { useDeferredValue, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ConversationKind, PaletteCommand, PickConversation, SearchChannel, SearchMessage, SearchPerson, SearchResult } from '@juno/contract'
import {
  appendUnseen,
  COMMAND_DELAY_MS,
  loadOlderMessages,
  nowAtom,
  PALETTE_RECENT,
  PALETTE_RESULTS,
  PALETTE_SLACK_RESULTS,
  paletteConversationsAtom,
  paletteTabAtom,
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
import { CommandPalette, type PaletteIconName, type PaletteItem, type PaletteSection, type PaletteTab } from '@juno/views'
import { junoCommands, openJunoTab } from './juno/actions'
import { openNewChatTo, openTopic, openTopicAt, warmTopic } from './navigation'
import { closePalette } from './paletteActions'
import { globalCommands, matchCommands, topicCommands, type CommandRow } from './paletteCommands'
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
  /** It opens nothing that takes focus, so closing gives focus back to where it was. */
  readonly stays?: boolean
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

/** A Conversations row: its Main, or a New chat to a person never messaged. */
const conversationRow = (pick: PickConversation): Row => {
  const mainId = pick.mainId
  return {
    id: `conversation:${pick.key}`,
    icon: placeIcon[pick.kind],
    label: pick.name,
    compact: true,
    ...(pick.person === undefined ? {} : { person: pick.person }),
    ...(mainId === undefined ? { sub: 'Starts a conversation' } : { opensTab: true, topicId: mainId }),
    run: (options) => (mainId === undefined ? openNewChatTo(pick) : openTopic(mainId, options)),
  }
}

const commandRunRow = (command: CommandRow): Row => ({ ...command, run: () => command.run() })

/** Commands shown beside conversations when the text is not a ">" listing. */
const COMMANDS_WITH_TEXT = 4

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

/**
 * The rows of the last text that has results, held until the next text's
 * arrive, so typing never flashes an empty list. `settled` when they
 * belong to the current text.
 */
function useHeld<A>(request: Query, deferred: Query, result: { readonly _tag: string; readonly value?: A }): { readonly local: { readonly request: Query; readonly value: A } | undefined; readonly settled: boolean } {
  const [held, setHeld] = useState<{ readonly request: Query; readonly value: A } | undefined>(undefined)
  const current = deferred === request && result._tag === 'Success'
  if (current && (held?.request !== request || held.value !== result.value)) setHeld({ request, value: result.value as A })
  const local = current ? { request, value: result.value as A } : held
  return { local, settled: local?.request === request }
}

/** The text after a leading ">", or undefined when the text lists no commands. */
function commandListing(text: string): string | undefined {
  const start = text.trimStart()
  return start.startsWith('>') ? start.slice(1) : undefined
}

/** The palette while it is open: mounted on open, so each open starts empty, on Conversations. */
export function OpenPalette() {
  const tab = useAtomValue(paletteTabAtom)
  const [request, setRequest] = useState<Query>({ text: '' })
  const query = request.text
  const deferred = useDeferredValue(request)
  const listing = commandListing(deferred.text)
  const messages = useHeld(request, deferred, useAtomValue(searchAtom(deferred.text)))
  const conversations = useHeld(request, deferred, useAtomValue(paletteConversationsAtom(listing === undefined ? deferred.text : '')))
  const now = useAtomValue(nowAtom)
  // What the commands act on is read once, as the palette opens.
  const [commands] = useState(() => ({ global: globalCommands(), topic: topicCommands() }))

  const command = useLater(request, commandListing(request.text) === undefined ? COMMAND_MIN_LENGTH : Infinity, COMMAND_DELAY_MS, readCommand)
  const slack = useLater(request, tab === 'messages' ? SLACK_MIN_LENGTH : Infinity, SLACK_DELAY_MS, searchSlackMessages)

  const conversationsTab = tab === 'conversations'
  const listingNow = commandListing(request.text)
  const settled = conversationsTab ? listingNow !== undefined || conversations.settled : messages.settled
  // Rows held from a ">" listing are the empty query's: they show as Frequent until the new text's arrive.
  const heldConversations = conversations.local?.request.text ?? ''
  const shownText = conversationsTab
    ? listingNow !== undefined
      ? request.text.trim()
      : commandListing(heldConversations) === undefined
        ? heldConversations.trim()
        : ''
    : (messages.local?.request.text.trim() ?? '')
  const shownCommand = settled ? (command ?? null) : null

  let sections: ReadonlyArray<PaletteSection>
  let rows: ReadonlyArray<Row>
  if (conversationsTab) {
    const topic = commands.topic
    if (listingNow !== undefined) {
      const topicRows = topic === undefined ? [] : matchCommands(topic.rows, listingNow).map(commandRunRow)
      const globalRows = matchCommands(commands.global, listingNow).map(commandRunRow)
      sections = [...(topic === undefined ? [] : [{ key: 'topic', heading: topic.heading, items: topicRows }]), { heading: 'Commands', items: globalRows }]
      rows = [...topicRows, ...globalRows]
    } else if (shownText === '') {
      const found = (conversations.local?.value ?? []).map(conversationRow)
      sections = [{ heading: 'Frequent', items: found }]
      rows = found
    } else {
      const topicRows = topic === undefined ? [] : matchCommands(topic.rows, shownText).slice(0, COMMANDS_WITH_TEXT).map(commandRunRow)
      const found = (conversations.local?.value ?? []).map(conversationRow)
      const globalRows = matchCommands(commands.global, shownText).slice(0, COMMANDS_WITH_TEXT).map(commandRunRow)
      const juno = shownCommand === null ? [] : [commandRow(shownCommand)]
      sections = [
        ...(topic === undefined ? [] : [{ key: 'topic', heading: topic.heading, items: topicRows }]),
        { heading: 'Conversations', items: found },
        { heading: 'Commands', items: globalRows },
        { heading: 'Juno', items: juno },
      ]
      rows = [...topicRows, ...found, ...globalRows, ...juno]
    }
  } else {
    const results = messages.local?.value ?? []
    const max = shownText === '' ? PALETTE_RECENT : shownCommand !== null ? RESULTS_UNDER_COMMAND : PALETTE_RESULTS
    const localRows = results.flatMap(rowsOf).slice(0, max)
    const found = messages.settled && slack !== undefined && query.trim() !== '' ? appendUnseen(localRows, slack.map(messageRow), PALETTE_SLACK_RESULTS) : localRows
    const juno = shownCommand === null ? [] : [commandRow(shownCommand)]
    sections = [{ heading: 'Juno', items: juno }, { heading: shownText === '' ? 'Recent' : 'Results', items: found }]
    rows = [...juno, ...found]
  }
  const byId = new Map<string, Row>(rows.map((row) => [row.id, row]))

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
    if (keystroke !== undefined && keystroke.text === shownText) {
      typed.current = undefined
      afterPaint(() => measure('juno.palette-results', keystroke.at, { detail: { rows: rows.length } }))
    }
  })

  const onQuery = (next: string) => {
    typed.current = { text: next.trim(), at: performance.now() }
    setRequest({ text: next })
  }

  const onTab = (next: PaletteTab) => registry.set(paletteTabAtom, next)

  const onSelect = (id: string, options: { readonly newTab: boolean }) => {
    const row = byId.get(id)
    if (row === undefined) return
    closePalette(row.stays === true)
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
      tab={tab}
      onTab={onTab}
      query={query}
      resultsQuery={shownText}
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
