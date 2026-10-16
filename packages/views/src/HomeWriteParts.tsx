import * as stylex from '@stylexjs/stylex'
import { Check } from '@phosphor-icons/react/dist/icons/Check'
import { Lock } from '@phosphor-icons/react/dist/icons/Lock'
import type { ReactNode } from 'react'
import { accent, colors, layout, radii, sizes, spacing, text, tints, weights } from '@juno/tokens/tokens.stylex'
import { Icon, Kbd, Text } from '@juno/ui'
import { HomeRow } from './Home'
import { HomeScene, type HomeSceneName } from './HomeScene'
import { noop, RecentMark, tintOf, type HomeWriteProps, type Recent, type WriteState } from './HomeWrite'

/** The pieces the merged Home directions share: the greeting, the rows, the people and channel lists. */


export function Greeting({ home, align = 'center', scene = true }: { readonly home: HomeWriteProps['home']; readonly align?: 'center' | 'start'; readonly scene?: boolean }) {
  return (
    <div {...stylex.props(styles.greeting, align === 'start' && styles.greetingStart)}>
      {scene ? <HomeScene name={home.scene as HomeSceneName} /> : null}
      <h2 {...stylex.props(styles.title, scene && styles.titleUnderScene)}>{home.title}</h2>
      <Text variant="body" tone="muted" as="p" sx={styles.line}>
        {home.line}
      </Text>
    </div>
  )
}

export function Items({ home }: { readonly home: HomeWriteProps['home'] }) {
  if (home.items.length === 0) return null
  return (
    <ul aria-label="What needs you" {...stylex.props(styles.items)}>
      {home.items.map((item) => (
        <HomeRow key={item.id} item={item} done={false} now={home.now} onOpen={noop} onMarkDone={noop} onResolveAll={noop} onSort={noop} onItemMenu={noop} />
      ))}
    </ul>
  )
}

export function SectionLabel({ children, trailing }: { readonly children: ReactNode; readonly trailing?: ReactNode }) {
  return (
    <div {...stylex.props(styles.sectionLabel)}>
      <Text variant="sectionLabel" tone="muted" as="h3">
        {children}
      </Text>
      {trailing}
    </div>
  )
}

/** One recent as a 40px row: the mark, the name, and when. Pressing it makes it the destination. */
export function RecentRow({ recent, chosen, refined = false }: { readonly recent: Recent; readonly chosen: boolean; readonly refined?: boolean }) {
  const mark = <RecentMark recent={recent} size={28} />
  return (
    <li>
      <button type="button" aria-pressed={chosen} {...stylex.props(styles.recentRow, refined && styles.recentRowRefined, chosen && tintRows[tintOf(recent)])}>
        {refined ? <span {...stylex.props(styles.markSlot)}>{mark}</span> : mark}
        <span {...stylex.props(styles.recentName)}>{recent.name}</span>
        {recent.kind === 'private' ? <Icon icon={Lock} size={12} /> : null}
        <span {...stylex.props(styles.recentAt, recent.sent === true && styles.sentAt)}>
          {recent.sent === true ? <Icon icon={Check} size={12} /> : null}
          {recent.sent === true ? 'Sent' : recent.at}
        </span>
      </button>
    </li>
  )
}

export const chosenKey = (write: WriteState) => (write.destination === 'juno' ? undefined : write.destination.key)

