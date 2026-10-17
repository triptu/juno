import * as stylex from '@stylexjs/stylex'
import { Info } from '@phosphor-icons/react/dist/icons/Info'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { accent, colors, layout, opacity as opacityTokens, radii, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { activateHandlers, Button, Icon, IconButton, Kbd, ringRoom, Surface, Text, TopicArt, type ActivateEvent, type PhosphorIcon } from '@juno/ui'

/**
 * The review sheet every self-managing Home card opens
 * (`docs/design/settled-suggestions/`, "More self-management"): Tidy up,
 * follow-ups that look done, old drafts. Each card gives its rows, its
 * words and its two verbs; the sheet, the rows and the keys are the same.
 */

/** What the user did with a row while the review is open: the card's action, its "no", or nothing yet. */
export type ReviewStatus = 'open' | 'done' | 'declined'

/** One proposal as the sheet shows it. */
export interface ReviewEntry {
  /** Unique in the sheet. */
  readonly id: string
  /** The topic the row opens; its art draws the tile. */
  readonly topicId: string
  readonly title: string
  readonly art?: string
  /** Why it is proposed: a fact from the data, in plain words. */
  readonly reason?: string
  /** A message or draft the reason refers to, quoted under it. */
  readonly quote?: string
  /** Where it is and when: "eng · 2d". */
  readonly meta: string
}

/** A card's words for its two buttons, their keys and what a row says once acted on. */
export interface ReviewVerbs {
  /** "Resolve". */
  readonly act: string
  readonly actIcon?: PhosphorIcon
  /** One letter: "R". */
  readonly actKey: string
  /** The "no": "Keep open". */
  readonly decline: string
  readonly declineKey: string
  /** "Resolved". */
  readonly done: string
  /** "Kept open". */
  readonly declined: string
}

/** The words every review shares. */
export const reviewCopy = { undo: 'Undo', close: 'Done', move: 'Move', open: 'Open' } as const

// A sheet narrower than this (the minimum window) puts a row's buttons under its text and drops the key hints.
const NARROW = '@container review (width < 460px)'

export interface ReviewRowProps {
  readonly entry: ReviewEntry
  readonly status: ReviewStatus
  readonly verbs: ReviewVerbs
  /** The row is the list's current one: its link is the Tab stop, and the keys act on it. */
  readonly active: boolean
  /** A row in a narrow card: no art, smaller gaps. */
  readonly compact?: boolean
  readonly onOpen: (topicId: string, event: ActivateEvent) => void
  readonly onAct: (id: string) => void
  readonly onDecline: (id: string) => void
  readonly onUndo: (id: string) => void
  readonly onFocusRow: (id: string) => void
}

/**
 * One proposal: the art, the title, why, the quoted message, and where it
 * is; then the "no" and the action. Once acted on, the row stays where it
 * is and says what happened, with Undo in the same slot, so nothing under
 * the pointer moves.
 */
export function ReviewRow({ entry, status, verbs, active, compact = false, onOpen, onAct, onDecline, onUndo, onFocusRow }: ReviewRowProps) {
  const handlers = activateHandlers<HTMLAnchorElement>((event) => onOpen(entry.topicId, event))
  const handled = status !== 'open'
  return (
    <li data-review-row={entry.id} data-review-status={status} {...stylex.props(styles.row, compact && styles.rowCompact)}>
      <a
        href={`#topic/${encodeURIComponent(entry.topicId)}`}
        tabIndex={active ? 0 : -1}
        aria-keyshortcuts={`${verbs.actKey} ${verbs.declineKey} Enter`}
        {...handlers}
        onClick={(event) => {
          event.preventDefault()
          handlers.onClick(event)
        }}
        onFocus={() => onFocusRow(entry.id)}
        {...stylex.props(styles.link, compact && styles.linkCompact)}
      >
        {compact ? null : (
          <span {...stylex.props(styles.art, handled && styles.dim)}>
            <TopicArt topicId={entry.topicId} recipe={entry.art} size={40} />
          </span>
        )}
        <span {...stylex.props(styles.lines)}>
          <Text variant="ui" weight="medium" tone={handled ? 'subtle' : 'default'} truncate tooltipWhenTruncated data-review-title="">
            {entry.title}
          </Text>
          {entry.reason === undefined ? null : (
            <Text variant="bodySmall" tone="subtle" clamp={2} data-review-reason="">
              {entry.reason}
            </Text>
          )}
          {entry.quote === undefined ? null : (
            <span {...stylex.props(styles.quote)} data-sensitive="" data-review-quote="">
              <Text variant="bodySmall" tone="subtle" clamp={2}>
                {entry.quote}
              </Text>
            </span>
          )}
          <Text variant="meta" tone="muted" truncate numeric>
            {entry.meta}
          </Text>
        </span>
      </a>
      {/* Both sets share one cell, so the slot is as wide as the wider and nothing moves when one replaces the other. */}
      <span {...stylex.props(styles.slot)}>
        <span {...stylex.props(styles.cell, handled && styles.hidden)} aria-hidden={handled || undefined}>
          <Button variant="ghost" tone="muted" size="sm" tabIndex={active && !handled ? 0 : -1} onClick={() => onDecline(entry.id)} data-review-decline="">
            {verbs.decline}
          </Button>
          <Button variant="secondary" size="sm" iconStart={verbs.actIcon} tabIndex={active && !handled ? 0 : -1} onClick={() => onAct(entry.id)} aria-label={`${verbs.act} ${entry.title}`} data-review-act="">
            {verbs.act}
          </Button>
        </span>
        <span {...stylex.props(styles.cell, !handled && styles.hidden)} aria-hidden={!handled || undefined} aria-live="polite">
          {handled ? (
            <>
              <span {...stylex.props(styles.done)} data-review-outcome="">
                {status === 'done' && verbs.actIcon !== undefined ? <Icon icon={verbs.actIcon} size={13} /> : null}
                <Text variant="bodySmall" tone="subtle">
                  {status === 'done' ? verbs.done : verbs.declined}
                </Text>
              </span>
              <Button variant="ghost" tone="muted" size="sm" tabIndex={active ? 0 : -1} onClick={() => onUndo(entry.id)} data-review-undo="">
                {reviewCopy.undo}
              </Button>
            </>
          ) : null}
        </span>
      </span>
    </li>
  )
}

export interface ReviewListProps {
  readonly entries: ReadonlyArray<ReviewEntry>
  readonly statuses: ReadonlyMap<string, ReviewStatus>
  readonly verbs: ReviewVerbs
  readonly label: string
  readonly compact?: boolean
  /** The row whose link takes focus first. The gallery passes one to show a focused row. */
  readonly initialActive?: string
  /** Focus the first row when the list appears, as a sheet does with its first control. */
  readonly autoFocus?: boolean
  readonly onOpen: ReviewRowProps['onOpen']
  readonly onAct: ReviewRowProps['onAct']
  readonly onDecline: ReviewRowProps['onDecline']
  readonly onUndo: ReviewRowProps['onUndo']
}

/**
 * The proposals, one Tab stop: ↑ ↓ (and Home, End) move between rows,
 * Enter opens (⌘Enter in a new tab), and the verbs' two keys act. ⌘Z is
 * Edit › Undo, which undoes the last action; the container follows it.
 */
export function ReviewList({ entries, statuses, verbs, label, compact = false, initialActive, autoFocus = false, onOpen, onAct, onDecline, onUndo }: ReviewListProps) {
  const [active, setActive] = useState(initialActive ?? entries[0]?.id)
  const list = useRef<HTMLUListElement>(null)
  const focusRow = (id: string) => list.current?.querySelector<HTMLElement>(`[data-review-row="${CSS.escape(id)}"] a`)?.focus()
  const first = useRef(autoFocus ? active : undefined)
  useEffect(() => {
    if (first.current !== undefined) focusRow(first.current)
  }, [])
  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const index = entries.findIndex((entry) => entry.id === active)
    const current = entries[index]
    if (current === undefined || event.altKey || event.ctrlKey) return
    const move = (to: number) => {
      const next = entries[Math.max(0, Math.min(entries.length - 1, to))]
      if (next === undefined) return
      event.preventDefault()
      setActive(next.id)
      focusRow(next.id)
    }
    const status = statuses.get(current.id) ?? 'open'
    if (event.key === 'ArrowDown') return move(index + 1)
    if (event.key === 'ArrowUp') return move(index - 1)
    if (event.key === 'Home') return move(0)
    if (event.key === 'End') return move(entries.length - 1)
    if (event.metaKey || event.shiftKey) return
    const key = event.key.toLowerCase()
    const act = key === verbs.actKey.toLowerCase()
    if ((act || key === verbs.declineKey.toLowerCase()) && status === 'open') {
      event.preventDefault()
      if (act) onAct(current.id)
      else onDecline(current.id)
      // On to the next open row, as Mail moves on after an archive.
      const next = entries.slice(index + 1).find((entry) => (statuses.get(entry.id) ?? 'open') === 'open')
      if (next !== undefined) move(entries.indexOf(next))
    }
  }
  return (
    <ul ref={list} aria-label={label} onKeyDown={onKeyDown} {...stylex.props(styles.list)} data-review-list="">
      {entries.map((entry) => (
        <ReviewRow
          key={entry.id}
          entry={entry}
          status={statuses.get(entry.id) ?? 'open'}
          verbs={verbs}
          active={entry.id === active}
          compact={compact}
          onOpen={onOpen}
          onAct={onAct}
          onDecline={onDecline}
          onUndo={onUndo}
          onFocusRow={setActive}
        />
      ))}
    </ul>
  )
}

