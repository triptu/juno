import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import type { PickConversation, ThreadSummary } from '@juno/contract'
import { spacing } from '@juno/tokens/tokens.stylex'
import { defineFixtures, fixture, scene, type FixtureFrame } from '@juno/ui'
import { Composer } from './Composer'
import { DestinationChip, TopicChip } from './DestinationPickers'
import { homeItems, rewritten } from './fixtures/home'
import { engTopics } from './fixtures/messages'
import { recentConversations } from './fixtures/newChat'
import { pictureCards } from './fixtures/pictures'
import { PrivacyOn } from './fixtures/privacy'
import { atMa, DRAFT, eng, hashEn, maya, MULTILINE } from './fixtures/homeWrite'
import { art, NOW } from './fixtures/topics'
import { Home, type HomeProps } from './Home'
import { HomeSyncLine } from './HomeSyncLine'
import { HomeScene, type HomeSceneName } from './HomeScene'
import { destinationLabel, SendToList, sendToRowId } from './HomeWrite'
import { WelcomeCard, type WelcomeHintName } from './WelcomeCard'
import { HomeWriteTop } from './HomeWriteTop'

const noop = () => {}

interface Write {
  readonly destination?: PickConversation
  readonly draft?: string
  /** A first @ or # with its "Send to" rows. */
  readonly sendTo?: { readonly kind: 'person' | 'channel'; readonly rows: ReadonlyArray<PickConversation> }
  /** The chip's destination list. */
  readonly listOpen?: boolean
  /** A running job's state line in place of the placeholder (SPEC 13.4). */
  readonly jobLine?: string
  /** The thread chosen in the topic chip; none is Main. */
  readonly thread?: ThreadSummary
  /** The topic chip's list. */
  readonly topicsOpen?: boolean
}

/** #eng's threads as Home's topic list shows them, the first few drawn. */
const engHomeTopics: ReadonlyArray<ThreadSummary> = engTopics.map((thread, index) => {
  const drawn = [art.database, art.bell, art.coins, art.people][index]
  return drawn === undefined ? thread : { ...thread, art: drawn }
})
const migration = engHomeTopics[0]!
const secrets = engHomeTopics[4]!

/** The composer as the container builds it: the chip, then the field. */
function write({ destination, draft = '', sendTo, listOpen = false, jobLine, thread, topicsOpen = false }: Write = {}): ReactNode {
  const chip = <DestinationChip destination={destination} open={listOpen} onOpen={noop} query="" onQuery={noop} conversations={listOpen ? recentConversations : undefined} onPick={noop} />
  const topic = <TopicChip conversation={destination} thread={thread} open={topicsOpen} onOpen={noop} query="" onQuery={noop} threads={destination?.channelId === 'C0ENG' ? engHomeTopics : []} now={NOW} onPick={noop} />
  const active = sendTo?.rows[0]?.key
  return (
    <Composer
      value={draft}
      onChange={noop}
      onSend={noop}
      placeholder={destination === undefined ? (jobLine ?? 'Ask Juno, or start with @ or #') : thread === undefined ? `Message ${destinationLabel(destination)}` : `Reply in ${thread.title}`}
      above={<HomeWriteTop chip={chip} {...(destination === undefined ? {} : { topic })} />}
      {...(sendTo === undefined
        ? {}
        : {
            mention: {
              anchorAt: 0,
              listId: 'send-to',
              activeId: active === undefined ? undefined : sendToRowId('send-to', active),
              list: <SendToList kind={sendTo.kind} rows={sendTo.rows} id="send-to" activeKey={active} onActivate={noop} onPick={noop} />,
              onDismiss: noop,
            },
          })}
    />
  )
}

const base: HomeProps = {
  scene: 'morning',
  title: 'Morning, Tushar.',
  items: [homeItems.waiting, homeItems.resume, homeItems.moved],
  now: NOW,
  onOpen: noop,
  onMarkDone: noop,
  onResolveAll: noop,
  onReview: noop,
  onSort: noop,
  onItemMenu: noop,
  composer: write(),
}

const two = [homeItems.waiting, homeItems.resume]

const narrow: FixtureFrame = { width: 560, height: 720, padded: false }

/** Home's picture (SPEC 12, "A picture"): a card from the fixtures, as Home gets it from disk. */
const picture = (id: string) => {
  const card = pictureCards.find((entry) => entry.id === id)!
  return { picture: { src: card.src, title: card.title, artist: card.artist, date: card.date, ratio: card.ratio, line: card.line }, onOpenPicture: noop }
}
const caughtUp = { scene: 'caughtUp', title: 'All caught up.', items: [] } as const

