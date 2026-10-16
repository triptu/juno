import * as stylex from '@stylexjs/stylex'
import { Broom } from '@phosphor-icons/react/dist/icons/Broom'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { Robot } from '@phosphor-icons/react/dist/icons/Robot'
import { Sparkle } from '@phosphor-icons/react/dist/icons/Sparkle'
import { useId, type MouseEvent, type ReactNode } from 'react'
import type { AutomatedPlace, HomeItem } from '@juno/contract'
import { accent, colors, layout, motion, radii, sizes, spacing, text, weights } from '@juno/tokens/tokens.stylex'
import { activateHandlers, Button, Icon, Kbd, Text, TopicArt, type ActivateEvent } from '@juno/ui'
import { HomeScene, type HomeSceneName } from './HomeScene'
import { relativeTime } from './time'

export interface HomeProps {
  readonly scene: HomeSceneName
  /** "Morning, Tushar." */
  readonly title: string
  /** "Two things want you." */
  readonly line: string
  /** Already ranked and capped. */
  readonly items: ReadonlyArray<HomeItem>
  /** Items whose button was used: the button is gone, its slot stays. */
  readonly done?: ReadonlySet<string>
  readonly now: number
  /** Play the entrance. False when Home comes back from a hidden tab. */
  readonly enter?: boolean
  /** Fires on mouse down; `event.metaKey` asks for a new tab. */
  readonly onOpen: (topicId: string, event: ActivateEvent) => void
  readonly onMarkDone: (itemId: string) => void
  readonly onResolveAll: (itemId: string) => void
  /** Automated's Move (`automated`) and Keep in All (`kept`). */
  readonly onSort: (itemId: string, to: Exclude<AutomatedPlace, 'ask'>) => void
  /** Right-click on Automated's row: the conversation's menu, with Ignore. */
  readonly onItemMenu: (itemId: string) => void
  /** Opens the Juno chat. Absent with AI assist off, which leaves the field out. */
  readonly onAsk?: () => void
  /** A running job's state line, shown in the field in place of "Ask Juno…" (SPEC 13.4). */
  readonly askLine?: string
  /** The first sync is still running: `line` says so and items fill in as they land. */
  readonly loading?: boolean
  /** Keep these row slots through a cold visit, including before its items arrive; rows that land later fill them. */
  readonly reservedItems?: number
  /** Closes the column, under the ask field: the merged Home's writing block (proposal fixtures). */
  readonly below?: ReactNode
}

/**
 * Home, layout A (SPEC section 12, `docs/design/home/`): the scene over the
 * greeting, up to three rows in a fixed column, and the Ask Juno field.
 * Every size is fixed before data arrives, so nothing moves when a title
 * line is rewritten: a title is one ellipsised line in a 52px row.
 */
export function Home({ scene, title, line, items, done, now, enter = true, onOpen, onMarkDone, onResolveAll, onSort, onItemMenu, onAsk, askLine, loading = false, reservedItems = 0, below }: HomeProps) {
  const headingId = useId()
  let step = 0
  const part = () => (enter ? [styles.rise, styles.delay(step++)] : [])
  return (
    <div data-home="" data-home-loading={loading ? '' : undefined} aria-busy={loading || undefined} {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.column)}>
        <div {...stylex.props(...part())}>
          <HomeScene name={scene} />
        </div>
        <div {...stylex.props(styles.greeting, ...part())}>
          <h2 id={headingId} {...stylex.props(styles.title)}>
            {title}
          </h2>
          <Text variant="body" tone="muted" as="p" sx={styles.line}>
            {line}
          </Text>
        </div>
        {items.length === 0 && reservedItems === 0 ? null : (
          <ul aria-labelledby={headingId} {...stylex.props(styles.items, reservedItems > 0 && styles.itemSlots(reservedItems), ...part())}>
            {items.map((item) => (
              <HomeRow
                key={item.id}
                item={item}
                done={done?.has(item.id) === true}
                now={now}
                onOpen={onOpen}
                onMarkDone={onMarkDone}
                onResolveAll={onResolveAll}
                onSort={onSort}
                onItemMenu={onItemMenu}
              />
            ))}
          </ul>
        )}
        {onAsk === undefined ? null : (
          <button type="button" aria-label="Ask Juno" aria-keyshortcuts="Meta+J" onClick={onAsk} {...stylex.props(styles.ask, ...part())}>
            <Icon icon={Sparkle} size={16} weight="duotone" />
            <span data-ask-line={askLine === undefined ? undefined : ''} {...stylex.props(styles.askText)}>
              {askLine ?? 'Ask Juno…'}
            </span>
            <Kbd look="key">⌘J</Kbd>
          </button>
        )}
        {below}
      </div>
    </div>
  )
}

interface HomeRowProps {
  readonly item: HomeItem
  readonly done: boolean
  readonly now: number
  readonly onOpen: (topicId: string, event: ActivateEvent) => void
  readonly onMarkDone: (itemId: string) => void
  readonly onResolveAll: (itemId: string) => void
  readonly onSort: HomeProps['onSort']
  readonly onItemMenu: HomeProps['onItemMenu']
}