/** People and channels side by side, as two lists of rows. */
export function Columns({ people, channels, write, rows = 6, refined = false }: Pick<HomeWriteProps, 'people' | 'channels' | 'write' | 'refined'> & { readonly rows?: number }) {
  const chosen = chosenKey(write)
  const groups = [
    { name: 'People', list: people, key: '@', empty: 'Type @ and a name to write to someone.' },
    { name: 'Channels', list: channels, key: '#', empty: 'Type # and a channel to post there.' },
  ] as const
  return (
    <div {...stylex.props(styles.columns)}>
      {groups.map((group) => (
        <section key={group.name} aria-label={group.name} {...stylex.props(styles.column)}>
          <SectionLabel trailing={refined ? <Kbd look="key">{group.key}</Kbd> : undefined}>{group.name}</SectionLabel>
          {group.list.length === 0 ? (
            <Text variant="meta" tone="muted" as="p" sx={styles.columnEmpty}>
              {group.empty}
            </Text>
          ) : (
            <ul {...stylex.props(styles.recentList)}>
              {group.list.slice(0, rows).map((recent) => (
                <RecentRow key={recent.key} recent={recent} chosen={recent.key === chosen} refined={refined} />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  )
}

/** First run: nothing written yet. Says what will show here and how to start. */
export function FirstRunNote() {
  return (
    <div {...stylex.props(styles.firstRun)}>
      <Text variant="ui" weight="medium" as="p">
        People and channels you write to will show here.
      </Text>
      <Text variant="meta" tone="muted" as="p">
        Start with <Kbd look="key">@</Kbd> for a person or <Kbd look="key">#</Kbd> for a channel. Anything else goes to Juno.
      </Text>
    </div>
  )
}

export const hasRecents = (props: HomeWriteProps) => props.people.length + props.channels.length > 0

// ---------------------------------------------------------------------------

const HOVER = '@media (hover: hover)'
// The page column is the composer's: its rows start where the field starts.
const PAGE_WIDTH = layout['--composer-width']

export const tintRows = stylex.create({
  public: { backgroundColor: tints['--tint-public-bg'] },
  private: { backgroundColor: tints['--tint-private-bg'] },
  dm: { backgroundColor: tints['--tint-dm-bg'] },
})

const focusRing = {
  outlineStyle: { default: 'none', ':focus-visible': 'solid' },
  outlineWidth: sizes['--focus-ring-width'],
  outlineOffset: `calc(-1 * ${sizes['--focus-ring-width']})`,
  outlineColor: accent['--focus-ring'],
} as const

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
  // Centred when it fits, from the top when it does not. The inline padding is the composer's, so the edges line up.
  wide: {
    width: '100%',
    maxWidth: `calc(${PAGE_WIDTH} + 2 * ${spacing['--space-6']})`,
    marginInline: 'auto',
    marginBlock: 'auto',
    paddingInline: spacing['--space-6'],
    paddingBlock: spacing['--space-10'],
    boxSizing: 'border-box',
  },
  greeting: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
  },
  greetingStart: {
    alignItems: 'flex-start',
    textAlign: 'start',
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
  titleUnderScene: {
    marginTop: spacing['--space-3-5'],
  },
  line: {
    marginTop: spacing['--space-1-5'],
  },
  header: {
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing['--space-6'],
    paddingInline: spacing['--space-3'],
  },
  headerText: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    paddingBottom: spacing['--space-1'],
  },
  block: {
    marginTop: spacing['--space-8'],
  },
  sectionLabel: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingInline: spacing['--space-3'],
    paddingBottom: spacing['--space-1-5'],
  },
  items: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-0-5'],
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  columns: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', // tokens-allow: The narrowest a column of names reads well.
    columnGap: spacing['--space-6'],
    rowGap: spacing['--space-6'],
  },
  column: {
    minWidth: 0,
  },
  recentList: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-0-5'],
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  recentRow: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2-5'],
    width: '100%',
    height: sizes['--control-40'],
    minWidth: 0,
    paddingInline: spacing['--space-3'],
    borderWidth: 0,
    borderRadius: radii['--radius-xl'],
    backgroundColor: { default: 'transparent', ':hover': { default: null, [HOVER]: colors['--surface-hover'] } },
    color: colors['--foreground-subtle'],
    fontFamily: text['--text-ui-family'],
    fontSize: text['--text-ui-size'],
    lineHeight: text['--text-ui-leading'],
    textAlign: 'start',
    cursor: 'default',
    ...focusRing,
  },
  // A 40px slot, as wide as a Needs you row's art, so names start where its titles start.
  recentRowRefined: {
    gap: spacing['--space-3'],
    paddingInline: spacing['--space-1-5'],
  },
  markSlot: {
    display: 'inline-flex',
    justifyContent: 'center',
    flexShrink: 0,
    width: sizes['--control-40'],
  },
  columnEmpty: {
    margin: 0,
    paddingInline: spacing['--space-3'],
    paddingBlock: spacing['--space-2'],
  },
  recentName: {
    flexShrink: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontWeight: weights['--weight-medium'],
    color: colors['--foreground-default'],
  },
  recentAt: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-1'],
    flexShrink: 0,
    marginInlineStart: 'auto',
    fontFamily: text['--text-meta-family'],
    fontSize: text['--text-meta-size'],
    lineHeight: text['--text-meta-leading'],
    color: colors['--foreground-muted'],
    fontVariantNumeric: 'tabular-nums',
  },
  sentAt: {
    color: colors['--foreground-subtle'],
  },
  // The inset focus ring for buttons that fill their row.
  ring: {
    ...focusRing,
  },
  firstRun: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: spacing['--space-1-5'],
    paddingBlock: spacing['--space-6'],
    textAlign: 'center',
  },
})

/** The page frame and row styles, for the directions' own files. */
export const partStyles = styles