const card = (done: ReadonlyArray<WelcomeHintName> = [], hidden = false) => <WelcomeCard done={done} peekKey="option" onClose={noop} hidden={hidden} />
/** The minimum window with the sidebar shown: the container shows one row while the card does. */
const minimum: FixtureFrame = { width: 336, height: 436, padded: false }

const state = (props: Partial<HomeProps> = {}, frame?: FixtureFrame) => fixture<HomeProps>({ ...base, ...props }, frame)

const scenes: ReadonlyArray<HomeSceneName> = ['morning', 'midday', 'evening', 'night', 'friday', 'winter', 'autumn', 'caughtUp']

const strip = stylex.create({ row: { display: 'flex', flexWrap: 'wrap', gap: spacing['--space-6'] } })

export default defineFixtures(
  Home,
  {
    Titles: {
      'one-line': state({ items: [rewritten.waiting, { ...rewritten.resume, aiTitle: 'Plan' }] }, { ...minimum, topicTitleLines: 'one' }),
      'two-lines': state({ items: [rewritten.waiting, { ...rewritten.resume, aiTitle: 'Plan' }] }, { ...minimum, topicTitleLines: 'two' }),
    },
    Items: {
      'missed-huddle-channel': state({ items: [homeItems.waiting, { id: 'missedHuddle:R1', kind: 'missedHuddle', title: 'Missed huddle in #eng', topics: homeItems.channelMain.topics, at: NOW - 18 * 60_000, durationMinutes: 12 }, homeItems.followUp] }),
      'missed-huddle-dm': state({ items: [homeItems.waiting, { id: 'missedHuddle:R2', kind: 'missedHuddle', title: 'Missed huddle with Maya Chen', topics: homeItems.dm.topics, at: NOW - 42 * 60_000, durationMinutes: 8 }, homeItems.followUp] }),
      // The shortest and longest meta lines: "Lasted under a minute · 3m" and "Lasted 1 hr 12 min · 2h".
      'missed-huddle-short': state({ items: [homeItems.waiting, { id: 'missedHuddle:R3', kind: 'missedHuddle', title: 'Missed huddle with Maya Chen', topics: homeItems.dm.topics, at: NOW - 3 * 60_000, durationMinutes: 0 }, homeItems.followUp] }),
      'missed-huddle-long': state({ items: [homeItems.waiting, { id: 'missedHuddle:R4', kind: 'missedHuddle', title: 'Missed huddle in #eng', topics: homeItems.channelMain.topics, at: NOW - 2 * 3_600_000, durationMinutes: 72 }, homeItems.followUp] }),
      three: state(),
      // The same rows with the assistant's title lines: every box stays where it was (gallery behaviour test).
      'ai-titles': state({ items: [rewritten.waiting, rewritten.resume, rewritten.moved] }),
      // Privacy mode: an assistant title can quote the messages, so it blurs; the plain title and the meta line stay.
      'ai-titles-privacy': scene<HomeProps>(() => (
        <PrivacyOn>
          <Home {...base} items={[rewritten.waiting, homeItems.resume, rewritten.moved]} />
        </PrivacyOn>
      )),
      // Juno's proactive ask, ranked after the follow-up, with Not now and Start.
      'learn-ask': state({ scene: 'midday', title: 'Hello, Tushar.', items: [homeItems.waiting, homeItems.ask, homeItems.tidyUp], onAsk: noop }),
      'learn-ask-connection': state({ scene: 'midday', title: 'Hello, Tushar.', items: [homeItems.askConnection], onAsk: noop }, { hover: '[data-home-item="ask"] button' }),
      'learn-ask-narrow': state({ scene: 'midday', title: 'Hello, Tushar.', items: [homeItems.ask, homeItems.resume], onAsk: noop }, narrow),
      'follow-up-and-tidy-up': state({ scene: 'evening', title: 'Evening, Tushar.', items: [homeItems.waiting, homeItems.followUp, homeItems.tidyUp] }),
      // The Automated question, after the ones it ranks below.
      automated: state({ scene: 'midday', title: 'Hello, Tushar.', items: [homeItems.waiting, homeItems.resume, homeItems.automated] }, { hover: '[data-home-item=automated]' }),
      // Juno's reason in place of the count; in a narrow window the meta line takes an ellipsis.
      'automated-juno': state({ scene: 'midday', title: 'Hello, Tushar.', items: [homeItems.waiting, homeItems.automatedByJuno] }, { width: 720, height: 520, padded: false, hover: '[data-home-item=automated]' }),
      // A DM, a group DM and a channel (SPEC 12): the sidebar's Main tile, and the place named once on the meta line.
      places: state({ scene: 'night', title: 'Still up, Tushar.', items: [homeItems.dm, homeItems.groupDm, homeItems.channelMain] }),
      // A DM with someone who has no photo, beside a thread in a channel.
      'places-no-photo': state({ scene: 'evening', title: 'Evening, Tushar.', items: [homeItems.dmNoPhoto, homeItems.waiting] }),
      one: state({ scene: 'friday', title: 'Happy Friday, Tushar.', items: [homeItems.resume] }),
      // The minimum window with the sidebar shown: the page is 336 by 436; the column keeps 24 on each side.
      'minimum-window': state({}, { width: 336, height: 436, padded: false }),
      'short-window': state({ items: two }, { width: 720, height: 520, padded: false }),
      narrow: state({}, narrow),
    },
    // Writing (SPEC section 12): the destination chip and the field at the bottom.
    Write: {
      juno: state({ items: two }),
      'maya-chosen': state({ items: two, composer: write({ destination: maya, draft: DRAFT }) }),
      // Three lines: the field keeps its full width, the chip stays above it.
      multiline: state({ items: two, composer: write({ destination: maya, draft: MULTILINE }) }),
      'multiline-narrow': state({ items: two, composer: write({ destination: maya, draft: MULTILINE }) }, narrow),
      channel: state({ items: two, composer: write({ destination: eng, draft: DRAFT }) }),
      // A first @ or # suggests a destination; the text stays until Tab or Enter picks.
      'at-person': state({ items: two, composer: write({ draft: '@ma', sendTo: { kind: 'person', rows: atMa } }) }),
      'at-channel': state({ items: two, composer: write({ draft: '#en', sendTo: { kind: 'channel', rows: hashEn } }) }),
      // Space kept the text: a question for Juno that starts with a channel's name.
      'juno-hash': state({ items: two, composer: write({ draft: '#eng what happened today?' }) }),
      'destination-list': state({ items: two, composer: write({ listOpen: true }) }),
      // The topic chip (SPEC 12): Main for a person or channel, hidden for Juno (the juno state above).
      'topic-main': state({ items: two, composer: write({ destination: maya, draft: DRAFT }) }),
      'topic-thread': state({ items: two, composer: write({ destination: eng, thread: migration, draft: DRAFT }) }),
      // Main first, then #eng's threads with their art and last activity, the resolved ones last.
      'topic-list': state({ items: two, composer: write({ destination: eng, thread: migration, topicsOpen: true }) }),
      // A long thread title and a narrow page: the topic chip shortens first, then the destination chip.
      'topic-narrow': state({ items: two, composer: write({ destination: eng, thread: secrets, draft: DRAFT }) }, { width: 400, height: 720, padded: false }),
      // A running job's state line in place of the placeholder (SPEC 13.4); a long one takes an ellipsis.
      'job-line': state({ composer: write({ jobLine: 'T3 Code · tests running, 2 of 5' }) }),
      'job-line-long': state({ composer: write({ jobLine: 'T3 Code · Fix the sidebar flake · tests running, 2 of 5, the slowest suite still has four minutes to go' }) }),
    },
    // The welcome card (SPEC 4) under the rows, over the field its last hint points at.
    Welcome: {
      fresh: state({ welcome: card() }),
      'one-done': state({ welcome: card(['peek']) }),
      'all-set': state({ welcome: card(['peek', 'tab', 'juno']) }),
      // The scene and the greeting give the card their room; the card is whole above the field.
      'minimum-window': state({ items: [homeItems.waiting], welcome: card() }, minimum),
      'minimum-window-all-set': state({ items: [homeItems.waiting], welcome: card(['peek', 'tab', 'juno']) }, minimum),
      'short-window': state({ items: [homeItems.waiting], welcome: card(['tab']) }, { width: 720, height: 520, padded: false }),
      narrow: state({ welcome: card(['juno']) }, narrow),
      // Before the sidebar has rows, and after Hide: the card's room, empty, so the rows never move.
      'room-kept': state({ welcome: card([], true) }),
      // The first sync: the card's room.
      syncing: state({ line: <HomeSyncLine line="Syncing with Slack." />, items: [], loading: true, welcome: card([], true) }),
    },
    Empty: {
      'caught-up': state({ scene: 'caughtUp', title: 'All caught up.', items: [] }),
      'caught-up-narrow': state({ scene: 'caughtUp', title: 'All caught up.', items: [] }, narrow),
      // The first sync is still running: the greeting and one calm line, no rows, never a blank page.
      syncing: state({ line: <HomeSyncLine line="Syncing with Slack." />, items: [], loading: true }),
      // Once the conversations are listed, the line counts them as the sidebar's card does, in a fixed width.
      'syncing-count': state({ line: <HomeSyncLine line="Syncing with Slack." progress={{ done: 7, total: 143 }} />, items: [], loading: true }),
      // Mid-sync: the rows that landed so far, and no room kept for the rest.
      'syncing-rows': state({ line: <HomeSyncLine line="Syncing with Slack." progress={{ done: 64, total: 143 }} />, items: [homeItems.waiting], loading: true }),
      'nothing-waiting': state({ scene: 'night', title: 'Still up, Tushar.', items: [] }),
      'no-name': state({ scene: 'midday', title: 'Hello.', items: [homeItems.waiting] }),
    },
    // A picture in the caught-up scene's place: the same box for every shape, lifted off the page, then its label and its line.
    Picture: {
      // A quote, with who said it run in.
      wide: state({ ...caughtUp, ...picture('monet-impression-sunrise') }),
      // A fact.
      fact: state({ ...caughtUp, ...picture('vermeer-milkmaid') }),
      // The longest line takes two lines and hangs under the label; the box and the label stay where they are.
      'long-line': state({ ...caughtUp, ...picture('haeckel-discomedusae') }),
      tall: state({ ...caughtUp, ...picture('kota-radha-krishna') }),
      panorama: state({ ...caughtUp, ...picture('webb-cosmic-cliffs') }),
      // A long title: the title line takes an ellipsis inside the box's width, with the whole title as its tooltip.
      'long-title': state({ ...caughtUp, ...picture('hiroshige-sudden-shower') }, narrow),
      'short-window': state({ ...caughtUp, ...picture('monet-impression-sunrise') }, { width: 720, height: 600, padded: false }),
      'minimum-window': state({ ...caughtUp, ...picture('monet-impression-sunrise') }, minimum),
      // The file would not load: the box keeps its size and shows the caught-up scene.
      missing: state({ ...caughtUp, picture: { src: '/__fixture/missing-picture.webp', title: 'Irises', artist: 'Vincent van Gogh', date: '1889', ratio: 1.29, line: { text: 'A fixture line.' } }, onOpenPicture: noop }),
      hover: state({ ...caughtUp, ...picture('monet-impression-sunrise') }, { hover: '[data-home-picture] button' }),
      focus: state({ ...caughtUp, ...picture('monet-impression-sunrise') }, { focus: '[data-home-picture] button' }),
    },
    // The chip keeps its hover fill from hover through press to open, so opening changes no colour (gallery trigger-open spec).
    Open: {
      'chip-hover': state({ items: two }, { hover: 'button[aria-label="Send to: Juno"]' }),
      'chip-press': state({ items: two }, { press: 'button[aria-label="Send to: Juno"]' }),
      'chip-open': state({ items: two, composer: write({ listOpen: true }) }),
      'chip-open-hover': state({ items: two, composer: write({ listOpen: true }) }, { hover: 'button[aria-label="Send to: Juno"]' }),
    },
    Interaction: {
      'hover-row': state({}, { hover: '[data-home-item="waiting"] a' }),
      'focus-row': state({}, { focus: '[data-home-item="resume"] a' }),
      'hover-follow-up': state({ items: [homeItems.waiting, homeItems.followUp, homeItems.tidyUp] }, { hover: '[data-home-item="followUp"] a' }),
      'hover-automated': state({ items: [homeItems.waiting, homeItems.resume, homeItems.automated] }, { hover: '[data-home-item="automated"] a' }),
      'hover-chip': state({ items: two }, { hover: 'button[aria-label="Send to: Juno"]' }),
      'focus-topic-chip': state({ items: two, composer: write({ destination: eng, thread: migration }) }, { focus: 'button[aria-label^="Topic:"]' }),
    },
    Overview: {
      scenes: scene(
        () => (
          <div {...stylex.props(strip.row)}>
            {scenes.map((name) => (
              <HomeScene key={name} name={name} />
            ))}
          </div>
        ),
        { width: 640 },
      ),
    },
  },
  { width: 1056, height: 720, padded: false },
)