/** The meta line: plain data, the same with and without AI. */
function metaOf(item: HomeItem, now: number): string {
  if (item.kind === 'automated') return item.reason === undefined ? 'To Automated' : `To Automated · ${item.reason}`
  if (item.kind === 'tidyUp') return item.topics.map((topic) => topic.title).join(', ')
  const topic = item.topics[0]
  const last = item.kind === 'moved' ? `${item.newCount ?? 0} new` : item.at === undefined ? undefined : relativeTime(item.at, now)
  const first = topic?.title
  const place = topic?.place
  return [first, place, last].filter((part) => part !== undefined && part !== '').join(' · ')
}

const preventNavigation = (event: MouseEvent) => event.preventDefault()

/**
 * One row: a link to the topic (Tidy up opens nothing), and its buttons in
 * a slot that is always there: Mark done, Resolve all, or Automated's Keep
 * in All and Move. Automated's row opens the conversation's menu on
 * right-click, where Ignore is.
 */
function HomeRow({ item, done, now, onOpen, onMarkDone, onResolveAll, onSort, onItemMenu }: HomeRowProps) {
  const topic = item.topics[0]
  const tileIcon = item.kind === 'tidyUp' ? Broom : item.kind === 'automated' ? Robot : undefined
  const body = (
    <>
      {tileIcon !== undefined || topic === undefined ? (
        <span {...stylex.props(styles.iconTile)}>
          <Icon icon={tileIcon ?? Broom} size={18} />
        </span>
      ) : (
        <TopicArt topicId={topic.id} recipe={topic.art} size={40} />
      )}
      <span {...stylex.props(styles.text)}>
        {/* An assistant title can quote the messages; the plain one only says what kind of thing waits. */}
        <span data-home-title="" data-sensitive={item.aiTitle === undefined ? undefined : ''} {...stylex.props(styles.itemTitle)}>
          {item.aiTitle ?? item.title}
        </span>
        <span data-home-meta="" {...stylex.props(styles.itemMeta)}>
          {metaOf(item, now)}
        </span>
      </span>
    </>
  )
  const buttons =
    item.kind === 'followUp'
      ? [{ label: 'Mark done', run: () => onMarkDone(item.id) }]
      : item.kind === 'tidyUp'
        ? [{ label: 'Resolve all', run: () => onResolveAll(item.id) }]
        : item.kind === 'automated'
          ? [
              { label: 'Keep in All', run: () => onSort(item.id, 'kept') },
              { label: 'Move', run: () => onSort(item.id, 'automated') },
            ]
          : []
  const handlers = topic === undefined ? undefined : activateHandlers<HTMLAnchorElement>((event) => onOpen(topic.id, event))
  const menu =
    item.kind === 'automated'
      ? (event: MouseEvent) => {
          event.preventDefault()
          onItemMenu(item.id)
        }
      : undefined
  return (
    <li data-home-item={item.kind} onContextMenu={menu} {...stylex.props(styles.row)}>
      {item.kind === 'tidyUp' || handlers === undefined ? (
        <div {...stylex.props(styles.link)}>{body}</div>
      ) : (
        <a
          href={`#topic/${encodeURIComponent(topic!.id)}`}
          {...handlers}
          onClick={(event) => {
            preventNavigation(event)
            handlers.onClick(event)
          }}
          {...stylex.props(styles.link, styles.focusable)}
        >
          {body}
          <span {...stylex.props(styles.caret)}>
            <Icon icon={CaretRight} size={13} />
          </span>
        </a>
      )}
      {buttons.length === 0 ? null : (
        <span {...stylex.props(styles.slot)}>
          {done
            ? null
            : buttons.map((button) => (
                <Button key={button.label} variant={button.label === 'Move' ? 'raised' : 'ghost'} size="sm" tone={button.label === 'Move' ? 'default' : 'muted'} onClick={button.run}>
                  {button.label}
                </Button>
              ))}
        </span>
      )}
    </li>
  )
}

const HOVER = '@media (hover: hover)'
// The column's 480 and its 48 on each side: under this the page keeps 24 on each side, and the column takes the rest.
const NARROW = '@container home (width < 576px)'

const rise = stylex.keyframes({
  from: { opacity: 0 },
  to: { opacity: 1 },
})

