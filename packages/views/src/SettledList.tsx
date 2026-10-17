import * as stylex from '@stylexjs/stylex'
import { Check } from '@phosphor-icons/react/dist/icons/Check'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { HomeTopic } from '@juno/contract'
import { accent, colors, opacity as opacityTokens, radii, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { activateHandlers, Button, Icon, Text, TopicArt, type ActivateEvent } from '@juno/ui'
import { settledCopy, settledReason, type SettledStatus } from './settled'
import { relativeTime } from './time'

// A sheet narrower than this (the minimum window) puts a row's buttons under its text and drops the key hints.
const SETTLED_NARROW = '@container settled (width < 460px)'

export interface SettledRowProps {
  readonly topic: HomeTopic
  readonly status: SettledStatus
  readonly now: number
  /** The row is the list's current one: its link is the Tab stop, and the keys act on it. */
  readonly active: boolean
  /** A row in a narrow card: no art, smaller gaps. */
  readonly compact?: boolean
  readonly onOpen: (topicId: string, event: ActivateEvent) => void
  readonly onResolve: (topicId: string) => void
  readonly onKeep: (topicId: string) => void
  readonly onUndo: (topicId: string) => void
  readonly onFocusRow: (topicId: string) => void
}

/**
 * One proposal: the art, the title, why it looks settled, and where it is
 * and when it last moved; then Keep open and Resolve. Once acted on, the
 * row stays where it is and says what happened, with Undo in the same
 * slot, so nothing under the pointer moves.
 */
export function SettledRow({ topic, status, now, active, compact = false, onOpen, onResolve, onKeep, onUndo, onFocusRow }: SettledRowProps) {
  const handlers = activateHandlers<HTMLAnchorElement>((event) => onOpen(topic.id, event))
  const reason = topic.settled === undefined ? undefined : settledReason(topic.settled, topic.at, now)
  const meta = [topic.place, topic.at === undefined ? undefined : relativeTime(topic.at, now)].filter((part) => part !== undefined && part !== '').join(' · ')
  const handled = status !== 'open'
  return (
    <li data-settled-row={topic.id} data-settled-status={status} {...stylex.props(styles.row, compact && styles.rowCompact)}>
      <a
        href={`#topic/${encodeURIComponent(topic.id)}`}
        tabIndex={active ? 0 : -1}
        aria-keyshortcuts="R K Enter"
        {...handlers}
        onClick={(event) => {
          event.preventDefault()
          handlers.onClick(event)
        }}
        onFocus={() => onFocusRow(topic.id)}
        {...stylex.props(styles.link, compact && styles.linkCompact)}
      >
        {compact ? null : (
          <span {...stylex.props(styles.art, handled && styles.dim)}>
            <TopicArt topicId={topic.id} recipe={topic.art} size={40} />
          </span>
        )}
        <span {...stylex.props(styles.lines)}>
          <Text variant="ui" weight="medium" tone={handled ? 'subtle' : 'default'} truncate tooltipWhenTruncated data-settled-title="">
            {topic.title}
          </Text>
          {reason === undefined ? null : (
            <Text variant="bodySmall" tone="subtle" clamp={2} data-settled-reason="">
              {reason}
            </Text>
          )}
          <Text variant="meta" tone="muted" truncate numeric>
            {meta}
          </Text>
        </span>
      </a>
      {/* Both sets share one cell, so the slot is as wide as the wider and nothing moves when one replaces the other. */}
      <span {...stylex.props(styles.slot)}>
        <span {...stylex.props(styles.cell, handled && styles.hidden)} aria-hidden={handled || undefined}>
          <Button variant="ghost" tone="muted" size="sm" tabIndex={active && !handled ? 0 : -1} onClick={() => onKeep(topic.id)} data-settled-keep="">
            {settledCopy.keep}
          </Button>
          <Button variant="secondary" size="sm" iconStart={Check} tabIndex={active && !handled ? 0 : -1} onClick={() => onResolve(topic.id)} aria-label={`${settledCopy.resolve} ${topic.title}`} data-settled-resolve="">
            {settledCopy.resolve}
          </Button>
        </span>
        <span {...stylex.props(styles.cell, !handled && styles.hidden)} aria-hidden={!handled || undefined} aria-live="polite">
          {handled ? (
            <>
              <span {...stylex.props(styles.done)} data-settled-done="">
                {status === 'resolved' ? <Icon icon={Check} size={13} /> : null}
                <Text variant="bodySmall" tone="subtle">
                  {status === 'resolved' ? settledCopy.resolved : settledCopy.kept}
                </Text>
              </span>
              <Button variant="ghost" tone="muted" size="sm" tabIndex={active ? 0 : -1} onClick={() => onUndo(topic.id)} data-settled-undo="">
                {settledCopy.undo}
              </Button>
            </>
          ) : null}
        </span>
      </span>
    </li>
  )
}

export interface SettledListProps {
  readonly topics: ReadonlyArray<HomeTopic>
  readonly statuses: ReadonlyMap<string, SettledStatus>
  readonly now: number
  readonly label: string
  readonly compact?: boolean
  /** The row whose link takes focus first. The gallery passes one to show a focused row. */
  readonly initialActive?: string
  /** Focus the first row when the list appears, as a sheet does with its first control. */
  readonly autoFocus?: boolean
  readonly onOpen: SettledRowProps['onOpen']
  readonly onResolve: SettledRowProps['onResolve']
  readonly onKeep: SettledRowProps['onKeep']
  readonly onUndo: SettledRowProps['onUndo']
}

/**
 * The proposals, one Tab stop: ↑ ↓ (and Home, End) move between rows,
 * Enter opens (⌘Enter in a new tab), R resolves and K keeps open. ⌘Z is
 * Edit › Undo, which undoes the last action; the container follows it.
 */
export function SettledList({ topics, statuses, now, label, compact = false, initialActive, autoFocus = false, onOpen, onResolve, onKeep, onUndo }: SettledListProps) {
  const [active, setActive] = useState(initialActive ?? topics[0]?.id)
  const list = useRef<HTMLUListElement>(null)
  const focusRow = (id: string) => list.current?.querySelector<HTMLElement>(`[data-settled-row="${CSS.escape(id)}"] a`)?.focus()
  const first = useRef(autoFocus ? active : undefined)
  useEffect(() => {
    if (first.current !== undefined) focusRow(first.current)
  }, [])
  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const index = topics.findIndex((topic) => topic.id === active)
    const current = topics[index]
    if (current === undefined || event.altKey || event.ctrlKey) return
    const move = (to: number) => {
      const next = topics[Math.max(0, Math.min(topics.length - 1, to))]
      if (next === undefined) return
      event.preventDefault()
      setActive(next.id)
      focusRow(next.id)
    }
    const status = statuses.get(current.id) ?? 'open'
    if (event.key === 'ArrowDown') return move(index + 1)
    if (event.key === 'ArrowUp') return move(index - 1)
    if (event.key === 'Home') return move(0)
    if (event.key === 'End') return move(topics.length - 1)
    if (event.metaKey || event.shiftKey) return
    const key = event.key.toLowerCase()
    if ((key === 'r' || key === 'k') && status === 'open') {
      event.preventDefault()
      if (key === 'r') onResolve(current.id)
      else onKeep(current.id)
      // On to the next open row, as Mail moves on after an archive.
      const next = topics.slice(index + 1).find((topic) => (statuses.get(topic.id) ?? 'open') === 'open')
      if (next !== undefined) move(topics.indexOf(next))
    }
  }
  return (
    <ul ref={list} aria-label={label} onKeyDown={onKeyDown} {...stylex.props(styles.list)} data-settled-list="">
      {topics.map((topic) => (
        <SettledRow
          key={topic.id}
          topic={topic}
          status={statuses.get(topic.id) ?? 'open'}
          now={now}
          active={topic.id === active}
          compact={compact}
          onOpen={onOpen}
          onResolve={onResolve}
          onKeep={onKeep}
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
    flexWrap: { default: 'nowrap', [SETTLED_NARROW]: 'wrap' },
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
  slot: {
    display: 'grid',
    flexShrink: 0,
    // Narrow: on its own line, under the text (the art's 40, the link's 8 and its 12 gap).
    marginInlineStart: { default: 0, [SETTLED_NARROW]: `calc(${spacing['--space-10']} + ${spacing['--space-5']})` },
    paddingBottom: { default: 0, [SETTLED_NARROW]: spacing['--space-2'] },
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
