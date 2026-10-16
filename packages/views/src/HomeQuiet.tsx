import * as stylex from '@stylexjs/stylex'
import { Lock } from '@phosphor-icons/react/dist/icons/Lock'
import type { ReactNode } from 'react'
import type { HomeItem } from '@juno/contract'
import { accent, colors, layout, radii, sizes, spacing, text, tints, weights } from '@juno/tokens/tokens.stylex'
import { Icon } from '@juno/ui'
import { HomeRow } from './Home'
import { HomeScene, type HomeSceneName } from './HomeScene'
import { HomeComposer, label, noop, RecentMark, tintOf, type Recent, type WriteState } from './HomeWrite'

/**
 * Round 3 of the merged Home (gallery only, `docs/design/home-merged/round-3`):
 * the address book with everything that does not help pick a destination
 * taken out. No greeting while something waits, no counts, no labels, no
 * times. What needs you is two-line rows with the topic's art; recents are
 * one-line names, so the two read apart by size alone. The composer and its
 * chip are round 2's, unchanged.
 */

export interface QuietProps {
  /** What needs you. Empty: caught up. */
  readonly items: ReadonlyArray<HomeItem>
  readonly now: number
  /** The caught-up scene. */
  readonly scene: HomeSceneName
  readonly people: ReadonlyArray<Recent>
  readonly channels: ReadonlyArray<Recent>
  /** People and channels together, newest first. */
  readonly mixed: ReadonlyArray<Recent>
  readonly write: WriteState
  /** The polished two columns (round 3's refine step). */
  readonly refined?: boolean
}

const chosenOf = (write: WriteState) => (write.destination === 'juno' ? undefined : write.destination.key)

function QuietPage({ items, now, scene, write, children }: Pick<QuietProps, 'items' | 'now' | 'scene' | 'write'> & { readonly children: ReactNode }) {
  return (
    <div {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.scroll)}>
        <div {...stylex.props(styles.column)}>
          {items.length === 0 ? (
            <div {...stylex.props(styles.caughtUp)}>
              <HomeScene name={scene} />
              <h2 {...stylex.props(styles.title)}>All caught up.</h2>
            </div>
          ) : (
            <ul aria-label="Needs you" {...stylex.props(styles.items)}>
              {items.map((item) => (
                <HomeRow key={item.id} item={item} done={false} now={now} onOpen={noop} onMarkDone={noop} onResolveAll={noop} onSort={noop} onItemMenu={noop} />
              ))}
            </ul>
          )}
          <div aria-label="Write to" role="group" {...stylex.props(styles.recents)}>
            {children}
          </div>
        </div>
      </div>
      <HomeComposer write={write} look="chip" refined />
    </div>
  )
}

/** A 32px row: the mark on the axis of a Needs you row's art, the name on the edge of its title. */
function Row({ recent, chosen, refined = false }: { readonly recent: Recent; readonly chosen: boolean; readonly refined?: boolean }) {
  return (
    <li>
      <button type="button" aria-pressed={chosen} aria-label={label(recent)} {...stylex.props(styles.row, refined && styles.rowQuiet, styles.ring, chosen && tints_[tintOf(recent)])}>
        <span {...stylex.props(styles.markSlot)}>
          <RecentMark recent={recent} size={20} />
        </span>
        <span {...stylex.props(styles.name)}>{recent.name}</span>
        {refined && recent.kind === 'private' ? (
          <span {...stylex.props(styles.lock)}>
            <Icon icon={Lock} size={12} label="Private" />
          </span>
        ) : null}
      </button>
    </li>
  )
}

function Rows({ list, chosen, refined = false }: { readonly list: ReadonlyArray<Recent>; readonly chosen: string | undefined; readonly refined?: boolean }) {
  return (
    <ul {...stylex.props(styles.list)}>
      {list.map((recent) => (
        <Row key={recent.key} recent={recent} chosen={recent.key === chosen} refined={refined} />
      ))}
    </ul>
  )
}

/** A · Two compact columns, people and channels, no labels: faces against channel art make the split. */
export function QuietColumns(props: QuietProps) {
  const chosen = chosenOf(props.write)
  return (
    <QuietPage {...props}>
      <div {...stylex.props(props.refined === true && styles.columnsScope)}>
        <div {...stylex.props(styles.columns, props.refined === true && styles.columnsFold)}>
          <Rows list={props.people.slice(0, 5)} chosen={chosen} refined={props.refined === true} />
          <Rows list={props.channels.slice(0, 5)} chosen={chosen} refined={props.refined === true} />
        </div>
      </div>
    </QuietPage>
  )
}

/** B · One list, people and channels by when you last wrote. */
export function QuietList(props: QuietProps) {
  return (
    <QuietPage {...props}>
      <Rows list={props.mixed.slice(0, 7)} chosen={chosenOf(props.write)} />
    </QuietPage>
  )
}

