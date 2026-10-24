import * as stylex from '@stylexjs/stylex'
import { useState } from 'react'
import { colors } from '@juno/tokens/tokens.stylex'
import { defineFixtures, scene } from '@juno/ui'
import { useFixtureControl } from './juno-chat/fixtures/control'
import { CommandPalette, type PaletteItem, type PaletteSection, type PaletteTab } from './CommandPalette'

const NOW = Date.UTC(2026, 9, 15, 15, 0)
const minutes = (n: number) => NOW - n * 60_000
const noop = () => {}

const recent: ReadonlyArray<PaletteItem> = [
  { id: 'r1', icon: 'thread', label: 'Postgres 16 migration plan', sub: '#eng', at: minutes(3), opensTab: true },
  { id: 'r2', icon: 'public', label: '#alerts-prod · Main', sub: '#alerts-prod', at: minutes(12), opensTab: true },
  { id: 'r3', icon: 'thread', label: 'Pricing page copy', sub: '#product', at: minutes(48), opensTab: true },
  { id: 'r4', icon: 'dm', label: 'Maya Chen · Main', sub: 'Maya Chen', at: minutes(130), opensTab: true },
  { id: 'r5', icon: 'thread', label: 'Staging bill doubled since August', sub: '#eng', at: minutes(60 * 26), opensTab: true },
  { id: 'r6', icon: 'private', label: 'Offsite venues', sub: '#leads', at: minutes(60 * 24 * 3), opensTab: true },
]

const results: ReadonlyArray<PaletteItem> = [
  { id: 'c1', icon: 'thread', label: 'Eng offsite agenda', labelHighlight: [[0, 3]], sub: '#leads', at: minutes(40), opensTab: true },
  { id: 't1', icon: 'thread', label: 'Postgres 16 migration plan', sub: '#eng', snippet: { sender: 'Dev Patel', text: 'The eng review is Thursday at 10', highlight: [[4, 7]] }, opensTab: true },
  { id: 'm1', icon: 'thread', label: 'Staging bill doubled since August', sub: '#eng', snippet: { sender: 'Leo Park', text: 'the engineering budget review moved to Thursday', highlight: [[4, 7]] }, opensTab: true },
  { id: 'm2', icon: 'public', label: '#eng · Main', sub: '#eng', snippet: { sender: 'Maya Chen', text: 'Engineering all-hands notes are in the doc', highlight: [[0, 3]] }, opensTab: true },
]

const searchRow = (text: string): PaletteItem => ({ id: 'search-all', icon: 'search', label: `All results for “${text}”`, shortcut: '⌘⇧F' })

const command: PaletteItem = { id: 'cmd', icon: 'send', label: 'Send to Maya Chen', sub: '"the wednesday slot works"', badge: '95%', hint: '↵ Send' }

const maya = { id: 'U0MAYA', name: 'Maya Chen', color: 'cyan' as const }
const leo = { id: 'U0LEO', name: 'Leo Park', color: 'plum' as const }

const frequent: ReadonlyArray<PaletteItem> = [
  { id: 'v1', icon: 'dm', label: 'Maya Chen', person: maya, compact: true, opensTab: true },
  { id: 'v2', icon: 'public', label: 'eng', compact: true, opensTab: true },
  { id: 'v3', icon: 'private', label: 'leads', compact: true, opensTab: true },
  { id: 'v4', icon: 'group', label: 'Maya, Leo, Rina', compact: true, opensTab: true },
  { id: 'v5', icon: 'dm', label: 'Leo Park', person: leo, compact: true, opensTab: true },
  { id: 'v6', icon: 'public', label: 'alerts-prod', compact: true, opensTab: true },
  { id: 'v7', icon: 'public', label: 'product', compact: true, opensTab: true },
]