const styles = stylex.create({
  root: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    minHeight: 0,
    overflowY: 'auto',
    userSelect: 'none',
    // A size container has no width of its own: it takes the page's.
    width: '100%',
    containerType: 'inline-size',
    containerName: 'home',
  },
  // Centred in the page, and scrolls from the top when the window is shorter than it.
  column: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    marginBlock: 'auto',
    paddingBlock: spacing['--space-12'],
    paddingInline: { default: spacing['--space-12'], [NARROW]: spacing['--space-6'] },
  },
  greeting: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    maxWidth: '100%',
    minWidth: 0,
    marginTop: spacing['--space-3-5'],
    textAlign: 'center',
  },
  title: {
    margin: 0,
    fontFamily: text['--text-greeting-family'],
    fontSize: text['--text-greeting-size'],
    fontWeight: text['--text-greeting-weight'],
    lineHeight: text['--text-greeting-leading'],
    letterSpacing: text['--text-greeting-tracking'],
    color: colors['--foreground-default'],
    // One line always (the layout is fixed before data arrives); a name too long for the window takes an ellipsis.
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: '100%',
  },
  line: {
    marginTop: spacing['--space-1-5'],
  },
  itemSlots: (count: number) => ({ minHeight: `calc(${count} * (${sizes['--row-52']} + ${spacing['--space-0-5']}) - ${spacing['--space-0-5']})` }),
  items: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-0-5'],
    width: '100%',
    maxWidth: layout['--home-width'],
    marginTop: spacing['--space-6'],
    marginBottom: 0,
    padding: 0,
    listStyle: 'none',
  },
  // The row is the hover and focus surface; its link and its button sit side by side inside it.
  row: {
    display: 'flex',
    alignItems: 'center',
    height: sizes['--row-52'],
    minWidth: 0,
    paddingInlineEnd: spacing['--space-1-5'],
    borderRadius: radii['--radius-3xl'],
    backgroundColor: {
      default: 'transparent',
      ':hover': { default: null, [HOVER]: colors['--surface-hover'] },
      ':has(:focus-visible)': colors['--surface-hover'],
    },
    // The caret and the row button read this: shown on hover and on keyboard focus only. Only opacity changes.
    '--home-action-opacity': {
      default: '0',
      ':hover': { default: null, [HOVER]: '1' },
      ':has(:focus-visible)': '1',
    },
  },
  link: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-3'],
    flexGrow: 1,
    minWidth: 0,
    height: '100%',
    paddingInlineStart: spacing['--space-1-5'],
    paddingInlineEnd: spacing['--space-1-5'],
    borderRadius: radii['--radius-3xl'],
    color: 'inherit',
    textDecoration: 'none',
    cursor: 'default',
  },
  focusable: {
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineWidth: sizes['--focus-ring-width'],
    outlineOffset: `calc(-1 * ${sizes['--focus-ring-width']})`,
    outlineColor: accent['--focus-ring'],
  },
  iconTile: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: sizes['--tile-36'],
    height: sizes['--tile-36'],
    marginInline: spacing['--space-0-5'],
    borderRadius: radii['--radius-xl'],
    backgroundColor: colors['--secondary-default'],
    color: colors['--foreground-subtle'],
  },
  text: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    minWidth: 0,
  },
  itemTitle: {
    fontFamily: text['--text-ui-family'],
    fontSize: text['--text-ui-size'],
    fontWeight: weights['--weight-medium'],
    lineHeight: text['--text-ui-leading'],
    color: colors['--foreground-default'],
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  itemMeta: {
    fontFamily: text['--text-meta-family'],
    fontSize: text['--text-meta-size'],
    lineHeight: text['--text-meta-leading'],
    color: colors['--foreground-muted'],
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    fontVariantNumeric: 'tabular-nums',
  },
  caret: {
    display: 'inline-flex',
    flexShrink: 0,
    color: colors['--foreground-muted'],
    opacity: 'var(--home-action-opacity)',
  },
  // Reserved whether or not the button shows, so a row's text never reflows.
  slot: {
    display: 'inline-flex',
    justifyContent: 'flex-end',
    gap: spacing['--space-0-5'],
    flexShrink: 0,
    opacity: 'var(--home-action-opacity)',
  },
  ask: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2-5'],
    width: '100%',
    maxWidth: layout['--home-width'],
    height: sizes['--control-40'],
    marginTop: spacing['--space-6'],
    paddingInlineStart: spacing['--space-3-5'],
    paddingInlineEnd: spacing['--space-3'],
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors['--input-border'],
    borderRadius: radii['--radius-pill'],
    backgroundColor: {
      default: colors['--surface-default'],
      ':hover': { default: null, [HOVER]: colors['--surface-hover'] },
    },
    color: colors['--foreground-subtle'],
    fontFamily: text['--text-body-family'],
    fontSize: text['--text-body-size'],
    textAlign: 'start',
    cursor: 'default',
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineWidth: sizes['--focus-ring-width'],
    outlineOffset: sizes['--focus-ring-offset'],
    scrollMargin: sizes['--focus-ring-room'],
    outlineColor: accent['--focus-ring'],
    transitionProperty: 'background-color',
    transitionDuration: motion['--duration-fast'],
  },
  // One line: a long job line takes an ellipsis instead of moving the page.
  askText: {
    flexGrow: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: colors['--foreground-muted'],
  },
  rise: {
    animationName: rise,
    animationDuration: motion['--duration-appear'],
    animationTimingFunction: motion['--ease-out'],
    animationFillMode: 'both',
  },
  delay: (step: number) => ({
    animationDelay: `calc(${motion['--stagger']} * ${step})`,
  }),
})