/** The info button's panel: what the action does, line by line, and the way to the card's settings. */
export interface ReviewAbout {
  /** "What Resolve does". */
  readonly label: string
  readonly lines: ReadonlyArray<string>
  /** "Tidy up settings". */
  readonly settings: string
}

export interface ReviewExplainerProps {
  readonly about: ReviewAbout
  readonly onSettings: () => void
}

/** What the action does, and the way to its settings. */
export function ReviewExplainer({ about, onSettings }: ReviewExplainerProps) {
  return (
    <Surface kind="inset" padding="md" sx={styles.explainer} data-review-explainer="">
      <Text variant="ui" weight="medium">
        {about.label}
      </Text>
      <ul {...stylex.props(styles.points)}>
        {about.lines.map((line) => (
          <li key={line} {...stylex.props(styles.point)}>
            <Text variant="bodySmall" tone="subtle" as="span">
              {line}
            </Text>
          </li>
        ))}
      </ul>
      <span>
        <Button variant="secondary" size="sm" onClick={onSettings} data-review-settings="">
          {about.settings}
        </Button>
      </span>
    </Surface>
  )
}

export interface ReviewSheetProps {
  /** The card, for `data-sheet`: "settled", "followUps", "drafts". */
  readonly name: string
  readonly title: string
  readonly lead: string
  readonly about: ReviewAbout
  readonly verbs: ReviewVerbs
  readonly entries: ReadonlyArray<ReviewEntry>
  readonly statuses: ReadonlyMap<string, ReviewStatus>
  /** The bottom button that acts on every row still open: "Resolve all". Absent for a card without one. */
  readonly all?: string
  /** Start with the info open; the gallery shows it. */
  readonly initialAbout?: boolean
  readonly initialActive?: string
  readonly autoFocus?: boolean
  readonly onOpen: ReviewRowProps['onOpen']
  readonly onAct: ReviewRowProps['onAct']
  readonly onDecline: ReviewRowProps['onDecline']
  readonly onUndo: ReviewRowProps['onUndo']
  readonly onAll?: () => void
  readonly onSettings: () => void
  readonly onClose: () => void
}

