import { defineFixtures, scene, type FixtureFrame } from '@juno/ui'
import type { BodyBlock, BodyInline, FileView, Person, ReactionView, SearchCard, SearchGroup, SearchHit, SearchPlace } from '@juno/contract'
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
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const place = (id: string, name: string, kind: SearchPlace['kind'] = 'public'): SearchPlace => ({ id, kind, name, label: kind === 'im' || kind === 'mpim' ? name : `#${name}`, tint: kind === 'im' || kind === 'mpim' ? 'dm' : kind === 'private' ? 'private' : 'public', icon: 'hash', color: 'jordy' })
const kestrel = place('C0KESTREL', 'proj-kestrel', 'private')
const feedback = place('C0FEEDBACK', 'in-app-feedback')
const bugs = place('C0BUGS', 'bugs')
const founders = place('C0FOUNDERS', 'founders', 'private')
const backend = place('C0BACKEND', 'backend')
const dmDev = place('D0DEV', 'Dev Patel', 'im')
const gdm = place('G0MAYALEO', 'Maya, Leo', 'mpim')

const intake: Person = { id: 'bot:C0FEEDBACK:1', name: 'Intake', color: 'jordy', unreachable: true }

// Bodies, as the engine builds them from Slack's blocks.
const t = (text: string, bold = false): BodyInline => (bold ? { kind: 'text', text, style: { bold: true } } : { kind: 'text', text })
const p = (...children: ReadonlyArray<BodyInline | string>): BodyBlock => ({ kind: 'paragraph', children: children.map((child) => (typeof child === 'string' ? t(child) : child)) })
const you: BodyInline = { kind: 'user', id: 'U0ME', name: 'Tushar', isMe: true }
const mention = (person: Person): BodyInline => ({ kind: 'user', id: person.id, name: person.name, isMe: false })
const link = (url: string): BodyInline => ({ kind: 'link', url: `https://${url}`, text: url })

const done: ReactionView = { name: 'white_check_mark', count: 1, me: false, unicode: '✅' }
const eyes: ReactionView = { name: 'eyes', count: 2, me: true, unicode: '👀' }
const figma: FileView = { id: 'F0FIG', name: 'kestrel-onboarding-v3.fig', kind: 'file', size: 4_200_000 }
const screenshot: FileView = { id: 'F0PNG', name: 'sync-stuck.png', kind: 'image', mimetype: 'image/png', size: 320_000 }

const card = (sender: Person, blocks: ReadonlyArray<BodyBlock>, more: Partial<SearchCard> = {}): SearchCard => ({ body: { blocks }, files: [], reactions: [], sender, app: false, reply: false, ...more })

/** A match `ago` ms before the fixtures' now, with its card. */
function hit(id: string, topicId: string, title: string, where: SearchPlace, ago: number, matched: SearchCard): SearchHit {
  const ts = ((NOW - ago) / 1000).toFixed(6)
  return { kind: 'message', id: `${where.id}:${id}`, topicId, title, ts, place: where, sender: matched.sender.name, senderId: matched.sender.id, text: '', stored: true, ranges: [], card: matched }
}

