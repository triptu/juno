import * as stylex from '@stylexjs/stylex'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { accent, colors, opacity as opacityTokens, radii, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { activateHandlers, Button, Icon, Text, type ActivateEvent } from '@juno/ui'
import { PlaceTile } from './PlaceTile'
import { reviewCopy, type ReviewEntry, type ReviewStatus, type ReviewVerbs } from './reviewModel'

// A sheet narrower than this (the minimum window, `ReviewSheet.tsx`'s) puts a row's buttons under its text.
const NARROW = '@container review (width < 460px)'

export interface ReviewRowProps {
  readonly entry: ReviewEntry
  readonly status: ReviewStatus
  readonly verbs: ReviewVerbs
  /** The row is the list's current one: its link is the Tab stop, and the keys act on it. */
  readonly active: boolean
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
export function ReviewRow({ entry, status, verbs, active, onOpen, onAct, onDecline, onUndo, onFocusRow }: ReviewRowProps) {
  const handlers = activateHandlers<HTMLAnchorElement>((event) => onOpen(entry.topicId, event))
  const handled = status !== 'open'
  const words = entry.words ?? verbs
  return (
    <li data-review-row={entry.id} data-review-status={status} {...stylex.props(styles.row)}>
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
        {...stylex.props(styles.link)}
      >
        <span {...stylex.props(styles.art, handled && styles.dim)}>
          <PlaceTile tile={entry} />
        </span>
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
            {words.decline}
          </Button>
          <Button variant="secondary" size="sm" iconStart={words.actIcon} tabIndex={active && !handled ? 0 : -1} onClick={() => onAct(entry.id)} aria-label={`${words.act} ${entry.title}`} data-review-act="">
            {words.act}
          </Button>
        </span>
        <span {...stylex.props(styles.cell, !handled && styles.hidden)} aria-hidden={!handled || undefined} aria-live="polite">
          {/* Both outcomes share one cell too, so the slot is as wide as the widest of all four and never changes. */}
          <span {...stylex.props(styles.outcomes)}>
            <span {...stylex.props(styles.done, styles.outcome, status !== 'done' && styles.hidden)} aria-hidden={status !== 'done' || undefined} data-review-outcome={status === 'done' ? '' : undefined}>
              {words.actIcon === undefined ? null : <Icon icon={words.actIcon} size={13} />}
              <Text variant="bodySmall" tone="subtle">
                {words.done}
              </Text>
            </span>
            <span {...stylex.props(styles.done, styles.outcome, status !== 'declined' && styles.hidden)} aria-hidden={status !== 'declined' || undefined} data-review-outcome={status === 'declined' ? '' : undefined}>
              <Text variant="bodySmall" tone="subtle">
                {words.declined}
              </Text>
            </span>
          </span>
          <Button variant="ghost" tone="muted" size="sm" tabIndex={active && handled ? 0 : -1} onClick={() => onUndo(entry.id)} data-review-undo="">
            {reviewCopy.undo}
          </Button>
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
export function ReviewList({ entries, statuses, verbs, label, initialActive, autoFocus = false, onOpen, onAct, onDecline, onUndo }: ReviewListProps) {
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

const styles = stylex.create({
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
  outcomes: {
    display: 'grid',
    justifyItems: 'end',
  },
  outcome: {
    gridArea: '1 / 1',
  },
  hidden: {
    visibility: 'hidden',
  },
})
