/**
 * ⌘K (spec section 10, inventory 9, performance 5.3), in four tabs.
 *
 * All, the default: fixed groups of the best of each kind. Conversations
 * (up to 4, from `paletteConversationsAtom`), then Topics and messages (up
 * to 5, from `searchAtom`), then Pages, settings and commands (up to 3, as
 * `paletteCommands.ts` matches them, the open topic's first). With an empty
 * query: Frequent and Recent.
 *
 * Conversations: DMs, group DMs and channels, by use with an empty query.
 * Messages: the quick message list, topics and messages from this Mac
 * only; ⌘K never calls Slack. Commands: the pages, Settings sections and
 * commands, with the open topic's own first under its name. A leading ">"
 * switches to Commands.
 *
 * The local rows follow the text through `useDeferredValue`, so a
 * keystroke paints the text at once and the rows follow in the same frame
 * budget. All waits for both of its sources, so its groups appear together
 * and a later group never pushes down rows already shown. The command
 * reading is asked for after a pause in typing and shows as "Juno": under
 * the rows on All and Conversations, above the results on Messages. Rows
 * open topics (at a message, which then flashes), a channel's Main or a
 * person's DM, open Home addressed to someone never messaged, or run a
 * command. Its own chunk: `Palette.tsx` loads it on idle
 * after the first paint.
 */
import { useDeferredValue, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ConversationKind, PaletteCommand, PickConversation, SearchPerson, SearchResult } from '@juno/contract'
import { COMMAND_DELAY_MS, nowAtom, PALETTE_RECENT, PALETTE_RESULTS, paletteConversationsAtom, paletteTabAtom, readCommand, registry, searchAtom, sendMessage, showToast, type OpenOptions, type Registry } from '@juno/state'
import { afterPaint, measure } from '@juno/state/perf'
import { useAtomMount, useAtomValue } from '@juno/state/react'
import { CommandPalette, type PaletteIconName, type PaletteItem, type PaletteSection, type PaletteTab } from '@juno/views'
import { junoCommands, openJunoTab } from './juno/actions'
import { newMessage, openTopic, openTopicAt, warmTopic } from './navigation'
import { closePalette, notePaletteText } from './paletteActions'
import { openSearch } from './search/open'
import { commandGroups, globalCommands, labelStartsWith, matchCommands, useTopicCommands, type CommandRow } from './paletteCommands'
import { resolveTopic } from './topicActions'
import { showChannelMenu, type MenuChannel } from './placeMenus'