const slower = 't:C0KESTREL:1'
const sleep = 't:C0FEEDBACK:1'
const matches = {
  question: hit('11', slower, 'Kestrel got slower this week', kestrel, 25 * MINUTE, card(people.priya, [p('Could you check how many of the people who signed up last week have opened Kestrel since? I’d like to compare it with the month before, and see whether the slower sync is putting new people off.')], { reply: true })),
  numbers: hit('12', slower, 'Kestrel got slower this week', kestrel, 4 * MINUTE, card(people.maya, [p('Of the 640 people who signed up Oct 12–18, 47 opened Kestrel and 15 sent a message. The week before it was 61 of 590.')], { reply: true })),
  report: hit('1', sleep, 'Kestrel stops syncing after sleep', feedback, DAY + 2 * HOUR, card(intake, [
    p(t('Bug: Kestrel stops syncing after the laptop wakes from sleep', true)),
    p(t('What happened: ', true), 'I closed the lid with a sync running and opened it an hour later. The status said “Up to date”, but nothing new came in until I quit and reopened the app.'),
    p(t('What I expected: ', true), 'the sync to pick up where it left off, or at least to say that it had stopped.'),
    p(t('Context: ', true), 'macOS 15.1 on a fairly new MacBook Air. It happened twice this week, both times after more than half an hour asleep. Reopening the app always fixed it.'),
    p(t('Info: ', true), 'app version 0.86.57, Darwin, annual plan.'),
  ], { app: true, files: [screenshot], reactions: [done, eyes], thread: { replyCount: 6, lastReplyAt: NOW - 2 * HOUR, repliers: [people.dev, people.priya, people.maya] } })),
  fix: hit('2', 'm:D0DEV', 'Dev Patel', dmDev, DAY + 5 * HOUR, card(people.dev, [p('Pushed the fix for the Kestrel sign-in loop. Can you try build 412 before the release?')])),
  crash: hit('3', 't:C0BUGS:3', 'Crash on wake in 0.86.57', bugs, 2 * DAY, card(people.sam, [p(you, ' the Kestrel crash is back on 0.86.57. Logs are at ', link('builds.example.dev/kestrel/412'), '. ', mention(people.maya), ' can you take a look today?')], { reply: true })),
  notes: hit('4', 'm:C0FOUNDERS', '#founders · Main', founders, 4 * DAY, card(people.elena, [
    p('Notes from the Northwind call. They have 40 people on support, and most questions arrive by email and get forwarded to a shared channel, where answers get lost after a week.'),
    p('They tried two other tools this year and dropped both: one took a month to set up, and the other needed every agent to change how they write.'),
    p('Their head of support wants to see how a new person finds an old answer. Their ops lead cares about the audit trail and about keeping customer names out of anything shared.'),
    p('Pricing came up twice. They would want a pilot with one team first, ideally the billing team, for six weeks, and then a decision before the end of the quarter.'),
    p('We can show them Kestrel on Thursday: it is the clearest difference from what they use now, and it needs no setup on their side.'),
    p('I will send the deck tomorrow. Leo, can you join for the first half hour?'),
  ])),
  retry: hit('5', 't:C0BACKEND:5', 'Queue retries forever on an expired token', backend, 6 * DAY, card(people.leo, [p('The Kestrel queue retries forever when the token expires:'), { kind: 'code', text: "retry(syncQueue, { max: Infinity, backoff: 'none' })" }, p('We should cap it at 5 and show the sign-in sheet.')], { thread: { replyCount: 3, lastReplyAt: NOW - 5 * DAY, repliers: [people.dev, people.sam] } })),
  demo: hit('6', 'm:G0MAYALEO', 'Maya, Leo', gdm, 9 * DAY, card(people.maya, [p('Is the Kestrel demo still on for Friday? I can bring the new onboarding.')], { files: [figma] })),
  older: hit('7', 't:C0BACKEND:7', 'Kestrel cache sizes', backend, 40 * DAY, card(people.dev, [p('The Kestrel cache is 2 GB on the biggest workspace we have.')], { reply: true })),
}

const group = (hitOf: SearchHit, older = false): SearchGroup => ({
  id: `${older ? 'older:' : ''}${hitOf.topicId}:${hitOf.id}`,
  kind: hitOf.topicId.startsWith('t:') ? 'thread' : 'main',
  topicId: hitOf.topicId,
  title: hitOf.title,
  titleRanges: [],
  place: hitOf.place,
  at: hitOf.ts,
  messages: [hitOf],
  older,
  matchCount: 1,
})
const titleOnly: SearchGroup = { id: 't:C0KESTREL:9', kind: 'topic', topicId: 't:C0KESTREL:9', title: 'Kestrel pricing for the pilot', titleRanges: [{ start: 0, end: 7 }], place: kestrel, at: ((NOW - 7 * DAY) / 1000).toFixed(6), messages: [], older: false, matchCount: 0 }

