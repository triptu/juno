import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import type { PickConversation } from '@juno/contract'
import { spacing } from '@juno/tokens/tokens.stylex'
import { defineFixtures, fixture, scene, type FixtureFrame } from '@juno/ui'
import { Composer } from './Composer'
import { DestinationChip } from './DestinationPickers'
import { homeItems, rewritten } from './fixtures/home'
import { recentConversations } from './fixtures/newChat'
import { PrivacyOn } from './fixtures/privacy'
import { atMa, DRAFT, eng, hashEn, maya, MULTILINE, recentChannels, recentPeople } from './fixtures/recents'
import { NOW } from './fixtures/topics'
import { Home, type HomeProps } from './Home'
import { HomeScene, type HomeSceneName } from './HomeScene'
import { destinationLabel, HomeRecent, HomeWriteTop, SendToList, sendToRowId } from './HomeWrite'

const noop = () => {}

interface Write {
  readonly destination?: PickConversation
  readonly draft?: string
  /** A first @ or # with its "Send to" rows. */
  readonly sendTo?: { readonly kind: 'person' | 'channel'; readonly rows: ReadonlyArray<PickConversation> }
  /** The chip's destination list. */
  readonly listOpen?: boolean
  /** No Recent: a first run. */
  readonly noRecent?: boolean
  /** A running job's state line in place of the placeholder (SPEC 13.4). */
  readonly jobLine?: string
}

/** The composer as the container builds it: Recent, the chip, then the field. */
function write({ destination, draft = '', sendTo, listOpen = false, noRecent = false, jobLine }: Write = {}): ReactNode {
  const chip = <DestinationChip destination={destination} open={listOpen} onOpen={noop} query="" onQuery={noop} conversations={listOpen ? recentConversations : undefined} onPick={noop} />
  const recent = noRecent ? null : <HomeRecent people={recentPeople} channels={recentChannels} chosen={destination?.key} onPick={noop} onOpen={noop} />
  const active = sendTo?.rows[0]?.key
  return (
    <Composer
      value={draft}
      onChange={noop}
      onSend={noop}
      placeholder={destination === undefined ? (jobLine ?? 'Ask Juno, or start with @ or #') : `Message ${destinationLabel(destination)}`}
      above={<HomeWriteTop recent={recent} chip={chip} />}
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
  enter: false,
  onOpen: noop,
  onMarkDone: noop,
  onResolveAll: noop,
  onSort: noop,
  onItemMenu: noop,
  composer: write(),
}

const two = [homeItems.waiting, homeItems.resume]
const narrow: FixtureFrame = { width: 560, height: 720, padded: false }

const state = (props: Partial<HomeProps> = {}, frame?: FixtureFrame) => fixture<HomeProps>({ ...base, ...props }, frame)

const scenes: ReadonlyArray<HomeSceneName> = ['morning', 'midday', 'evening', 'night', 'friday', 'winter', 'autumn', 'caughtUp']

const strip = stylex.create({ row: { display: 'flex', flexWrap: 'wrap', gap: spacing['--space-6'] } })

export default defineFixtures(
  Home,
  {
    Items: {
      three: state(),
      // The same rows with the assistant's title lines: every box stays where it was (gallery behaviour test).
      'ai-titles': state({ items: [rewritten.waiting, rewritten.resume, rewritten.moved] }),
      // Privacy mode: an assistant title can quote the messages, so it blurs; the plain title and the meta line stay.
      'ai-titles-privacy': scene<HomeProps>(() => (
        <PrivacyOn>
          <Home {...base} items={[rewritten.waiting, homeItems.resume, rewritten.moved]} />
        </PrivacyOn>
      )),
      'follow-up-and-tidy-up': state({ scene: 'evening', title: 'Evening, Tushar.', items: [homeItems.waiting, homeItems.followUp, homeItems.tidyUp] }),
      'buttons-used': state({ scene: 'evening', title: 'Evening, Tushar.', items: [homeItems.waiting, homeItems.followUp, homeItems.tidyUp], done: new Set([homeItems.followUp.id, homeItems.tidyUp.id]) }),
      // The Automated question, after the ones it ranks below.
      automated: state({ scene: 'midday', title: 'Hello, Tushar.', items: [homeItems.waiting, homeItems.resume, homeItems.automated] }, { hover: '[data-home-item=automated]' }),
      // Juno's reason in place of the count; in a narrow window the meta line takes an ellipsis.
      'automated-juno': state({ scene: 'midday', title: 'Hello, Tushar.', items: [homeItems.waiting, homeItems.automatedByJuno] }, { width: 720, height: 520, padded: false, hover: '[data-home-item=automated]' }),
      one: state({ scene: 'friday', title: 'Happy Friday, Tushar.', items: [homeItems.resume] }),
      // The minimum window with the sidebar shown: the page is 336 by 436; the column keeps 24 on each side and Recent stacks.
      'minimum-window': state({}, { width: 336, height: 436, padded: false }),
      'short-window': state({ items: two }, { width: 720, height: 520, padded: false }),
      narrow: state({}, narrow),
    },
    // Writing (SPEC section 12): Recent, the destination chip and the field, one stack at the bottom.
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
      'first-run': state({ scene: 'midday', title: 'Hello, Tushar.', items: [], composer: write({ noRecent: true }) }),
      // A running job's state line in place of the placeholder (SPEC 13.4); a long one takes an ellipsis.
      'job-line': state({ composer: write({ jobLine: 'T3 Code · tests running, 2 of 5' }) }),
      'job-line-long': state({ composer: write({ jobLine: 'T3 Code · Fix the sidebar flake · tests running, 2 of 5, the slowest suite still has four minutes to go' }) }),
    },
    Empty: {
      'caught-up': state({ scene: 'caughtUp', title: 'All caught up.', items: [] }),
      'caught-up-narrow': state({ scene: 'caughtUp', title: 'All caught up.', items: [] }, narrow),
      // The first sync is still running: the greeting and one calm line, no rows, never a blank page.
      syncing: state({ line: 'Syncing with Slack.', items: [], loading: true, reservedItems: 3 }),
      // Mid-sync: the rows that landed so far, with room kept for the rest.
      'syncing-rows': state({ line: 'Syncing with Slack.', items: [homeItems.waiting], loading: true, reservedItems: 3 }),
      'nothing-waiting': state({ scene: 'night', title: 'Still up, Tushar.', items: [] }),
      'no-name': state({ scene: 'midday', title: 'Hello.', items: [homeItems.waiting] }),
    },
    Interaction: {
      'hover-row': state({}, { hover: '[data-home-item="waiting"] a' }),
      'focus-row': state({}, { focus: '[data-home-item="resume"] a' }),
      'hover-follow-up': state({ items: [homeItems.waiting, homeItems.followUp, homeItems.tidyUp] }, { hover: '[data-home-item="followUp"] a' }),
      'hover-automated': state({ items: [homeItems.waiting, homeItems.resume, homeItems.automated] }, { hover: '[data-home-item="automated"] a' }),
      'hover-recent': state({ items: two }, { hover: '[data-recent="0-1"]' }),
      'focus-recent': state({ items: two }, { focus: '[data-recent="0-0"]' }),
      'hover-chip': state({ items: two }, { hover: 'button[aria-label="Send to: Juno"]' }),
      entrance: state({ enter: true }),
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