/**
 * A card's review (SPEC 12): a sheet with every proposal, why, and the
 * "no" and the action for each; the bulk action, when the card has one,
 * and Done at the bottom, as a Mac sheet has its buttons. The info button
 * says what the action does and leads to the card's settings. A panel for
 * `SheetLayer`, which closes it on Esc and keeps Tab inside.
 */
export function ReviewSheet({ name, title, lead, about, verbs, entries, statuses, all, initialAbout = false, initialActive, autoFocus = false, onOpen, onAct, onDecline, onUndo, onAll, onSettings, onClose }: ReviewSheetProps) {
  const titleId = useId()
  const aboutId = useId()
  const [showAbout, setShowAbout] = useState(initialAbout)
  const left = entries.filter((entry) => (statuses.get(entry.id) ?? 'open') === 'open').length
  return (
    <Surface kind="popover" as="section" role="dialog" aria-labelledby={titleId} aria-modal padding="none" sx={styles.sheet} data-sheet={name}>
      <div {...stylex.props(styles.head)}>
        <span {...stylex.props(styles.titleLine)}>
          <Text variant="heading" as="h2" id={titleId} truncate data-review-heading="">
            {title}
          </Text>
          <IconButton icon={Info} label={about.label} size={28} pressed={showAbout} expanded={showAbout} aria-controls={aboutId} onClick={() => setShowAbout(!showAbout)} data-review-about="" />
        </span>
        <Text variant="bodySmall" tone="subtle" as="p" sx={styles.lead}>
          {lead}
        </Text>
        <div id={aboutId}>{showAbout ? <ReviewExplainer about={about} onSettings={onSettings} /> : null}</div>
      </div>
      <div {...stylex.props(styles.scroll, ringRoom.inline)}>
        <ReviewList entries={entries} statuses={statuses} verbs={verbs} label={title} initialActive={initialActive} autoFocus={autoFocus} onOpen={onOpen} onAct={onAct} onDecline={onDecline} onUndo={onUndo} />
      </div>
      <div {...stylex.props(styles.foot)}>
        <span {...stylex.props(styles.keys)} aria-hidden>
          <Kbd>↑↓</Kbd>
          <Text variant="meta" tone="muted">{reviewCopy.move}</Text>
          <Kbd>↵</Kbd>
          <Text variant="meta" tone="muted">{reviewCopy.open}</Text>
          <Kbd>{verbs.actKey}</Kbd>
          <Text variant="meta" tone="muted">{verbs.act}</Text>
          <Kbd>{verbs.declineKey}</Kbd>
          <Text variant="meta" tone="muted">{verbs.decline}</Text>
        </span>
        <span {...stylex.props(styles.buttons)}>
          <Button variant={all === undefined ? 'primary' : 'secondary'} size="md" onClick={onClose} data-review-close="">
            {reviewCopy.close}
          </Button>
          {all === undefined ? null : (
            <Button variant="primary" size="md" dimmed={left === 0} onClick={left === 0 ? undefined : onAll} data-review-all="">
              {all}
            </Button>
          )}
        </span>
      </div>
    </Surface>
  )
}