const globalCommands: ReadonlyArray<PaletteItem> = [
  { id: 'g1', icon: 'theme-light', label: 'Theme: Light', compact: true },
  { id: 'g2', icon: 'theme-dark', label: 'Theme: Dark', compact: true },
  { id: 'g3', icon: 'theme-system', label: 'Theme: Match system', sub: 'Current', compact: true },
  { id: 'g4', icon: 'theme-system', accent: 'coral', label: 'Accent: Coral', sub: 'Current', compact: true },
  { id: 'g5', icon: 'theme-system', accent: 'teal', label: 'Accent: Teal', compact: true },
  { id: 'g6', icon: 'new-tab', label: 'New tab', hint: '⌘T', compact: true },
  { id: 'g7', icon: 'new-message', label: 'New message', hint: '⌘N', compact: true },
  { id: 'g8', icon: 'settings', label: 'Settings: Appearance', compact: true },
  { id: 'g9', icon: 'hide-text', label: 'Hide message text', hint: '⌃⌘H', compact: true },
  { id: 'g10', icon: 'presence', label: 'Set yourself away', compact: true },
]

const topicCommands: ReadonlyArray<PaletteItem> = [
  { id: 'k1', icon: 'resolve', label: 'Resolve', compact: true },
  { id: 'k2', icon: 'pin', label: 'Pin', compact: true },
  { id: 'k3', icon: 'unread', label: 'Mark as unread', compact: true },
  { id: 'k4', icon: 'juno', label: 'Open Juno panel', hint: '⌘J', compact: true },
  { id: 'k5', icon: 'link', label: 'Copy Slack link', compact: true },
  { id: 'k6', icon: 'open-in-slack', label: 'Open in Slack', compact: true },
  { id: 'k7', icon: 'rename', label: 'Rename thread', compact: true },
]

function Palette({ initial, sections, footer, settled = true, tab: initialTab = 'messages' }: { readonly initial: string; readonly sections: ReadonlyArray<PaletteSection>; readonly footer?: PaletteItem; readonly settled?: boolean; readonly tab?: PaletteTab }) {
  const [query, setQuery] = useState(initial)
  const [tab, setTab] = useState(initialTab)
  return (
    <div {...stylex.props(styles.window)}>
      <CommandPalette tab={tab} onTab={setTab} query={query} resultsQuery={query} onQuery={setQuery} sections={sections} {...(footer === undefined ? {} : { footer })} settled={settled} now={NOW} onSelect={noop} onMenu={noop} onClose={noop} />
    </div>
  )
}

function UpdatingResults() {
  const [items, setItems] = useState(results)
  const [withCommand, setWithCommand] = useState(false)
  const [chosen, setChosen] = useState('')
  useFixtureControl('prepend-command', () => setWithCommand(true))
  useFixtureControl('reverse-results', () => setItems((rows) => rows.toReversed()))
  useFixtureControl('remove-first', () => setItems((rows) => rows.filter((row) => row.id !== 'c1')))
  return (
    <div {...stylex.props(styles.window)}>
      <output hidden data-activation-log="">{chosen}</output>
      <CommandPalette
        tab="messages"
        onTab={noop}
        query="eng"
        resultsQuery="eng"
        onQuery={noop}
        sections={[...(withCommand ? [{ heading: 'Juno' as const, items: [command] }] : []), { heading: 'Results', items }]}
        settled
        now={NOW}
        onSelect={setChosen}
        onClose={noop}
      />
    </div>
  )
}

const styles = stylex.create({
  window: {
    position: 'relative',
    width: '100%',
    height: '100%',
    backgroundColor: colors['--background'],
  },
})

const engConversations: ReadonlyArray<PaletteItem> = [
  { id: 'v2', icon: 'public', label: 'eng', labelHighlight: [[0, 3]], compact: true, opensTab: true },
  { id: 'v8', icon: 'public', label: 'eng-oncall', labelHighlight: [[0, 3]], compact: true, opensTab: true },
  { id: 'v9', icon: 'private', label: 'eng-leads', labelHighlight: [[0, 3]], compact: true, opensTab: true },
]

const engCommands: ReadonlyArray<PaletteItem> = [{ id: 'g11', icon: 'settings', label: 'Settings: General', compact: true }]

