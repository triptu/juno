import * as stylex from '@stylexjs/stylex'
import { Check } from '@phosphor-icons/react/dist/icons/Check'
import { Info } from '@phosphor-icons/react/dist/icons/Info'
import { useId, useRef, useState, type KeyboardEvent } from 'react'
import type { HomeTopic, SettledWhy } from '@juno/contract'
import { accent, colors, layout, opacity as opacityTokens, radii, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { activateHandlers, Button, Icon, IconButton, Kbd, ringRoom, Surface, Text, TopicArt, type ActivateEvent } from '@juno/ui'
import { relativeTime } from './time'

/** What the user did with a proposal while the review is open. */
export type SettledStatus = 'open' | 'resolved' | 'kept'

/** The words Tidy up uses, shared by the review and Settings › Tidy up (SPEC 12 and 14). */
export const settledCopy = {
  title: (count: number) => (count === 1 ? '1 topic looks settled' : `${count} topics look settled`),
  lead: 'Juno thinks these are finished. Open one to check it first.',
  about: 'What Resolve does',
  explain: [
    'Hides the topic from the sidebar. It stays in All topics, under Resolved.',
    'Marks it read. Nothing is posted to Slack. With Mark messages read in Slack too on, Slack shows it read on your other devices.',
    'A new message brings it back to the sidebar, tagged Reopened.',
    'Keep open stops Juno suggesting it until someone writes in it again.',
  ],
  settings: 'Tidy up settings',
  resolve: 'Resolve',
  keep: 'Keep open',
  undo: 'Undo',
  resolved: 'Resolved',
  kept: 'Kept open',
  resolveAll: 'Resolve all',
  done: 'Done',
} as const

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** A quiet stretch in words: "40 minutes", "3 hours", "1 day", "6 days", "2 weeks". */
export function quietSpan(millis: number): string {
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`
  if (millis < HOUR) return plural(Math.max(1, Math.floor(millis / MINUTE)), 'minute')
  if (millis < DAY) return plural(Math.floor(millis / HOUR), 'hour')
  if (millis < 14 * DAY) return plural(Math.floor(millis / DAY), 'day')
  return plural(Math.floor(millis / (7 * DAY)), 'week')
}

/**
 * Why a topic looks settled, in plain words, from what its last messages
 * showed: "Ended with a thank-you from Maya", "No replies for 6 days after
 * your answer". With no closing words, the decision's own clause when it
 * gave one, marked as Juno's.
 */
export function settledReason(why: SettledWhy, at: number | undefined, now: number): string {
  const span = at === undefined ? undefined : quietSpan(Math.max(0, now - at))
  switch (why.kind) {
    case 'thanks':
      return why.by === undefined ? 'Ended with your thank-you' : `Ended with a thank-you from ${why.by}`
    case 'done':
      return why.by === undefined ? "You said it's done" : `${why.by} said it's done`
    case 'agreed':
      return why.by === undefined ? 'Ended with your OK' : `Ended with an OK from ${why.by}`
    case 'afterYou':
      return span === undefined ? 'No replies after your answer' : `No replies for ${span} after your answer`
    case 'quiet':
      if (why.juno !== undefined) return `Juno: ${why.juno}`
      return span === undefined ? 'No replies since' : `No replies for ${span}`
  }
}

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
          <Text variant="ui" weight="medium" tone={handled ? 'subtle' : 'default'} truncate data-settled-title="">
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
  readonly onOpen: SettledRowProps['onOpen']
  readonly onResolve: SettledRowProps['onResolve']
  readonly onKeep: SettledRowProps['onKeep']
  readonly onUndo: SettledRowProps['onUndo']
}

/**
 * The proposals, one Tab stop: ↑ ↓ (and Home, End) move between rows,
 * Enter opens (⌘Enter in a new tab), R resolves, K keeps open, and ⌘Z
 * undoes the current row.
 */