/** A person's result: your Main with them, or Home addressed to them when you have never messaged (spec section 10). */
function openPerson(person: Pick<SearchPerson, 'person' | 'mainId'>, options: OpenOptions): void {
  if (person.mainId !== undefined) return openTopic(person.mainId, options)
  newMessage({ key: `u:${person.person.id}`, name: person.person.name, kind: 'im', tint: 'dm', person: person.person, empty: true })
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

/** Rows under a command on Messages (inventory 9). */
const RESULTS_UNDER_COMMAND = 6
/** The grammar reads nothing shorter (`MIN_COMMAND_LENGTH` in `@juno/domain`). */
const COMMAND_MIN_LENGTH = 4
/** All's groups (inventory 9). */
const ALL_CONVERSATIONS = 4
const ALL_MATCHES = 5
const ALL_COMMANDS = 3

/** A row, and what choosing it does. */
interface Row extends PaletteItem {
  /** The topic it opens, for a prefetch. */
  readonly topicId?: string
  readonly channel?: MenuChannel
  readonly run: (options: OpenOptions) => void
  /** It opens nothing that takes focus, so closing gives focus back to where it was. */
  readonly stays?: boolean
}

const placeIcon: Record<ConversationKind, PaletteIconName> = { public: 'public', private: 'private', im: 'dm', mpim: 'group' }

const ranges = (found: ReadonlyArray<{ readonly start: number; readonly end: number }> | undefined) => found?.map((range) => [range.start, range.end] as const)

/** A topic or message result: the topic's icon, its title and place, and for a message the matched text. Opening a message lands on it, and it flashes. */
function matchRow(result: SearchResult): Row | undefined {
  switch (result.kind) {
    case 'topic': {
      const icon = result.id.startsWith('m:') ? placeIcon[result.place.kind] : 'thread'
      return { id: `topic:${result.id}`, icon, label: result.title, ...(result.ranges === undefined ? {} : { labelHighlight: ranges(result.ranges) }), sub: result.place.label, at: result.at, opensTab: true, topicId: result.id, run: (options) => openTopic(result.id, options) }
    }
    case 'message': {
      const icon = result.topicId.startsWith('m:') ? placeIcon[result.place.kind] : 'thread'
      const snippet = { sender: result.sender, text: result.text, ...(result.ranges === undefined ? {} : { highlight: ranges(result.ranges) }) }
      return { id: `message:${result.id}`, icon, label: result.title, sub: result.place.label, snippet, opensTab: true, topicId: result.topicId, run: (options) => openTopicAt(result.topicId, result.ts, { ...options, flash: true }) }
    }
    // `searchAtom` leaves out places: the palette lists conversations from `paletteConversationsAtom`.
    case 'channel':
    case 'person':
      return undefined
  }
}

/**
 * The rows for topic and message results: one per thread, at its first
 * result. A thread whose title matched shows its first matched message
 * under the title and opens at it. A Main is not one conversation, so each
 * of its messages is a row of its own.
 */
function matchRows(results: ReadonlyArray<SearchResult>): ReadonlyArray<Row> {
  const rows: Array<Row> = []
  const threads = new Map<string, number>()
  for (const result of results) {
    const row = matchRow(result)
    if (row?.topicId === undefined) continue
    const at = row.topicId.startsWith('m:') ? undefined : threads.get(row.topicId)
    if (at === undefined) {
      if (!row.topicId.startsWith('m:')) threads.set(row.topicId, rows.length)
      rows.push(row)
      continue
    }
    const shown = rows[at]
    if (shown !== undefined && shown.snippet === undefined && row.snippet !== undefined) rows[at] = { ...shown, snippet: row.snippet, run: row.run }
  }
  return rows
}

/** A Conversations row: its Main, or Home addressed to a person never messaged. A channel has the channel menu. */
const conversationRow = (pick: PickConversation): Row => {
  const mainId = pick.mainId
  const channel: MenuChannel | undefined =
    pick.channelId !== undefined && (pick.kind === 'public' || pick.kind === 'private')
      ? { id: pick.channelId, kind: pick.kind, name: pick.name, label: `#${pick.name}`, tint: pick.tint, ...(mainId === undefined ? {} : { mainId }) }
      : undefined
  return {
    id: `conversation:${pick.key}`,
    icon: placeIcon[pick.kind],
    label: pick.name,
    ...(pick.highlight === undefined ? {} : { labelHighlight: pick.highlight }),
    compact: true,
    ...(pick.person === undefined ? {} : { person: pick.person }),
    ...(mainId === undefined ? { sub: 'Starts a conversation' } : { opensTab: true, topicId: mainId }),
    // Opens its Main as a preview (SPEC 7, "Not in the channel").
    ...(pick.notJoined === true ? { sub: 'Not joined' } : {}),
    ...(channel === undefined ? {} : { menu: true, channel }),
    run: (options) => (mainId === undefined ? newMessage(pick) : openTopic(mainId, options)),
  }
}

/**
 * The global commands that match `text`, under Pages, Settings and
 * Commands. A group whose first row's label starts with the text moves
 * first, so "theme light" makes Theme: Light the first of them.
 */
function globalSections(rows: ReadonlyArray<CommandRow>, text: string): ReadonlyArray<PaletteSection & { readonly items: ReadonlyArray<CommandRow> }> {
  const sections = commandGroups.map(({ group, heading }) => ({
    key: `commands-${group}`,
    heading,
    items: matchCommands(
      rows.filter((candidate) => candidate.group === group),
      text,
    ),
  }))
  const leads = (section: (typeof sections)[number]) => Number(section.items[0] !== undefined && labelStartsWith(section.items[0], text))
  return sections.toSorted((a, b) => leads(b) - leads(a))
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

/** Closes the palette and does what the row does. */
function runRow(row: Row, options: { readonly newTab: boolean }): void {
  closePalette(row.stays === true)
  row.run(options.newTab ? { newTab: true } : {})
}

/** Each edit owns its async answers, including when the same text is typed again. */
interface Query {
  readonly text: string
}

interface PaletteAnswer {
  /** What produced it: when one changes, the answer is new. */
  readonly inputs: ReadonlyArray<unknown>
  readonly text: string
  readonly sections: ReadonlyArray<PaletteSection>
  readonly rows: ReadonlyArray<Row>
}

/** The text after a leading ">", or undefined when the text does not start with one. */
function commandListing(text: string): string | undefined {
  const start = text.trimStart()
  return start.startsWith('>') ? start.slice(1) : undefined
}

/** The palette while it is open: mounted on open, so each open starts empty, on All. */
export function OpenPalette() {
  const tab = useAtomValue(paletteTabAtom)
  const [request, setRequest] = useState<Query>({ text: '' })
  const query = request.text
  const deferredRequest = useDeferredValue(request)
  // Clearing goes straight to the empty-query state, whose subscriptions stay warm while open.
  const deferred = query.trim() === '' ? request : deferredRequest
  useAtomMount(searchAtom(''))
  useAtomMount(paletteConversationsAtom(''))
  const messages = useAtomValue(searchAtom(deferred.text))
  const conversations = useAtomValue(paletteConversationsAtom(deferred.text))
  const now = useAtomValue(nowAtom)
  // What the global commands act on is read once, as the palette opens.
  const [globalRows] = useState(globalCommands)
  const topic = useTopicCommands()

  const command = useLater(request, tab === 'commands' ? Infinity : COMMAND_MIN_LENGTH, COMMAND_DELAY_MS, readCommand)

  const current = deferred === request
  const needsConversations = tab === 'all' || tab === 'conversations'
  const needsMatches = tab === 'all' || tab === 'messages'
  const settled = tab === 'commands' || (current && (!needsConversations || conversations._tag === 'Success') && (!needsMatches || messages._tag === 'Success'))
  const shownText = tab === 'commands' ? request.text.trim() : deferred.text.trim()
  const shownCommand = settled && tab !== 'commands' ? (command ?? null) : null

  const conversationsValue = conversations._tag === 'Success' ? conversations.value : undefined
  const messagesValue = messages._tag === 'Success' ? messages.value : undefined
  const conversationRows = (conversationsValue ?? []).map(conversationRow)
  const matches = matchRows(messagesValue ?? [])
  const juno = shownCommand === null ? [] : [commandRow(shownCommand)]
  let sections: ReadonlyArray<PaletteSection & { readonly items: ReadonlyArray<Row> }>
  switch (tab) {
    case 'all': {
      if (shownText === '') {
        sections = [
          { heading: 'Frequent', hint: '⌘2', items: conversationRows.slice(0, ALL_CONVERSATIONS) },
          { heading: 'Recent', hint: '⌘3', items: matches.slice(0, ALL_MATCHES) },
        ]
        break
      }
      // The open topic's commands first, then the global ones as the Commands tab orders them.
      const commandRows = [...(topic === undefined ? [] : matchCommands(topic.rows, shownText)), ...globalSections(globalRows, shownText).flatMap((section) => section.items)]
      sections = [
        { heading: 'Conversations', hint: '⌘2', items: conversationRows.slice(0, ALL_CONVERSATIONS) },
        { heading: 'Topics and messages', hint: '⌘3', items: matches.slice(0, ALL_MATCHES) },
        { key: 'commands', heading: 'Pages, settings and commands', hint: '⌘4', items: commandRows.slice(0, ALL_COMMANDS) },
        { heading: 'Juno', items: juno },
      ]
      break
    }
    case 'conversations':
      sections = shownText === '' ? [{ heading: 'Frequent', items: conversationRows }] : [{ heading: 'Conversations', items: conversationRows }, { heading: 'Juno', items: juno }]
      break
    case 'messages': {
      const max = shownText === '' ? PALETTE_RECENT : juno.length > 0 ? RESULTS_UNDER_COMMAND : PALETTE_RESULTS
      sections = [
        { heading: 'Juno', items: juno },
        { heading: shownText === '' ? 'Recent' : 'Topics and messages', items: matches.slice(0, max) },
      ]
      break
    }
    case 'commands':
      sections = [...(topic === undefined ? [] : [{ key: 'topic', heading: topic.heading, items: matchCommands(topic.rows, shownText) }]), ...globalSections(globalRows, shownText)]
      break
  }
  const rows = sections.flatMap((section) => section.items)
  // Hold the whole rendered answer per tab, including empty and command
  // states. A delayed answer for the new edit may arrive before its local
  // query does.
  const [answers, setAnswers] = useState<Partial<Record<PaletteTab, PaletteAnswer>>>({})
  const previous = answers[tab]
  const inputs = [request, needsConversations ? conversationsValue : undefined, needsMatches ? messagesValue : undefined, command]
  const fresh: PaletteAnswer = { inputs, text: shownText, sections, rows }
  if (settled && (previous === undefined || previous.inputs.some((input, at) => input !== inputs[at]))) {
    setAnswers({ ...answers, [tab]: fresh })
  }
  // Before its sources settle, a tab shows its last answer, or nothing: the local commands alone would take the first selection.
  const answer = settled ? fresh : (previous ?? { ...fresh, sections: [], rows: [] })
  const resultsReady = settled || previous !== undefined
  const byId = new Map<string, Row>(answer.rows.map((row) => [row.id, row]))

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

  const onQuery = (typedText: string) => {
    notePaletteText(typedText)
    // A leading ">" lists the commands: it switches to Commands, and the field keeps what follows it.
    const listing = commandListing(typedText)
    if (listing !== undefined) registry.set(paletteTabAtom, 'commands')
    const next = listing ?? typedText
    typed.current = { text: next.trim(), at: performance.now() }
    setRequest({ text: next })
  }

  const onTab = (next: PaletteTab) => registry.set(paletteTabAtom, next)

  // The last row on All and Messages takes the text to the Search tab (SPEC 10a).
  const footer = (tab === 'all' || tab === 'messages') && query.trim() !== '' ? searchRow(query.trim()) : undefined
  const onSelect = (id: string, options: { readonly newTab: boolean }) => {
    if (id === SEARCH_ROW) {
      closePalette(false)
      return openSearch({ text: query, ...(options.newTab ? { newTab: true } : {}) })
    }
    const row = byId.get(id)
    if (row !== undefined) runRow(row, options)
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
      resultsQuery={answer.text}
      onQuery={onQuery}
      sections={answer.sections}
      {...(footer === undefined ? {} : { footer })}
      settled={settled}
      resultsReady={resultsReady}
      now={now}
      onSelect={onSelect}
      onActiveChange={(id) => {
        const topicId = byId.get(id)?.topicId
        if (topicId !== undefined) warmTopic(topicId)
      }}
      onMenu={onMenu}
      onClose={() => closePalette()}
    />
  )
}

const SEARCH_ROW = 'search-all'

/** "All results for …", with ⌘⇧F, which does the same. */
const searchRow = (text: string): PaletteItem => ({ id: SEARCH_ROW, icon: 'search', label: `All results for “${text}”`, shortcut: '⌘⇧F' })

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