export default defineFixtures(
  CommandPalette,
  {
    All: {
      // Each open: the most used conversations, then the latest topics.
      empty: scene(() => (
        <Palette
          tab="all"
          initial=""
          sections={[
            { heading: 'Frequent', hint: '⌘2', items: frequent.slice(0, 4) },
            { heading: 'Recent', hint: '⌘3', items: recent.slice(0, 5) },
          ]}
        />
      )),
      search: scene(() => (
        <Palette
          tab="all"
          initial="eng"
          sections={[
            { heading: 'Conversations', hint: '⌘2', items: engConversations },
            { heading: 'Topics and messages', hint: '⌘3', items: results },
            { key: 'commands', heading: 'Pages, settings and commands', hint: '⌘4', items: engCommands },
          ]}
          footer={searchRow('eng')}
        />
      )),
      // The command reading arrives late, so it sits under the groups.
      command: scene(() => (
        <Palette
          tab="all"
          initial="tell maya the wednesday slot works"
          sections={[
            { heading: 'Conversations', hint: '⌘2', items: [frequent[0]!] },
            { heading: 'Juno', items: [command] },
          ]}
          footer={searchRow('tell maya the wednesday slot works')}
        />
      )),
      'no-matches': scene(() => <Palette tab="all" initial="zebra crossing" sections={[]} footer={searchRow('zebra crossing')} />),
    },
    Conversations: {
      frequent: scene(() => <Palette tab="conversations" initial="" sections={[{ heading: 'Frequent', items: frequent }]} />),
      search: scene(() => <Palette tab="conversations" initial="ma" sections={[{ heading: 'Conversations', items: [frequent[0]!, frequent[3]!] }]} />),
    },
    Commands: {
      all: scene(() => <Palette tab="commands" initial="" sections={[{ heading: 'Commands', items: globalCommands }]} />),
      matching: scene(() => <Palette tab="commands" initial="theme" sections={[{ heading: 'Commands', items: globalCommands.slice(0, 3) }]} />),
      // A topic is open: its commands come first, under its name.
      'topic-commands': scene(() => (
        <Palette
          tab="commands"
          initial=""
          sections={[
            { key: 'topic', heading: 'Postgres 16 migration plan', items: topicCommands },
            { heading: 'Commands', items: globalCommands },
          ]}
        />
      )),
      // A resolved topic offers Reopen, with the header's filled check.
      'resolved-topic-commands': scene(() => (
        <Palette
          tab="commands"
          initial=""
          sections={[{ key: 'topic', heading: 'Postgres 16 migration plan', items: [{ id: 'k1', icon: 'reopen', label: 'Reopen', compact: true }, ...topicCommands.slice(1)] }]}
        />
      )),
    },
    States: {
      recent: scene(() => <Palette initial="" sections={[{ heading: 'Recent', items: recent }]} />),
      results: scene(() => <Palette initial="eng" sections={[{ heading: 'Results', items: results }]} footer={searchRow('eng')} />),
      command: scene(() => <Palette initial="tell maya the wednesday slot works" sections={[{ heading: 'Juno', items: [command] }, { heading: 'Results', items: results.slice(0, 2) }]} footer={searchRow('tell maya the wednesday slot works')} />),
      overflowing: scene(() => <Palette initial="eng" sections={[{ heading: 'Results', items: [...results, ...recent] }]} footer={searchRow('eng')} />),
      // The minimum window (720 by 480): the list gives up height, so the palette ends above the bottom edge.
      'minimum-window': scene(() => <Palette initial="eng" sections={[{ heading: 'Results', items: [...results, ...recent] }]} footer={searchRow('eng')} />, { width: 720, height: 480, padded: false }),
      'no-matches': scene(() => <Palette initial="zebra crossing" sections={[]} footer={searchRow('zebra crossing')} />),
      waiting: scene(() => <Palette initial="zebra" sections={[]} settled={false} />),
    },
    Interaction: {
      updates: scene(() => <UpdatingResults />),
      'hover-second': scene(() => <Palette initial="eng" sections={[{ heading: 'Results', items: results }]} footer={searchRow('eng')} />, { hover: '#palette-t1' }),
      'footer-active': scene(() => <Palette initial="eng" sections={[{ heading: 'Results', items: results }]} footer={searchRow('eng')} />, { hover: '#palette-search-all' }),
    },
  },
  { width: 760, height: 820 },
)
