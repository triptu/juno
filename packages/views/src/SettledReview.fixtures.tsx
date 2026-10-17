import * as stylex from '@stylexjs/stylex'
import { Broom } from '@phosphor-icons/react/dist/icons/Broom'
import { CaretDown } from '@phosphor-icons/react/dist/icons/CaretDown'
import { Info } from '@phosphor-icons/react/dist/icons/Info'
import { useState, type ReactNode } from 'react'
import type { HomeTopic } from '@juno/contract'
import { colors, layout, radii, sizes, spacing, text, weights } from '@juno/tokens/tokens.stylex'
import { Button, defineFixtures, Icon, IconButton, scene, Text } from '@juno/ui'
import { homeItems } from './fixtures/home'
import { manySettled, settledTopics, tidyUpItem } from './fixtures/settled'
import { FixtureWindow, OverHome as SheetOverHome } from './fixtures/sheetFrame'
import { NOW } from './fixtures/topics'
import { Home } from './Home'
import { HomeScene } from './HomeScene'
import { settledCopy, type SettledStatus } from './settled'
import { SettledList } from './SettledList'
import { ResolveExplainer, SettledReview, type SettledReviewProps } from './SettledReview'

const noop = () => {}

/** The review with its buttons working, so the gallery and the shift guard see a row change state in place. */
function Live({ topics = settledTopics, initial = new Map(), ...rest }: Partial<SettledReviewProps> & { readonly initial?: ReadonlyMap<string, SettledStatus> }) {
  const [statuses, setStatuses] = useState<ReadonlyMap<string, SettledStatus>>(initial)
  const set = (id: string, status: SettledStatus) => setStatuses(new Map([...statuses, [id, status]]))
  return (
    <SettledReview
      topics={topics}
      statuses={statuses}
      now={NOW}
      onOpen={noop}
      onResolve={(id) => set(id, 'resolved')}
      onKeep={(id) => set(id, 'kept')}
      onUndo={(id) => set(id, 'open')}
      onResolveAll={() => setStatuses(new Map(topics.map((topic) => [topic.id, statuses.get(topic.id) ?? 'resolved'])))}
      onSettings={noop}
      onClose={noop}
      {...rest}
    />
  )
}

/** Home under the sheet's layer, as the window shows it: the layer dims the page and the sheet sits in the middle. */
function OverHome({ children }: { readonly children: ReactNode }) {
  return <SheetOverHome home={<Home scene="evening" title="Evening, Tushar." items={[homeItems.waiting, homeItems.followUp, tidyUpItem]} now={NOW} enter={false} onOpen={noop} onMarkDone={noop} onResolveAll={noop} onReview={noop} onSort={noop} onItemMenu={noop} />}>{children}</SheetOverHome>
}

const acted: ReadonlyMap<string, SettledStatus> = new Map([
  [settledTopics[0]!.id, 'resolved'],
  [settledTopics[3]!.id, 'kept'],
])

/**
 * Direction B, explored and not built: Tidy up's row opens in place on
 * Home into a card with the same rows. Kept here so the comparison in
 * `docs/design/settled-suggestions/` can be shot again.
 */
function InPlace({ topics, about = false }: { readonly topics: ReadonlyArray<HomeTopic>; readonly about?: boolean }) {
  const [statuses, setStatuses] = useState<ReadonlyMap<string, SettledStatus>>(new Map())
  const set = (id: string, status: SettledStatus) => setStatuses(new Map([...statuses, [id, status]]))
  return (
    <FixtureWindow scroll>
      <div {...stylex.props(styles.column)}>
        <HomeScene name="evening" />
        <h2 {...stylex.props(styles.greeting)}>Evening, Tushar.</h2>
        <div {...stylex.props(styles.rows)}>
          <div {...stylex.props(styles.fakeRow)}>
            <Text variant="ui" weight="medium">Elena asked you something</Text>
            <Text variant="meta" tone="muted">Rina finished the onsite. Panel notes… · hiring · 12m</Text>
          </div>
          <section {...stylex.props(styles.card)} aria-label={settledCopy.title(topics.length)}>
            <div {...stylex.props(styles.cardHead)}>
              <span {...stylex.props(styles.tile)}>
                <Icon icon={Broom} size={18} />
              </span>
              <span {...stylex.props(styles.cardTitle)}>
                <Text variant="ui" weight="medium">{settledCopy.title(topics.length)}</Text>
                <Text variant="meta" tone="muted">{settledCopy.lead}</Text>
              </span>
              <IconButton icon={Info} label={settledCopy.about} size={28} pressed={about} />
              <IconButton icon={CaretDown} label="Collapse" size={28} />
            </div>
            {about ? <ResolveExplainer onSettings={noop} /> : null}
            <SettledList topics={topics} statuses={statuses} now={NOW} label={settledCopy.title(topics.length)} compact onOpen={noop} onResolve={(id) => set(id, 'resolved')} onKeep={(id) => set(id, 'kept')} onUndo={(id) => set(id, 'open')} />
            <div {...stylex.props(styles.cardFoot)}>
              <Button variant="secondary" size="sm">{settledCopy.resolveAll}</Button>
            </div>
          </section>
        </div>
      </div>
    </FixtureWindow>
  )
}

