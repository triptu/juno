import * as stylex from '@stylexjs/stylex'
import { useState } from 'react'
import { colors } from '@juno/tokens/tokens.stylex'
import { defineFixtures, scene } from '@juno/ui'
import { useFixtureControl } from './juno-chat/fixtures/control'
import { CommandPalette, type PaletteItem, type PaletteSection } from './CommandPalette'

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
  { id: 'c1', icon: 'public', label: '#eng', sub: 'Public channel · Main', opensTab: true, menu: true },
  { id: 'c1-scope', icon: 'scope', label: '#eng', sub: 'Public channel · show its topics', menu: true },
  { id: 't1', icon: 'thread', label: 'Postgres 16 migration plan', sub: '#eng', at: minutes(3), opensTab: true },
  { id: 'm1', icon: 'message', label: 'Staging bill doubled since August', sub: '#eng', snippet: { sender: 'Leo Park', text: 'the engineering budget review moved to Thursday' }, opensTab: true },
  { id: 'm2', icon: 'message', label: '#eng · Main', sub: '#eng', snippet: { sender: 'Maya Chen', text: 'Engineering all-hands notes are in the doc' }, opensTab: true },
]

const command: PaletteItem = { id: 'cmd', icon: 'send', label: 'Send to Maya Chen', sub: '"the wednesday slot works"', badge: '95%', hint: '↵ Send' }

const people: ReadonlyArray<PaletteItem> = [
  { id: 'p1', icon: 'person', label: 'Message Maya Chen', sub: 'Direct message · Main', opensTab: true },
  { id: 'p2', icon: 'person', label: 'Message Maya Lindqvist', sub: 'Starts a conversation' },
]

function Palette({ initial, sections, settled = true }: { readonly initial: string; readonly sections: ReadonlyArray<PaletteSection>; readonly settled?: boolean }) {
  const [query, setQuery] = useState(initial)
  return (
    <div {...stylex.props(styles.window)}>
      <CommandPalette query={query} resultsQuery={query} onQuery={setQuery} sections={sections} settled={settled} now={NOW} onSelect={noop} onMenu={noop} onClose={noop} />
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

export default defineFixtures(
  CommandPalette,
  {
    States: {
      recent: scene(() => <Palette initial="" sections={[{ heading: 'Recent', items: recent }]} />),
      results: scene(() => <Palette initial="eng" sections={[{ heading: 'Results', items: results }]} />),
      command: scene(() => <Palette initial="tell maya the wednesday slot works" sections={[{ heading: 'Juno', items: [command] }, { heading: 'Results', items: people }]} />),
      overflowing: scene(() => <Palette initial="eng" sections={[{ heading: 'Results', items: [...results, ...recent] }]} />),
      people: scene(() => <Palette initial="maya" sections={[{ heading: 'Results', items: people }]} />),
      'no-matches': scene(() => <Palette initial="zebra crossing" sections={[]} />),
      waiting: scene(() => <Palette initial="zebra" sections={[]} settled={false} />),
    },
    Interaction: {
      updates: scene(() => <UpdatingResults />),
      'hover-second': scene(() => <Palette initial="eng" sections={[{ heading: 'Results', items: results }]} />, { hover: '#palette-c1-scope' }),
    },
  },
  { width: 760, height: 620 },
)
