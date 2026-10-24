import { defineFixtures, scene, type FixtureFrame } from '@juno/ui'
import type { SearchGroup, SearchHit, SearchPlace } from '@juno/contract'
import { ComposerSlot } from '../ComposerSlot'
import { PrivacyOn } from '../fixtures/privacy'
import { details, thread } from '../fixtures/messages'
import { NOW, people } from '../fixtures/topics'
import { MessageList } from '../MessageList'
import { TopicHeader, type TopicHeaderReader } from '../TopicHeader'
import { TopicView } from '../TopicView'
import type { SearchChipView, SearchPickerRow } from './model'
import { searchRows } from './rows'
import { SearchField } from './SearchField'
import type { SearchFieldPicker } from './SearchPicker'
import { SearchFilters } from './SearchFilters'
import { SearchPage, type SearchPageProps } from './SearchPage'
import { SearchResults, type SearchListState } from './SearchResults'
import type { RecentSearchView } from './SearchRecent'

const noop = () => {}
const HOUR = 3_600_000
const DAY = 24 * HOUR

const place = (id: string, name: string, kind: SearchPlace['kind'] = 'public'): SearchPlace => ({ id, kind, name, label: kind === 'im' ? name : `#${name}`, tint: kind === 'im' ? 'dm' : kind === 'private' ? 'private' : 'public', icon: 'hash', color: 'jordy' })
const legal = place('C0LEGAL', 'legal', 'private')
const procurement = place('C0PROC', 'procurement')
const ops = place('C0OPS', 'ops')

/** A match `ago` ms before the fixtures' now; the snippet's ranges mark "vendor contract". */
function hit(id: string, topicId: string, title: string, where: SearchPlace, sender: string, text: string, ago: number): SearchHit {
  const start = text.toLowerCase().indexOf('vendor contract')
  const ts = ((NOW - ago) / 1000).toFixed(6)
  return { kind: 'message', id: `${where.id}:${id}`, topicId, title, ts, place: where, sender, text, stored: true, ranges: start < 0 ? [] : [{ start, end: start + 'vendor contract'.length }] }
}

const acme = 't:C0LEGAL:1'
const matches = {
  redline: hit('1', acme, 'Acme MSA renewal terms', legal, 'Maya Chen', '…the redlined vendor contract back to Acme this morning', 2 * HOUR),
  caps: hit('2', acme, 'Acme MSA renewal terms', legal, 'Maya Chen', 'The vendor contract caps the price rise at 4% a year', DAY + HOUR),
  older1: hit('3', acme, 'Acme MSA renewal terms', legal, 'Maya Chen', 'Agreed. I’ll send the vendor contract back once Priya signs off', DAY + 2 * HOUR),
  older2: hit('4', acme, 'Acme MSA renewal terms', legal, 'Maya Chen', 'On it. I’ll compare them against last year’s vendor contract', 2 * DAY),
  procure: hit('5', 'm:C0PROC', '#procurement · Main', procurement, 'Maya Chen', '…every new vendor contract goes through legal first', 3 * DAY),
  northwind: hit('6', 'm:C0PROC', '#procurement · Main', procurement, 'Maya Chen', 'Northwind’s vendor contract is signed', 5 * DAY),
  onboarding: hit('7', 't:C0OPS:7', 'Northwind onboarding', ops, 'Maya Chen', '…check the vendor contract for the laptop lease terms', 4 * DAY),
  cleaning: hit('8', 't:C0OPS:8', 'Office cleaning renewal', ops, 'Maya Chen', 'The old vendor contract ends in October', 36 * DAY),
}

const group = (id: string, kind: SearchGroup['kind'], messages: ReadonlyArray<SearchHit>, older = false, title?: { readonly text: string; readonly where: SearchPlace; readonly ago: number }): SearchGroup => {
  const first = messages[0]
  return {
    id,
    kind,
    topicId: first?.topicId ?? id,
    title: title?.text ?? first?.title ?? '',
    titleRanges: title === undefined ? [] : [{ start: 0, end: 'Vendor contract'.length }],
    place: title?.where ?? first?.place ?? legal,
    at: first?.ts ?? ((NOW - (title?.ago ?? 0)) / 1000).toFixed(6),
    messages,
    older,
    matchCount: messages.length,
  }
}

