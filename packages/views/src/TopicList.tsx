import * as stylex from '@stylexjs/stylex'
import { useRef, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react'
import { colors, layout, spacing } from '@juno/tokens/tokens.stylex'
import { Button, EmptyState, ScrollArea, Text } from '@juno/ui'

export type TopicListSectionId = 'pinned' | 'recent'

export interface TopicListSection {
  readonly id: TopicListSectionId
  readonly ids: ReadonlyArray<string>
}

/**
 * Why the list is empty, which picks the drawing and the copy (friendly-layer section 7).
 * `syncing`: the first sync has not brought any topic yet. `empty-view`: the selected view has no conversations.
 */
export type TopicListEmpty = 'caught-up' | 'filtered' | 'quiet' | 'syncing' | 'empty-view'

export interface TopicListProps {
  /** Pinned first, then Recent. A section with no ids is skipped. */
  readonly sections: ReadonlyArray<TopicListSection>
  /** Draws one row. The owner wires each id to its own state. */
  readonly renderRow: (id: string) => ReactNode
  /** Shown when every section is empty. Undefined while nothing has arrived yet. */
  readonly empty?: TopicListEmpty
  /** The quiet window, for the empty-state copy. Default 7. */
  readonly quietDays?: number
  /** Play the empty state's entrance. Pass false when it was visible a moment ago. */
  readonly enterEmpty?: boolean
  /** The window is full: say where the rest is instead of paging. */
  readonly truncated?: boolean
  readonly onClearFilters?: () => void
  /** Opens All topics, offered by the quiet and filtered empty states. */
  readonly onViewAll?: () => void
  /** Opens the selected view's sheet, offered when the view has no conversations. */
  readonly onEditView?: () => void
  /** A row got focus, by keyboard or pointer. The owner moves the roving tabindex to it. */
  readonly onRowFocus?: (id: string) => void
  /**
   * The pointer or keyboard focus came into the list (true), or both have
   * left it (false). Focus from a mouse press does not count: the pointer
   * already does. The owner holds the list's order while it is engaged.
   */
  readonly onEngagedChange?: (engaged: boolean) => void
  /** The pointer moved, or keyboard focus moved, inside the list. */
  readonly onTouch?: () => void
}

const labels: Record<TopicListSectionId, string> = { pinned: 'Pinned', recent: 'Recent' }

/**
 * The scrolling topic list: sticky Pinned and Recent labels over in-flow
 * rows, the empty state when there is nothing to show, and a line after the
 * last row when the window is full. The scrollbar thumb shows only while
 * the pointer is over the list. Arrow keys move focus between rows; the
 * rows themselves activate on Enter.
 */
export function TopicList({
  sections,
  renderRow,
  empty,
  quietDays = 7,
  enterEmpty = true,
  truncated = false,
  onClearFilters,
  onViewAll,
  onEditView,
  onRowFocus,
  onEngagedChange,
  onTouch,
}: TopicListProps) {
  const shown = sections.filter((section) => section.ids.length > 0)
  const isEmpty = shown.length === 0
  // Where the pointer and keyboard focus are. Not React state: nothing renders from it.
  const inside = useRef({ pointer: false, keyboard: false })
  const engage = (part: 'pointer' | 'keyboard', now: boolean) => {
    const was = inside.current.pointer || inside.current.keyboard
    inside.current[part] = now
    const is = inside.current.pointer || inside.current.keyboard
    if (is !== was) onEngagedChange?.(is)
  }
  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    const target = event.target
    if (onRowFocus !== undefined && target instanceof HTMLElement && target.matches(ROW) && target.dataset['topicId'] !== undefined) onRowFocus(target.dataset['topicId'])
    const keyboard = target instanceof HTMLElement && target.matches(':focus-visible')
    engage('keyboard', keyboard)
    if (keyboard) onTouch?.()
  }
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) engage('keyboard', false)
  }
  return (
    <ScrollArea
      role="group"
      aria-label="Topics"
      scrollbar="hover"
      onKeyDown={moveFocus}
      onFocus={onFocus}
      onBlur={onBlur}
      onPointerEnter={() => engage('pointer', true)}
      onPointerLeave={() => engage('pointer', false)}
      onPointerMove={onTouch}
      sx={styles.scroller}
    >
      {isEmpty && empty !== undefined ? (
        <Empty kind={empty} quietDays={quietDays} enter={enterEmpty} onClearFilters={onClearFilters} onViewAll={onViewAll} onEditView={onEditView} />
      ) : (
        shown.map((section) => (
          <section key={section.id} aria-label={labels[section.id]} data-topic-section={section.id} {...stylex.props(styles.section)}>
            {/* "Recent" is labelled only when a Pinned section sits above it. */}
            {section.id === 'pinned' || shown.length > 1 ? (
              <div {...stylex.props(styles.label)}>
                <Text variant="sectionLabel" tone="muted" as="h2">
                  {labels[section.id]}
                </Text>
              </div>
            ) : null}
            <div role="list" {...stylex.props(styles.rows)}>
              {section.ids.map(renderRow)}
            </div>
          </section>
        ))
      )}
      {!isEmpty && truncated ? (
        <Text variant="meta" tone="muted" as="p" sx={styles.footer}>
          Older topics are in All topics
        </Text>
      ) : null}
    </ScrollArea>
  )
}

