import * as stylex from '@stylexjs/stylex'
import type { KeyboardEvent, ReactNode } from 'react'
import { colors, spacing } from '@juno/tokens/tokens.stylex'
import { Button, EmptyState, ScrollArea, Text } from '@juno/ui'

export type TopicListSectionId = 'pinned' | 'recent'

export interface TopicListSection {
  readonly id: TopicListSectionId
  readonly ids: ReadonlyArray<string>
}

/** Why the list is empty, which picks the drawing and the copy (friendly-layer section 7). */
export type TopicListEmpty = 'caught-up' | 'filtered' | 'quiet'

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
}

const labels: Record<TopicListSectionId, string> = { pinned: 'Pinned', recent: 'Recent' }

/**
 * The scrolling topic list: sticky Pinned and Recent labels over in-flow
 * rows, the empty state when there is nothing to show, and a line after the
 * last row when the window is full. The scrollbar thumb shows only while
 * the pointer is over the list. Arrow keys move focus between rows; the
 * rows themselves activate on Enter.
 */
export function TopicList({ sections, renderRow, empty, quietDays = 7, enterEmpty = true, truncated = false, onClearFilters }: TopicListProps) {
  const shown = sections.filter((section) => section.ids.length > 0)
  const isEmpty = shown.length === 0
  return (
    <ScrollArea role="group" aria-label="Topics" scrollbar="hover" onKeyDown={moveFocus} sx={styles.scroller}>
      {isEmpty && empty !== undefined ? (
        <Empty kind={empty} quietDays={quietDays} enter={enterEmpty} onClearFilters={onClearFilters} />
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
            <div {...stylex.props(styles.rows)}>{section.ids.map(renderRow)}</div>
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

function Empty({ kind, quietDays, enter, onClearFilters }: { readonly kind: TopicListEmpty; readonly quietDays: number; readonly enter: boolean; readonly onClearFilters?: () => void }) {
  const clear =
    onClearFilters === undefined ? undefined : (
      <Button variant="secondary" size="md" onClick={onClearFilters}>
        Clear filters
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
    case 'filtered':
      return <EmptyState illustration="nothing-here" title="Nothing here with these filters" body="Older and resolved topics live in All topics." action={clear} enter={enter} />
    case 'quiet':
      return <EmptyState illustration="nothing-here" title="It's quiet" body={`Topics with activity in the last ${quietDays} days show up here.`} enter={enter} />
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
    paddingInline: spacing['--space-2'],
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
  footer: {
    textAlign: 'center',
    paddingBlock: spacing['--space-4'],
  },
})