const template = group('t:C0LEGAL:9', 'topic', [], false, { text: 'Vendor contract template for 2027', where: legal, ago: 6 * DAY })
const flat: ReadonlyArray<SearchGroup> = [
  ...[matches.redline, matches.caps, matches.older1, matches.older2].map((m) => group(`flat:${m.id}`, 'thread', [m])),
  group('flat:5', 'main', [matches.procure]),
  group('flat:7', 'thread', [matches.onboarding]),
  group('flat:6', 'main', [matches.northwind]),
  template,
  group('flat:8', 'thread', [matches.cleaning], true),
]
const grouped: ReadonlyArray<SearchGroup> = [
  group(acme, 'thread', [matches.redline, matches.caps, matches.older1, matches.older2]),
  group('main:5', 'main', [matches.procure, matches.northwind]),
  group('t:C0OPS:7', 'thread', [matches.onboarding]),
  template,
  group('older:t:C0OPS:8', 'thread', [matches.cleaning], true),
]

const maya = { ...people.maya, name: 'Maya Chen' }
const fromMaya: SearchChipView = { key: '0:from:U0MAYA', op: 'from', label: 'Maya Chen', person: maya }
const recent: ReadonlyArray<RecentSearchView> = [
  { chips: [{ key: 'a', op: 'from', label: 'Maya Chen' }], text: 'vendor contract' },
  { chips: [], text: 'replica lag' },
  { chips: [{ key: 'b', op: 'in', label: 'legal' }, { key: 'c', op: 'has', label: 'file' }], text: 'Acme' },
  { chips: [], text: '"badge readers"' },
  { chips: [{ key: 'd', op: 'in', label: 'ops' }, { key: 'e', op: 'date', label: 'Last week' }], text: 'on-call' },
]
const pickRows: ReadonlyArray<SearchPickerRow> = [
  { id: 'C0PROC', name: 'procurement', kind: 'public', highlight: [[0, 3]] },
  { id: 'C0PROCL', name: 'procurement-leads', kind: 'private', highlight: [[0, 3]] },
  { id: 'C0PROJ', name: 'proj-mobile-app', kind: 'public', highlight: [[0, 3]] },
  { id: 'D0LEO', name: 'Leo Prokopenko', kind: 'im', person: { id: 'U0LP', name: 'Leo Prokopenko', color: 'claret' }, highlight: [[4, 7]] },
  { id: 'C0PRODUCT', name: 'product', kind: 'public', highlight: [[0, 3]] },
]

interface Scene {
  readonly chips?: ReadonlyArray<SearchChipView>
  readonly text?: string
  readonly groups?: ReadonlyArray<SearchGroup> | undefined
  readonly grouped?: boolean
  readonly state?: SearchListState
  readonly selected?: string
  readonly reader?: boolean
  readonly step?: TopicHeaderReader['step']
  readonly picker?: SearchFieldPicker
  readonly hidden?: { readonly count: number; readonly apps: boolean; readonly automated: boolean }
  readonly page?: Partial<SearchPageProps>
  readonly set?: { readonly from: boolean; readonly in: boolean; readonly date: boolean; readonly has: boolean }
}

/** The reader: the fixtures' thread as a topic shows it, with the reader's header. */
function Reader({ step, back }: { readonly step?: TopicHeaderReader['step'] | undefined; readonly back: boolean }) {
  const header: TopicHeaderReader = { onOpenInNewTab: noop, ...(step === undefined ? {} : { step }), ...(back ? { onBack: noop } : {}) }
  return (
    <TopicView header={<TopicHeader detail={details.postgres} onMenu={noop} onPill={noop} onResolve={noop} reader={header} />} composer={<ComposerSlot placeholder="Reply" />}>
      <MessageList items={thread.slice(-6)} main={false} now={NOW} onOpenThread={noop} onOpenReply={noop} onChannel={noop} onLink={noop} />
    </TopicView>
  )
}