export function SettledList({ topics, statuses, now, label, compact = false, initialActive, onOpen, onResolve, onKeep, onUndo }: SettledListProps) {
  const [active, setActive] = useState(initialActive ?? topics[0]?.id)
  const list = useRef<HTMLUListElement>(null)
  const focusRow = (id: string) => list.current?.querySelector<HTMLElement>(`[data-settled-row="${CSS.escape(id)}"] a`)?.focus()
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
    if (event.metaKey && event.key.toLowerCase() === 'z' && status !== 'open') {
      event.preventDefault()
      return onUndo(current.id)
    }
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

export interface ResolveExplainerProps {
  readonly onSettings: () => void
}

/** What Resolve does, in four lines, and the way to Settings › Tidy up. */
export function ResolveExplainer({ onSettings }: ResolveExplainerProps) {
  return (
    <Surface kind="inset" padding="md" sx={styles.explainer} data-settled-explainer="">
      <Text variant="ui" weight="medium">
        {settledCopy.about}
      </Text>
      <ul {...stylex.props(styles.points)}>
        {settledCopy.explain.map((line) => (
          <li key={line} {...stylex.props(styles.point)}>
            <Text variant="bodySmall" tone="subtle" as="span">
              {line}
            </Text>
          </li>
        ))}
      </ul>
      <span>
        <Button variant="secondary" size="sm" onClick={onSettings} data-settled-settings="">
          {settledCopy.settings}
        </Button>
      </span>
    </Surface>
  )
}

export interface SettledReviewProps {
  readonly topics: ReadonlyArray<HomeTopic>
  readonly statuses: ReadonlyMap<string, SettledStatus>
  readonly now: number
  /** Start with What Resolve does open; the gallery shows it. */
  readonly initialAbout?: boolean
  readonly initialActive?: string
  readonly onOpen: SettledRowProps['onOpen']
  readonly onResolve: SettledRowProps['onResolve']
  readonly onKeep: SettledRowProps['onKeep']
  readonly onUndo: SettledRowProps['onUndo']
  /** Resolves every proposal still open. */
  readonly onResolveAll: () => void
  readonly onSettings: () => void
  readonly onClose: () => void
}

/**
 * Tidy up's review (SPEC 12): a sheet with every topic that looks settled,
 * why, and Resolve or Keep open for each; Resolve all and Done at the
 * bottom, as a Mac sheet has its buttons. The info button says what
 * Resolve does and leads to Settings › Tidy up. A panel for `SheetLayer`,
 * which closes it on Esc and keeps Tab inside.
 */
export function SettledReview({ topics, statuses, now, initialAbout = false, initialActive, onOpen, onResolve, onKeep, onUndo, onResolveAll, onSettings, onClose }: SettledReviewProps) {
  const titleId = useId()
  const aboutId = useId()
  const [about, setAbout] = useState(initialAbout)
  const left = topics.filter((topic) => (statuses.get(topic.id) ?? 'open') === 'open').length
  return (
    <Surface kind="popover" as="section" role="dialog" aria-labelledby={titleId} aria-modal padding="none" sx={styles.sheet} data-sheet="settled">
      <div {...stylex.props(styles.head)}>
        <span {...stylex.props(styles.titleLine)}>
          <Text variant="heading" as="h2" id={titleId} truncate>
            {settledCopy.title(topics.length)}
          </Text>
          <IconButton icon={Info} label={settledCopy.about} size={28} pressed={about} expanded={about} aria-controls={aboutId} onClick={() => setAbout(!about)} data-settled-about="" />
        </span>
        <Text variant="bodySmall" tone="subtle" as="p" sx={styles.lead}>
          {settledCopy.lead}
        </Text>
        <div id={aboutId}>{about ? <ResolveExplainer onSettings={onSettings} /> : null}</div>
      </div>
      <div {...stylex.props(styles.scroll, ringRoom.inline)}>
        <SettledList topics={topics} statuses={statuses} now={now} label={settledCopy.title(topics.length)} initialActive={initialActive} onOpen={onOpen} onResolve={onResolve} onKeep={onKeep} onUndo={onUndo} />
      </div>
      <div {...stylex.props(styles.foot)}>
        <span {...stylex.props(styles.keys)} aria-hidden>
          <Kbd>↑↓</Kbd>
          <Text variant="meta" tone="muted">Move</Text>
          <Kbd>↵</Kbd>
          <Text variant="meta" tone="muted">Open</Text>
          <Kbd>R</Kbd>
          <Text variant="meta" tone="muted">Resolve</Text>
          <Kbd>K</Kbd>
          <Text variant="meta" tone="muted">Keep open</Text>
        </span>
        <span {...stylex.props(styles.buttons)}>
          <Button variant="secondary" size="md" onClick={onClose} data-settled-close="">
            {settledCopy.done}
          </Button>
          <Button variant="primary" size="md" dimmed={left === 0} onClick={left === 0 ? undefined : onResolveAll} data-settled-resolve-all="">
            {settledCopy.resolveAll}
          </Button>
        </span>
      </div>
    </Surface>
  )
}

// A sheet narrower than this (the minimum window) puts a row's buttons under its text and drops the key hints.
const NARROW = '@container settled (width < 460px)'

const styles = stylex.create({
  sheet: {
    containerType: 'inline-size',
    containerName: 'settled',
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
})
