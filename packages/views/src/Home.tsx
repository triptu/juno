import * as stylex from '@stylexjs/stylex'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { useId, type MouseEvent, type ReactNode } from 'react'
import type { AutomatedPlace, HomeItem } from '@juno/contract'
import { accent, colors, layout, motion, radii, sizes, spacing, text, weights } from '@juno/tokens/tokens.stylex'
import { activateHandlers, Button, Icon, Text, TopicArt, type ActivateEvent } from '@juno/ui'
import { HomeScene, type HomeSceneName } from './HomeScene'
import { metaOf, opensReview, rowButtons, TILE_ICONS, type HomeAskAnswer } from './homeRows'

export interface HomeProps {
  readonly scene: HomeSceneName
  /** "Morning, Tushar.", or "All caught up." */
  readonly title: string
  /** Under the greeting only while the first sync runs: `HomeSyncLine`, "Syncing with Slack." or "Syncing 30 of 143 conversations." */
  readonly line?: ReactNode
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
  /** A review card's row (Tidy up, Automated's record, follow-ups that look done, old drafts): opens its review sheet. */
  readonly onReview: (itemId: string) => void
  /** Automated's Move (`automated`) and Keep in All (`kept`). */
  readonly onSort: (itemId: string, to: Exclude<AutomatedPlace, 'ask'>) => void
  /** Right-click on Automated's row: the conversation's menu, with Ignore. */
  readonly onItemMenu: (itemId: string) => void
  /** Dismiss on Automated's record: its moves are not listed again. Without it the card has no button. */
  readonly onDismiss?: (itemId: string) => void
  /** A proactive ask's Start and Not now, and its row, which opens the ask in the Juno chat. Without it the row has no buttons. */
  readonly onAsk?: (itemId: string, answer: HomeAskAnswer) => void
  /** The first sync is still running: `line` says so and items fill in as they land. */
  readonly loading?: boolean
  /** Keep these row slots through a cold visit, including before its items arrive; rows that land later fill them. */
  readonly reservedItems?: number
  /** Pinned at the bottom, where a topic's composer is: Recent, the destination and the field (`HomeWrite` and a `Composer`). */
  readonly composer?: ReactNode
  /** Nothing to show yet (a few milliseconds): the column is empty, the composer is already in its place. */
  readonly waiting?: boolean
  /** The welcome card (`WelcomeCard`, SPEC 4) under the rows; on a short window the scene and greeting give it their room. */
  readonly welcome?: ReactNode
}

/**
 * Home (SPEC section 12): the scene over the greeting and up to three rows
 * in a centred column, and the composer at the bottom, where every topic's
 * composer is. Every size is fixed before data arrives, so nothing moves
 * when a title line is rewritten: a title is one ellipsised line in a 52px
 * row. The column scrolls on its own, so the composer never moves.
 */
export function Home({ scene, title, line, items, done, now, enter = true, onOpen, onMarkDone, onResolveAll, onReview, onSort, onItemMenu, onDismiss, onAsk, loading = false, reservedItems = 0, composer, waiting = false, welcome }: HomeProps) {
  const headingId = useId()
  let step = 0
  const part = () => (enter ? [styles.rise, styles.delay(step++)] : [])
  return (
    <div data-home="" data-home-waiting={waiting ? '' : undefined} data-home-loading={loading ? '' : undefined} aria-busy={loading || undefined} {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.scroll)}>
        {waiting ? null : <div {...stylex.props(styles.column, welcome !== undefined && styles.columnWelcome)}>
          <div {...stylex.props(welcome !== undefined && styles.sceneGives, ...part())}>
            <HomeScene name={scene} />
          </div>
          <div {...stylex.props(styles.greeting, welcome !== undefined && styles.greetingGives, ...part())}>
            <h2 id={headingId} {...stylex.props(styles.title)}>
              {title}
            </h2>
            {line === undefined ? null : (
              <Text variant="body" tone="muted" as="p" numeric sx={styles.line}>
                {line}
              </Text>
            )}
          </div>
          {items.length === 0 && reservedItems === 0 ? null : (
            <ul aria-labelledby={headingId} {...stylex.props(styles.items, welcome !== undefined && styles.itemsWelcome, reservedItems > 0 && styles.itemSlots(reservedItems), ...part())}>
              {items.map((item) => (
                <HomeRow
                  key={item.id}
                  item={item}
                  done={done?.has(item.id) === true}
                  now={now}
                  onOpen={onOpen}
                  onMarkDone={onMarkDone}
                  onResolveAll={onResolveAll}
                  onReview={onReview}
                  onSort={onSort}
                  onItemMenu={onItemMenu}
                  onDismiss={onDismiss}
                  onAsk={onAsk}
                />
              ))}
            </ul>
          )}
          {welcome === undefined ? null : <div data-home-welcome="" {...stylex.props(styles.welcome, ...part())}>{welcome}</div>}
        </div>}
      </div>
      {composer}
    </div>
  )
}

/** A row's own props, and the callbacks Home passes down. */
type HomeRowProps = { readonly item: HomeItem; readonly done: boolean } & Pick<HomeProps, 'now' | 'onOpen' | 'onMarkDone' | 'onResolveAll' | 'onReview' | 'onSort' | 'onItemMenu' | 'onDismiss' | 'onAsk'>

const preventNavigation = (event: MouseEvent) => event.preventDefault()

/**
 * One row: a link to the topic (a review card's opens its review), and its buttons in
 * a slot that is always there: Mark done, Resolve all, Automated's Keep
 * in All and Move, or Dismiss on Automated's record. Automated's row opens the conversation's menu on
 * right-click, where Ignore is.
 */
