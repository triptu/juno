import * as stylex from '@stylexjs/stylex'
import { Check } from '@phosphor-icons/react/dist/icons/Check'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { HomeTopic } from '@juno/contract'
import { accent, colors, opacity as opacityTokens, radii, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { activateHandlers, Button, Icon, Text, TopicArt, type ActivateEvent, type PhosphorIcon } from '@juno/ui'
import { settledCopy, settledReason, type SettledStatus } from './settled'
import { relativeTime } from './time'

/** A row's words: its two buttons, and what it says once one was used. Tidy up's by default. */
export interface ReviewRowCopy {
  /** The main action ("Resolve", "Move back"), the raised button. */
  readonly act: string
  readonly actIcon?: PhosphorIcon
  /** The quiet answer ("Keep open", "Keep"). */
  readonly keep: string
  /** What the row says after the main action ("Resolved") and after the quiet one ("Kept open"). */
  readonly acted: string
  readonly kept: string
}

export const SETTLED_ROW_COPY: ReviewRowCopy = { act: settledCopy.resolve, actIcon: Check, keep: settledCopy.keep, acted: settledCopy.resolved, kept: settledCopy.kept }

/** A row's lines under its title: why it is proposed, and where and when. */
export interface ReviewRowLines {
  readonly reason?: string | undefined
  readonly meta: string
}

/** Tidy up's lines: why the topic looks settled, then its place and last activity. */
export function settledLines(topic: HomeTopic, now: number): ReviewRowLines {
  return {
    reason: topic.settled === undefined ? undefined : settledReason(topic.settled, topic.at, now),
    meta: [topic.place, topic.at === undefined ? undefined : relativeTime(topic.at, now)].filter((part) => part !== undefined && part !== '').join(' · '),
  }
}

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
  /** The buttons' words; Tidy up's when absent. */
  readonly copy?: ReviewRowCopy
  /** The lines under the title; Tidy up's when absent. */
  readonly lines?: ReviewRowLines
  /** The key that takes the main action, for assistive tech: R for Resolve. */
  readonly actKey?: string
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
 * slot, so nothing under the pointer moves. Another review (Automated's
 * record) passes its own `copy` and `lines`; `resolved` is then its main
 * action.
 */
export function SettledRow({ topic, status, now, active, compact = false, copy = SETTLED_ROW_COPY, lines, actKey = 'R', onOpen, onResolve, onKeep, onUndo, onFocusRow }: SettledRowProps) {
  const handlers = activateHandlers<HTMLAnchorElement>((event) => onOpen(topic.id, event))
  const { reason, meta } = lines ?? settledLines(topic, now)
  const handled = status !== 'open'
  return (
    <li data-settled-row={topic.id} data-settled-status={status} {...stylex.props(styles.row, compact && styles.rowCompact)}>
      <a
        href={`#topic/${encodeURIComponent(topic.id)}`}
        tabIndex={active ? 0 : -1}
        aria-keyshortcuts={`${actKey} K Enter`}
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
            {copy.keep}
          </Button>
          <Button variant="secondary" size="sm" iconStart={copy.actIcon} tabIndex={active && !handled ? 0 : -1} onClick={() => onResolve(topic.id)} aria-label={`${copy.act} ${topic.title}`} data-settled-resolve="">
            {copy.act}
          </Button>
        </span>
        <span {...stylex.props(styles.cell, !handled && styles.hidden)} aria-hidden={!handled || undefined} aria-live="polite">
          {/* Both words are always laid out, one hidden, so the slot is as wide as the wider whatever happens. */}
          <span {...stylex.props(styles.done)}>
            <span {...stylex.props(status !== 'resolved' && styles.hidden)}>
              <Icon icon={Check} size={13} />
            </span>
            <span {...stylex.props(styles.words)}>
              {/* `data-settled-done` marks the word shown, so its text is what the row says. */}
              <Text variant="bodySmall" tone="subtle" sx={[styles.word, status !== 'resolved' && styles.hidden]} data-settled-done={status === 'resolved' ? '' : undefined}>
                {copy.acted}
              </Text>
              <Text variant="bodySmall" tone="subtle" sx={[styles.word, status !== 'kept' && styles.hidden]} data-settled-done={status === 'kept' ? '' : undefined}>
                {copy.kept}
              </Text>
            </span>
          </span>
          <Button variant="ghost" tone="muted" size="sm" tabIndex={handled && active ? 0 : -1} onClick={() => onUndo(topic.id)} data-settled-undo="">
            {settledCopy.undo}
          </Button>
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
  /** Each row's words and lines; Tidy up's when absent. */
  readonly copyOf?: (topic: HomeTopic) => ReviewRowCopy
  readonly linesOf?: (topic: HomeTopic) => ReviewRowLines
  /** The key that takes the main action: R (Resolve) by default. K always keeps. */
  readonly actKey?: string
  readonly onOpen: SettledRowProps['onOpen']
  readonly onResolve: SettledRowProps['onResolve']
  readonly onKeep: SettledRowProps['onKeep']
  readonly onUndo: SettledRowProps['onUndo']
}

/**
 * The proposals, one Tab stop: ↑ ↓ (and Home, End) move between rows,
 * Enter opens (⌘Enter in a new tab), R resolves (or `actKey` takes the
 * main action) and K keeps open. ⌘Z is Edit › Undo, which undoes the last
 * action; the container follows it.
 */
export function SettledList({ topics, statuses, now, label, compact = false, initialActive, autoFocus = false, copyOf, linesOf, actKey = 'R', onOpen, onResolve, onKeep, onUndo }: SettledListProps) {
  const act = actKey.toLowerCase()
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
    if ((key === act || key === 'k') && status === 'open') {
      event.preventDefault()
      if (key === act) onResolve(current.id)
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
          {...(copyOf === undefined ? {} : { copy: copyOf(topic) })}
          {...(linesOf === undefined ? {} : { lines: linesOf(topic) })}
          actKey={actKey}
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
  words: {
    display: 'grid',
    justifyItems: 'end',
  },
  word: {
    gridArea: '1 / 1',
  },
  hidden: {
    visibility: 'hidden',
  },
})