const results: ReadonlyArray<SearchGroup> = [
  group(matches.numbers),
  group(matches.question),
  group(matches.report),
  group(matches.fix),
  group(matches.crash),
  group(matches.notes),
  group(matches.retry),
  titleOnly,
  group(matches.demo),
  group(matches.older, true),
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
  { id: 'C0PROJ', name: 'proj-kestrel', kind: 'private', highlight: [[0, 3]] },
  { id: 'D0LEO', name: 'Leo Prokopenko', kind: 'im', person: { id: 'U0LP', name: 'Leo Prokopenko', color: 'claret' }, highlight: [[4, 7]] },
  { id: 'C0PRODUCT', name: 'product', kind: 'public', highlight: [[0, 3]] },
]

interface Scene {
  readonly chips?: ReadonlyArray<SearchChipView>
  readonly text?: string
  readonly groups?: ReadonlyArray<SearchGroup> | undefined
  readonly state?: SearchListState
  readonly selected?: string
  readonly focused?: boolean
  /** The selected card's topic shows beside the results. */
  readonly panel?: boolean
  readonly step?: TopicHeaderReader['step']
  readonly picker?: SearchFieldPicker
  readonly hidden?: { readonly count: number; readonly apps: boolean; readonly automated: boolean }
  readonly page?: Partial<SearchPageProps>
}

/** The panel: the fixtures' thread as a topic shows it, with the panel's header. */
function Reader({ step, cover }: { readonly step?: TopicHeaderReader['step'] | undefined; readonly cover: boolean }) {
  const header: TopicHeaderReader = { onOpenInNewTab: noop, ...(step === undefined ? {} : { step }), ...(cover ? { onBack: noop } : { onClose: noop }) }
  return (
    <TopicView header={<TopicHeader detail={details.postgres} onMenu={noop} onPill={noop} onResolve={noop} reader={header} />} composer={<ComposerSlot placeholder="Reply" />}>
      <MessageList items={thread.slice(-6)} main={false} now={NOW} onOpenThread={noop} onOpenReply={noop} onChannel={noop} onLink={noop} />
    </TopicView>
  )
}