/** C · Pills that wrap, newest first, with no rows. */
export function QuietPills(props: QuietProps) {
  const chosen = chosenOf(props.write)
  return (
    <QuietPage {...props}>
      <ul {...stylex.props(styles.wrap)}>
        {props.mixed.slice(0, 10).map((recent) => (
          <li key={recent.key}>
            <button type="button" aria-pressed={recent.key === chosen} aria-label={label(recent)} {...stylex.props(styles.pill, styles.ringOut, recent.key === chosen && tints_[tintOf(recent)])}>
              <RecentMark recent={recent} size={20} />
              <span {...stylex.props(styles.name)}>{recent.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </QuietPage>
  )
}

/** D · Names only, set as a short run of words: people by name, channels with their #. */
export function QuietNames(props: QuietProps) {
  const chosen = chosenOf(props.write)
  return (
    <QuietPage {...props}>
      <ul {...stylex.props(styles.wrap, styles.wrapNames)}>
        {props.mixed.slice(0, 10).map((recent) => (
          <li key={recent.key}>
            <button type="button" aria-pressed={recent.key === chosen} {...stylex.props(styles.word, styles.ringOut, recent.key === chosen && tints_[tintOf(recent)])}>
              {label(recent)}
            </button>
          </li>
        ))}
      </ul>
    </QuietPage>
  )
}

const HOVER = '@media (hover: hover)'
const FOLD = '@container (max-width: 400px)'

const tints_ = stylex.create({
  public: { backgroundColor: tints['--tint-public-bg'], color: tints['--tint-public-fg'] },
  private: { backgroundColor: tints['--tint-private-bg'], color: tints['--tint-private-fg'] },
  dm: { backgroundColor: tints['--tint-dm-bg'], color: tints['--tint-dm-fg'] },
})

const styles = stylex.create({
  page: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    height: '100%',
    minHeight: 0,
    backgroundColor: colors['--background'],
  },
  scroll: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    minHeight: 0,
    overflowY: 'auto',
  },
  // Home's column, centred when it fits and from the top when it does not.
  column: {
    width: '100%',
    maxWidth: `calc(${layout['--home-width']} + 2 * ${spacing['--space-6']})`,
    marginInline: 'auto',
    marginBlock: 'auto',
    paddingInline: spacing['--space-6'],
    paddingBlock: spacing['--space-10'],
    boxSizing: 'border-box',
  },
  caughtUp: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: spacing['--space-3-5'],
  },
  title: {
    margin: 0,
    fontFamily: text['--text-greeting-family'],
    fontSize: text['--text-greeting-size'],
    fontWeight: text['--text-greeting-weight'],
    lineHeight: text['--text-greeting-leading'],
    letterSpacing: text['--text-greeting-tracking'],
    color: colors['--foreground-default'],
  },
  items: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-0-5'],
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  // The one gap between what needs you and the recents: space, no rule and no label.
  recents: {
    marginTop: spacing['--space-8'],
  },
  columns: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
    columnGap: spacing['--space-2'],
  },
  columnsScope: {
    containerType: 'inline-size',
  },
  // Below about 22 characters a column, one column: names stay whole rather than cut short.
  columnsFold: {
    gridTemplateColumns: { default: 'minmax(0, 1fr) minmax(0, 1fr)', [FOLD]: 'minmax(0, 1fr)' },
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-3'],
    width: '100%',
    height: sizes['--control-32'],
    minWidth: 0,
    paddingInline: spacing['--space-1-5'],
    borderWidth: 0,
    borderRadius: radii['--radius-xl'],
    backgroundColor: { default: 'transparent', ':hover': { default: null, [HOVER]: colors['--surface-hover'] } },
    color: colors['--foreground-default'],
    textAlign: 'start',
    cursor: 'default',
  },
  // Recents sit below what needs you: the subtle tone at rest, the default on hover and when chosen.
  rowQuiet: {
    color: { default: colors['--foreground-subtle'], ':hover': { default: null, [HOVER]: colors['--foreground-default'] } },
  },
  lock: {
    display: 'inline-flex',
    flexShrink: 0,
    color: colors['--foreground-muted'],
  },
  // As wide as a Needs you row's art, so the 20px mark sits on its axis.
  markSlot: {
    display: 'inline-flex',
    justifyContent: 'center',
    flexShrink: 0,
    width: sizes['--control-40'],
  },
  name: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily: text['--text-ui-family'],
    fontSize: text['--text-ui-size'],
    fontWeight: weights['--weight-regular'],
    lineHeight: text['--text-ui-leading'],
  },
  wrap: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: spacing['--space-1-5'],
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  wrapNames: {
    columnGap: spacing['--space-0-5'],
    rowGap: spacing['--space-0-5'],
  },
  pill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-1-5'],
    maxWidth: '100%',
    height: sizes['--control-28'],
    paddingInlineStart: spacing['--space-1'],
    paddingInlineEnd: spacing['--space-2-5'],
    borderWidth: 0,
    borderRadius: radii['--radius-pill'],
    backgroundColor: { default: colors['--surface-hover'], ':hover': { default: null, [HOVER]: colors['--secondary-default'] } },
    color: colors['--foreground-default'],
    cursor: 'default',
  },
  word: {
    height: sizes['--control-28'],
    paddingInline: spacing['--space-1-5'],
    borderWidth: 0,
    borderRadius: radii['--radius-lg'],
    backgroundColor: { default: 'transparent', ':hover': { default: null, [HOVER]: colors['--surface-hover'] } },
    color: colors['--foreground-subtle'],
    fontFamily: text['--text-body-family'],
    fontSize: text['--text-body-size'],
    lineHeight: text['--text-body-leading'],
    whiteSpace: 'nowrap',
    cursor: 'default',
  },
  ring: {
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineWidth: sizes['--focus-ring-width'],
    outlineOffset: `calc(-1 * ${sizes['--focus-ring-width']})`,
    outlineColor: accent['--focus-ring'],
  },
  ringOut: {
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineWidth: sizes['--focus-ring-width'],
    outlineOffset: sizes['--focus-ring-offset'],
    outlineColor: accent['--focus-ring'],
  },
})