function SearchScene({ chips = [fromMaya], text = 'vendor contract', groups = flat, grouped: isGrouped = false, state = 'done', selected, reader = true, step, picker, hidden, page, set }: Scene) {
  const empty = chips.length === 0 && text === ''
  const rows = empty || groups === undefined ? undefined : searchRows(groups, isGrouped, groups.findIndex((g) => g.older) < 0 ? groups.length : groups.findIndex((g) => g.older), new Set())
  return (
    <SearchPage
      field={<SearchField chips={chips} text={text} onText={noop} onChip={noop} onRemoveChip={noop} onClear={noop} onKeyDown={noop} picker={picker} />}
      filters={<SearchFilters set={set ?? { from: chips.some((c) => c.op === 'from'), in: chips.some((c) => c.op === 'in' || c.op === 'topic'), date: false, has: false }} sort="newest" groupByThread={isGrouped} hideApps hideAutomated onMenu={noop} onToggle={noop} />}
      results={
        <SearchResults
          rows={rows}
          state={state}
          words={text}
          filtered={chips.length > 0}
          hidden={hidden ?? { count: 0, apps: true, automated: true }}
          selectedId={selected}
          focused
          now={NOW}
          recent={recent}
          onSelect={noop}
          onOpen={noop}
          onExpand={noop}
          onLeaveTop={noop}
          onTab={() => false}
          onType={noop}
          onTryAgain={noop}
          onClearFilters={noop}
          onShowHidden={noop}
          onRecent={noop}
          onForgetRecent={noop}
          onPalette={noop}
        />
      }
      reader={reader ? <Reader step={step} back={page?.readerShown === true} /> : null}
      readerShown={false}
      columnWidth={384}
      onResizeColumn={noop}
      onResetColumn={noop}
      {...page}
    />
  )
}

const FRAME: FixtureFrame = { width: 1280, height: 760, padded: false }
const page = (props: Scene = {}, frame: FixtureFrame = FRAME) => scene<SearchPageProps>(() => <SearchScene {...props} />, frame)
const step = { index: 2, count: 4, onPrevious: noop, onNext: noop }

export default defineFixtures(
  SearchPage,
  {
    Results: {
      // Flat, the default: one row per match, newest first; the selected match in the reader with "2 of 4".
      flat: page({ selected: matches.caps.id, step }),
      // Group by thread: the thread's topic line, two match lines and "2 more in this thread"; Main matches under one header.
      grouped: page({ groups: grouped, grouped: true, selected: matches.caps.id, step }),
      // ⌘F in a thread: its chip leads the field, In shows set.
      scoped: page({ chips: [{ key: 'topic', op: 'topic', label: 'Acme MSA renewal terms', topic: { id: acme } }], text: 'notice period', groups: [matches.redline, matches.caps, matches.older1].map((m) => group(`flat:${m.id}`, 'thread', [m])), selected: matches.caps.id, step }),
      // in: typed: the picker under the operator, ⌘K's Conversations rows.
      picker: page({ chips: [], text: 'vendor contract in:pro', picker: { at: 16, heading: 'Conversations', rows: pickRows, onPick: noop, onClose: noop }, reader: false }),
    },
    State: {
      // The empty field: recent searches, the operators and ⌘K.
      empty: page({ chips: [], text: '', reader: false }),
      // Local rows first, and one quiet line where Slack's will join.
      searching: page({ state: 'searching', groups: flat.slice(0, 4), reader: false }),
      // Slack did not answer: the local rows stay, with Try again.
      'slack-unavailable': page({ state: 'slackUnavailable', groups: flat.slice(0, 3), reader: false }),
      // Nothing matches with a filter set: Clear filters.
      'no-matches': page({ chips: [{ key: 'in', op: 'in', label: 'legal', place: { kind: 'private' } }], text: 'foo', groups: [], reader: false }),
      // Only apps and automated channels match: how many, and one button.
      'only-hidden': page({ chips: [], text: 'deploy failed', groups: [], state: 'onlyHidden', hidden: { count: 4, apps: true, automated: true }, reader: false }),
      offline: page({ state: 'offline', groups: flat.slice(0, 3), reader: false }),
      // Privacy mode: the query, chips, titles and snippets blur.
      privacy: scene<SearchPageProps>(() => (
        <PrivacyOn>
          <SearchScene selected={matches.caps.id} step={step} />
        </PrivacyOn>
      ), FRAME),
    },
    Size: {
      // Under 792px for the page: one column, the list.
      'one-column': page({ selected: matches.caps.id, reader: true }, { width: 720, height: 640, padded: false }),
      // One column with the reader shown: Back to results leads its header.
      'one-column-reader': page({ selected: matches.caps.id, step, page: { readerShown: true } }, { width: 720, height: 640, padded: false }),
      // The minimum window: the toggles wrap to their own line; the header keeps Back, the place icon, the title, the arrows and ⋯.
      'minimum-window': page({ selected: matches.caps.id, step, page: { readerShown: true } }, { width: 400, height: 640, padded: false }),
    },
  },
  FRAME,
)