function HomeRow({ item, done, now, onOpen, onMarkDone, onResolveAll, onReview, onSort, onItemMenu, onDismiss, onAsk }: HomeRowProps) {
  const topic = item.topics[0]
  const tileIcon = TILE_ICONS[item.kind]
  const body = (
    <>
      {tileIcon !== undefined || topic === undefined ? (
        <span {...stylex.props(styles.iconTile)}>
          <Icon icon={tileIcon ?? TILE_ICONS.tidyUp!} size={18} />
        </span>
      ) : (
        <TopicArt topicId={topic.id} recipe={topic.art} size={40} />
      )}
      <span {...stylex.props(styles.text)}>
        {/* An assistant title, and a follow-up's promise, can quote the messages; the plain one only says what kind of thing waits. */}
        <span data-home-title="" data-sensitive={item.aiTitle === undefined && item.kind !== 'followUp' ? undefined : ''} {...stylex.props(styles.itemTitle)}>
          {item.aiTitle ?? item.title}
        </span>
        <span data-home-meta="" {...stylex.props(styles.itemMeta)}>
          {metaOf(item, now)}
        </span>
      </span>
    </>
  )
  const buttons = rowButtons(item, onMarkDone, onResolveAll, onSort, onDismiss, onAsk)
  const handlers = topic === undefined ? undefined : activateHandlers<HTMLAnchorElement>((event) => onOpen(topic.id, event))
  const menu =
    item.kind === 'automated' || item.kind === 'mentioned'
      ? (event: MouseEvent) => {
          event.preventDefault()
          onItemMenu(item.id)
        }
      : undefined
  return (
    <li data-home-item={item.kind} onContextMenu={menu} {...stylex.props(styles.row)}>
      {opensReview(item.kind) || item.kind === 'ask' ? (
        // A review card opens its sheet; a proactive ask opens the Juno chat at it.
        <button type="button" aria-haspopup={item.kind === 'ask' ? undefined : 'dialog'} onClick={() => (item.kind === 'ask' ? onAsk?.(item.id, 'open') : onReview(item.id))} {...stylex.props(styles.link, styles.button, styles.focusable)} data-home-review="">
          {body}
          <span {...stylex.props(styles.caret)}>
            <Icon icon={CaretRight} size={13} />
          </span>
        </button>
      ) : handlers === undefined ? (
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
                <Button key={button.label} variant={button.primary ? 'raised' : 'ghost'} size="sm" tone={button.primary ? 'default' : 'muted'} onClick={button.run}>
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
/** Recent's own threshold (HomeWrite): below it the welcome card takes the scene's and the greeting's room. */
const SHORT = '@container home (height < 560px)'

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
    userSelect: 'none',
    // A size container has no size of its own: it takes the page's width and, as a flex item, its height.
    width: '100%',
    containerType: 'size',
    containerName: 'home',
  },
  // The greeting and the rows scroll on their own, so the composer under them never moves.
  scroll: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    minHeight: 0,
    overflowY: 'auto',
    // Room for a scrollbar on both sides, so the centred column stays put when one comes or goes.
    scrollbarGutter: 'stable both-edges',
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
  // With the welcome card: on a short window the scene and the greeting go and the gaps close up, so the card is whole above the field.
  columnWelcome: { paddingBlock: { default: spacing['--space-12'], [SHORT]: spacing['--space-4'] } },
  sceneGives: { display: { default: 'block', [SHORT]: 'none' } },
  greetingGives: { display: { default: 'flex', [SHORT]: 'none' } },
  itemsWelcome: { marginTop: { default: spacing['--space-8'], [SHORT]: 0 } },
  // The card's own top margin closes up on a short window too (`WelcomeCard`).
  welcome: { width: '100%', maxWidth: layout['--home-width'] },
  // As wide as the greeting and centred in the column, so the syncing line can start under its first letter.
  greeting: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    alignSelf: 'center',
    maxWidth: '100%',
    minWidth: 0,
    marginTop: spacing['--space-3-5'],
    textAlign: 'start',
    position: 'relative',
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
  // In the gap above the rows, so they stay put when it goes. It starts where the greeting starts and its copy
  // runs to the right, so neither "Syncing with Slack." becoming the count nor the count going up moves its first word.
  line: {
    position: 'absolute',
    top: `calc(100% + ${spacing['--space-1-5']})`,
    insetInline: 0,
    margin: 0,
    whiteSpace: 'nowrap',
  },
  itemSlots: (count: number) => ({ minHeight: `calc(${count} * (${sizes['--row-52']} + ${spacing['--space-0-5']}) - ${spacing['--space-0-5']})` }),
  items: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-0-5'],
    width: '100%',
    maxWidth: layout['--home-width'],
    marginTop: spacing['--space-8'],
    marginBottom: 0,
    padding: 0,
    listStyle: 'none',
  },
  // The row is the hover, press and focus surface; its link and its button sit side by side inside it.
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
      // Held down: the press shows in the next frame. Nested as the hover is, or the hover's doubled class outranks it under the pointer.
      ':active': { default: colors['--surface-active'], [HOVER]: colors['--surface-active'] },
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
  // The review button keeps the link's look: no fill, no border, its text at the row's start.
  button: {
    borderWidth: 0,
    backgroundColor: 'transparent',
    padding: 0,
    paddingInlineStart: spacing['--space-1-5'],
    paddingInlineEnd: spacing['--space-1-5'],
    font: 'inherit',
    textAlign: 'start',
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