function SearchScene({ chips = [], text = 'kestrel', groups = results, state = 'done', selected, focused = true, panel = false, step, picker, hidden, page, cover = false }: Scene & { readonly cover?: boolean }) {
  const empty = chips.length === 0 && text === ''
  const older = groups?.findIndex((g) => g.older) ?? -1
  const rows = empty || groups === undefined ? undefined : searchRows(groups, older < 0 ? groups.length : older)
  return (
    <SearchPage
      field={<SearchField chips={chips} text={text} onText={noop} onChip={noop} onRemoveChip={noop} onClear={noop} onKeyDown={noop} picker={picker} />}
      filters={<SearchFilters set={{ from: chips.some((c) => c.op === 'from'), in: chips.some((c) => c.op === 'in' || c.op === 'topic'), date: false, has: false }} sort="newest" hideApps hideAutomated onMenu={noop} onToggle={noop} />}
      results={
        <SearchResults
          rows={rows}
          state={state}
          words={text}
          filtered={chips.length > 0}
          hidden={hidden ?? { count: 0, apps: true, automated: true }}
          selectedId={selected}
          focused={focused}
          marks={text === '' ? [] : ['kestrel']}
          now={NOW}
          recent={recent}
          onSelect={noop}
          onPress={noop}
          onOpen={noop}
          onToggleTopic={noop}
          onShowTopic={noop}
          onHideTopic={() => false}
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
      reader={panel ? <Reader step={step} cover={cover} /> : null}
      panelShown={panel}
      panelWidth={560}
      onResizePanel={noop}
      onResetPanel={noop}
      {...page}
    />
  )
}

const FRAME: FixtureFrame = { width: 1280, height: 820, padded: false }
const NARROW: FixtureFrame = { width: 720, height: 680, padded: false }
const page = (props: Scene & { readonly cover?: boolean } = {}, frame: FixtureFrame = FRAME) => scene<SearchPageProps>(() => <SearchScene {...props} />, frame)
const step = { index: 2, count: 4, onPrevious: noop, onNext: noop }

export default defineFixtures(
  SearchPage,
  {
    Results: {
      // The results first: whole messages as cards, newest first, at most --search-measure wide; two replies from one topic share its place line. The third card is selected; no topic shows.
      cards: page({ selected: matches.report.id }),
      // Space on the selected card: its topic beside the results, with "2 of 4", Open in new tab and Close.
      panel: page({ selected: matches.report.id, panel: true, step }),
      // The selection while focus is elsewhere (the panel's composer): the quiet fill without the accent edge.
      'selected-unfocused': page({ selected: matches.report.id, focused: false }),
      // ⌘F in a thread: its chip leads the field, In shows set.
      scoped: page({ chips: [{ key: 'topic', op: 'topic', label: 'Kestrel got slower this week', topic: { id: slower } }], text: 'kestrel', groups: [group(matches.numbers), group(matches.question)], selected: matches.numbers.id }),
      // A from: chip and the words.
      filtered: page({ chips: [fromMaya], groups: [group(matches.numbers), group(matches.demo)] }),
      // in: typed: the picker under the operator, ⌘K's Conversations rows.
      picker: page({ text: 'kestrel in:pro', picker: { at: 16, heading: 'Conversations', kinds: true, rows: pickRows, onPick: noop, onClose: noop } }),
    },
    Card: {
      // A long message whose match is far down: folded, scrolled to the match two lines under the fold's top, faded above and below, with Show more.
      'long-folded': page({ groups: [group(matches.notes)] }, { width: 900, height: 480, padded: false }),
      // An app's report that starts a thread: the App tag, bold lines, a file chip, reactions, and who replied.
      'thread-start': page({ groups: [group(matches.report)] }, { width: 900, height: 520, padded: false }),
      // A mention of you, a mention of someone else and a link with the word in it: the mark is yellow, never the accent.
      'mention-link': page({ groups: [group(matches.crash)] }, { width: 900, height: 260, padded: false }),
      // Code in a reply count's thread start, and a group DM with a file.
      'code-and-file': page({ groups: [group(matches.retry), group(matches.demo)] }, { width: 900, height: 480, padded: false }),
      // A topic whose title matched, and the line where the local rows start.
      'title-and-older': page({ groups: [titleOnly, group(matches.older, true)] }, { width: 900, height: 300, padded: false }),
    },
    State: {
      // The empty field: recent searches, the operators and ⌘K.
      empty: page({ text: '' }),
      // Local cards first, and one quiet line where Slack's will join.
      searching: page({ state: 'searching', groups: results.slice(0, 3) }),
      // Slack did not answer: the local cards stay, with Try again.
      'slack-unavailable': page({ state: 'slackUnavailable', groups: results.slice(0, 3) }),
      // Nothing matches with a filter set: Clear filters.
      'no-matches': page({ chips: [{ key: 'in', op: 'in', label: 'legal', place: { kind: 'private' } }], text: 'foo', groups: [] }),
      // Only apps and automated channels match: how many, and one button.
      'only-hidden': page({ text: 'deploy failed', groups: [], state: 'onlyHidden', hidden: { count: 4, apps: true, automated: true } }),
      offline: page({ state: 'offline', groups: results.slice(0, 3) }),
      // Privacy mode: the query, chips, names, titles and messages blur.
      privacy: scene<SearchPageProps>(() => (
        <PrivacyOn>
          <SearchScene selected={matches.report.id} />
        </PrivacyOn>
      ), FRAME),
    },
    Size: {
      // Under the results' minimum and a topic's: the cards take the page.
      narrow: page({ selected: matches.report.id }, NARROW),
      // Narrow with the topic shown: it covers the results, with Back to results.
      'narrow-panel': page({ selected: matches.report.id, panel: true, step, cover: true }, NARROW),
      // The panel beside the results at the smallest page that holds both.
      'panel-tight': page({ selected: matches.report.id, panel: true, step }, { width: 900, height: 680, padded: false }),
      // The minimum window: the toggles wrap to their own line and the cards keep their edges.
      minimum: page({ selected: matches.report.id }, { width: 400, height: 640, padded: false }),
    },
  },
  FRAME,
)