export default defineFixtures(
  SettledReview,
  {
    // Direction A, built: a sheet over Home.
    'A · Sheet': {
      'over-home': scene(() => <OverHome><Live /></OverHome>),
      about: scene(() => <OverHome><Live initialAbout /></OverHome>),
      // Two acted on: each row stays where it was and says what happened, with Undo.
      acted: scene(() => <OverHome><Live initial={acted} /></OverHome>),
      'focus-row': scene(() => <OverHome><Live initialActive={settledTopics[1]!.id} /></OverHome>, { focus: `[data-settled-row="${settledTopics[1]!.id}"] a` }),
      many: scene(() => <OverHome><Live topics={manySettled} /></OverHome>),
      'all-done': scene(() => <OverHome><Live initial={new Map(settledTopics.map((topic) => [topic.id, 'resolved' as const]))} /></OverHome>),
      'minimum-window': scene(() => <OverHome><Live /></OverHome>, { width: 336, height: 436, padded: false }),
    },
    // Direction B, explored: the row opens in place on Home.
    'B · In place': {
      expanded: scene(() => <InPlace topics={settledTopics} />),
      'expanded-about': scene(() => <InPlace topics={settledTopics} about />),
      'expanded-many': scene(() => <InPlace topics={manySettled} />),
    },
    // Home's card: the whole row opens the review; Resolve all stays in its slot.
    Card: {
      card: scene(() => <Home scene="evening" title="Evening, Tushar." items={[homeItems.waiting, homeItems.followUp, tidyUpItem]} now={NOW} enter={false} onOpen={noop} onMarkDone={noop} onResolveAll={noop} onReview={noop} onSort={noop} onItemMenu={noop} />, { hover: '[data-home-review]' }),
      'card-focus': scene(() => <Home scene="evening" title="Evening, Tushar." items={[homeItems.waiting, homeItems.followUp, tidyUpItem]} now={NOW} enter={false} onOpen={noop} onMarkDone={noop} onResolveAll={noop} onReview={noop} onSort={noop} onItemMenu={noop} />, { focus: '[data-home-review]' }),
    },
  },
  { width: 1056, height: 720, padded: false },
)

const styles = stylex.create({
  column: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    width: '100%',
    paddingBlock: spacing['--space-12'],
    paddingInline: spacing['--space-6'],
  },
  greeting: {
    margin: 0,
    marginTop: spacing['--space-3-5'],
    fontFamily: text['--text-greeting-family'],
    fontSize: text['--text-greeting-size'],
    fontWeight: text['--text-greeting-weight'],
    lineHeight: text['--text-greeting-leading'],
    color: colors['--foreground-default'],
  },
  rows: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-0-5'],
    width: '100%',
    maxWidth: layout['--home-width'],
    marginTop: spacing['--space-8'],
  },
  fakeRow: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    height: sizes['--row-52'],
    paddingInlineStart: spacing['--space-14'],
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-1'],
    padding: spacing['--space-1-5'],
    borderRadius: radii['--radius-3xl'],
    backgroundColor: colors['--surface-hover'],
  },
  cardHead: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-3'],
    paddingInline: spacing['--space-1-5'],
    minHeight: spacing['--space-10'],
  },
  tile: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: sizes['--tile-36'],
    height: sizes['--tile-36'],
    borderRadius: radii['--radius-xl'],
    backgroundColor: colors['--secondary-default'],
    color: colors['--foreground-subtle'],
  },
  cardTitle: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    minWidth: 0,
    fontWeight: weights['--weight-medium'],
  },
  cardFoot: {
    display: 'flex',
    justifyContent: 'flex-end',
    paddingInline: spacing['--space-1-5'],
    paddingBottom: spacing['--space-1'],
  },
})