const styles = stylex.create({
  sheet: {
    containerType: 'inline-size',
    containerName: 'review',
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    maxWidth: layout['--palette-width'],
    // The layer pads the window by 24 on each side; the list scrolls inside what is left.
    maxHeight: '100%',
    minHeight: 0,
    boxSizing: 'border-box',
  },
  head: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-1'],
    paddingTop: spacing['--space-5'],
    paddingInline: spacing['--space-5'],
    paddingBottom: spacing['--space-3'],
  },
  titleLine: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing['--space-3'],
    minWidth: 0,
  },
  lead: {
    margin: 0,
  },
  explainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-2'],
    marginTop: spacing['--space-2'],
  },
  points: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-1'],
    margin: 0,
    paddingInlineStart: spacing['--space-4'],
  },
  point: {
    color: colors['--foreground-muted'],
  },
  scroll: {
    flexGrow: 1,
    minHeight: 0,
    overflowY: 'auto',
    paddingInline: spacing['--space-2'],
  },
  foot: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing['--space-3'],
    paddingBlock: spacing['--space-3'],
    paddingInline: spacing['--space-5'],
    borderTopWidth: '1px',
    borderTopStyle: 'solid',
    borderTopColor: colors['--border-subtle'],
  },
  keys: {
    display: { default: 'inline-flex', [NARROW]: 'none' },
    alignItems: 'center',
    gap: spacing['--space-1'],
    columnGap: spacing['--space-1-5'],
  },
  buttons: {
    display: 'inline-flex',
    gap: spacing['--space-2'],
    marginInlineStart: 'auto',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-0-5'],
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  row: {
    display: 'flex',
    flexWrap: { default: 'nowrap', [NARROW]: 'wrap' },
    alignItems: 'center',
    gap: spacing['--space-2'],
    minWidth: 0,
    paddingInlineEnd: spacing['--space-2'],
    borderRadius: radii['--radius-xl'],
    backgroundColor: {
      default: 'transparent',
      ':hover': { default: null, '@media (hover: hover)': colors['--surface-hover'] },
      ':has(a:focus-visible)': colors['--surface-hover'],
    },
  },
  rowCompact: {
    paddingInlineEnd: spacing['--space-1-5'],
  },
  link: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-3'],
    flexGrow: 1,
    minWidth: 0,
    paddingBlock: spacing['--space-2'],
    paddingInline: spacing['--space-2'],
    borderRadius: radii['--radius-xl'],
    color: 'inherit',
    textDecoration: 'none',
    cursor: 'default',
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineWidth: sizes['--focus-ring-width'],
    outlineOffset: `calc(-1 * ${sizes['--focus-ring-width']})`,
    outlineColor: accent['--focus-ring'],
  },
  linkCompact: {
    paddingBlock: spacing['--space-1-5'],
  },
  art: {
    display: 'inline-flex',
    flexShrink: 0,
  },
  dim: {
    opacity: opacityTokens['--opacity-dim'],
  },
  lines: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    minWidth: 0,
  },
  // The quoted message or draft, filled as a quote in a message is.
  quote: {
    display: 'flex',
    minWidth: 0,
    marginBlock: spacing['--space-0-5'],
    paddingBlock: spacing['--space-0-5'],
    paddingInline: spacing['--space-2'],
    borderRadius: radii['--radius-md'],
    backgroundColor: colors['--quote-fill'],
  },
  slot: {
    display: 'grid',
    flexShrink: 0,
    // Narrow: on its own line, under the text (the art's 40, the link's 8 and its 12 gap).
    marginInlineStart: { default: 0, [NARROW]: `calc(${spacing['--space-10']} + ${spacing['--space-5']})` },
    paddingBottom: { default: 0, [NARROW]: spacing['--space-2'] },
  },
  cell: {
    gridArea: '1 / 1',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing['--space-1'],
  },
  done: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-1'],
    paddingInline: spacing['--space-2'],
    color: colors['--foreground-subtle'],
  },
  hidden: {
    visibility: 'hidden',
  },
})