interface EmptyProps {
  readonly kind: TopicListEmpty
  readonly quietDays: number
  readonly enter: boolean
  readonly onClearFilters?: (() => void) | undefined
  readonly onViewAll?: (() => void) | undefined
  readonly onEditView?: (() => void) | undefined
}

/** The empty list: why it is empty, and the next step (SPEC section 16). */
function Empty({ kind, quietDays, enter, onClearFilters, onViewAll, onEditView }: EmptyProps) {
  const clear =
    onClearFilters === undefined ? undefined : (
      <Button variant="secondary" size="md" onClick={onClearFilters}>
        Clear filters
      </Button>
    )
  const viewAll = (variant: 'secondary' | 'ghost') =>
    onViewAll === undefined ? undefined : (
      <Button variant={variant} size="md" onClick={onViewAll}>
        View all topics
      </Button>
    )
  switch (kind) {
    case 'caught-up':
      return (
        <EmptyState
          illustration="caught-up"
          title="You're all caught up"
          body="Nothing unread right now. Older and resolved topics live in All topics."
          action={clear}
          enter={enter}
        />
      )
    case 'filtered': {
      const second = viewAll('ghost')
      const action =
        clear !== undefined && second !== undefined ? (
          <span {...stylex.props(styles.actions)}>
            {clear}
            {second}
          </span>
        ) : (
          (clear ?? second)
        )
      return <EmptyState illustration="nothing-here" title="Nothing here with these filters" body="Older and resolved topics live in All topics." action={action} enter={enter} />
    }
    case 'quiet':
      return <EmptyState illustration="nothing-here" title="It's quiet" body={`Topics with activity in the last ${quietDays} ${quietDays === 1 ? 'day' : 'days'} show up here.`} action={viewAll('secondary')} enter={enter} />
    case 'syncing':
      return <EmptyState title="Getting your topics" body="Juno is reading your conversations from Slack. Topics show up here as they arrive." enter={enter} />
    case 'empty-view': {
      const edit =
        onEditView === undefined ? undefined : (
          <Button variant="secondary" size="md" onClick={onEditView}>
            Edit view
          </Button>
        )
      return <EmptyState illustration="nothing-here" title="No conversations in this view" body="Add channels and people to see their topics here." action={edit} enter={enter} />
    }
  }
}

const ROW = '[data-topic-row]'

/** ArrowUp, ArrowDown, Home and End move focus between rows (performance.md 3.2). */
function moveFocus(event: KeyboardEvent<HTMLDivElement>): void {
  const key = event.key
  if (key !== 'ArrowDown' && key !== 'ArrowUp' && key !== 'Home' && key !== 'End') return
  const target = event.target
  if (!(target instanceof HTMLElement) || !target.matches(ROW)) return
  const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(ROW))
  const index = rows.indexOf(target)
  if (index < 0) return
  const next = key === 'ArrowDown' ? rows[index + 1] : key === 'ArrowUp' ? rows[index - 1] : key === 'Home' ? rows[0] : rows[rows.length - 1]
  if (next === undefined) return
  event.preventDefault()
  next.focus({ preventScroll: true })
  next.scrollIntoView({ block: 'nearest', behavior: 'instant' })
}

const styles = stylex.create({
  // Scroll anchoring keeps the viewport still when rows arrive above it.
  scroller: {
    flexGrow: 1,
    // The sidebar inset on the left; on the right the 10px scrollbar gutter is part of it, so rows sit at the same inset on both sides.
    paddingInlineStart: layout['--sidebar-inset'],
    paddingInlineEnd: `calc(${layout['--sidebar-inset']} - ${layout['--scrollbar-size']})`,
    paddingBottom: spacing['--space-4'],
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
  },
  label: {
    position: 'sticky',
    top: 0,
    zIndex: 1,
    paddingTop: spacing['--space-3-5'],
    paddingBottom: spacing['--space-1-5'],
    paddingInline: spacing['--space-3'],
    backgroundColor: colors['--background-subtle'],
  },
  rows: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-0-5'],
    minWidth: 0,
  },
  actions: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing['--space-2'],
  },
  footer: {
    textAlign: 'center',
    paddingBlock: spacing['--space-4'],
  },
})
