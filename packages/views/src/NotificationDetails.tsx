import * as stylex from '@stylexjs/stylex'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { colors, layout, spacing } from '@juno/tokens/tokens.stylex'
import { Button, Segmented, Surface, Text, ringRoom } from '@juno/ui'
import { DecisionRow } from './DecisionRow'
import type { Decision, InstructionDirection } from './notificationRules'

export type DetailsFilter = 'all' | 'notified' | 'stayed'

/** An instruction Should have notified or Shouldn't have notified proposes. */
export interface ProposedInstruction {
  readonly direction: InstructionDirection
  readonly text: string
}

/** What a row's why can do. Each takes the decision it is about. */
export interface WhyActions {
  /** Opens the setting that decided: the hours, a level, Ignored or an Always notify switch. */
  readonly onChange: (decision: Decision) => void
  readonly onEditInstructions: () => void
  /** Should have notified or Shouldn't have notified: asks for the instruction to propose. */
  readonly onSuggest: (decision: Decision) => void
  /** Add it: adds the instruction, and the proposal goes. */
  readonly onAddInstruction: (decision: Decision, instruction: ProposedInstruction) => void
  /** Just this time: adds nothing, and the proposal goes. */
  readonly onDismissSuggestion: (decision: Decision) => void
  /** Always for Maya, on a DM on Auto. */
  readonly onAlways: (decision: Decision) => void
  /** Settings › Notifications at How Auto decides. */
  readonly onSettings: () => void
}

export interface NotificationDetailsProps extends WhyActions {
  /** Today's decisions, newest first; undefined while they load, when the list waits empty. */
  readonly decisions: ReadonlyArray<Decision> | undefined
  /** The instruction proposed for a decision, once the owner asked. */
  readonly proposals: ReadonlyMap<string, ProposedInstruction>
  /** A DM on Auto: the person's first name for Always for Maya, by decision id. */
  readonly alwaysFor: ReadonlyMap<string, string>
  /** Today's counts from the page: the whole day's, for the filter, also while the decisions load or when the list is capped. */
  readonly notifiedToday: number
  readonly stayedToday: number
  /** The list holds only the latest of today's decisions. */
  readonly capped?: boolean
  readonly onClose: () => void
  readonly initialFilter?: DetailsFilter
  /** The row whose why starts open (fixtures). */
  readonly initialOpen?: string
}

/** One object for every row, which calls the latest props: a toggle or a filter re-renders only the rows it changes. */
function useLatestActions(props: WhyActions): WhyActions {
  const latest = useRef<WhyActions>(props)
  useEffect(() => {
    latest.current = props
  })
  return useMemo<WhyActions>(
    () => ({
      onChange: (decision) => latest.current.onChange(decision),
      onEditInstructions: () => latest.current.onEditInstructions(),
      onSuggest: (decision) => latest.current.onSuggest(decision),
      onAddInstruction: (decision, instruction) => latest.current.onAddInstruction(decision, instruction),
      onDismissSuggestion: (decision) => latest.current.onDismissSuggestion(decision),
      onAlways: (decision) => latest.current.onAlways(decision),
      onSettings: () => latest.current.onSettings(),
    }),
    [],
  )
}

/** The title, Done, and the filter. */
function DetailsHead({ titleId, filter, onFilter, total, notified, onClose }: { readonly titleId: string; readonly filter: DetailsFilter; readonly onFilter: (filter: DetailsFilter) => void; readonly total: number; readonly notified: number; readonly onClose: () => void }) {
  return (
    <div {...stylex.props(styles.head)}>
      <span {...stylex.props(styles.titleLine)}>
        <span {...stylex.props(styles.titles)}>
          <Text variant="heading" as="h2" id={titleId}>
            Today's notifications
          </Text>
          <Text variant="bodySmall" tone="subtle" as="p">
            Every message Juno decided on today, and why.
          </Text>
        </span>
        <Button variant="primary" size="md" onClick={onClose}>
          Done
        </Button>
      </span>
      {/* Choosing a filter changes the list under it, on purpose. */}
      <span data-expands-in-place="">
        <Segmented
          label="Show"
          value={filter}
          onChange={onFilter}
          options={[
            { value: 'all', label: 'All', count: total },
            { value: 'notified', label: 'Notified', count: notified },
            { value: 'stayed', label: 'Stayed in Juno', count: total - notified },
          ]}
        />
      </span>
    </div>
  )
}

/**
 * Today's notifications (SPEC 14, "Today"; inventory 13): every decision
 * of the day, newest first, filterable by outcome. Choosing a row opens
 * its why under it: the reason, the action that fits what decided it,
 * and the way to Settings › Notifications. A panel for `SheetLayer`.
 */
export function NotificationDetails(props: NotificationDetailsProps) {
  const { decisions: loaded, notifiedToday, stayedToday, capped = false, proposals, alwaysFor, onClose, initialFilter = 'all', initialOpen } = props
  const titleId = useId()
  const list = useRef<HTMLDivElement>(null)
  // A why that starts open is shown in view.
  useEffect(() => {
    if (initialOpen !== undefined) list.current?.querySelector(`[data-decision="${initialOpen}"]`)?.scrollIntoView({ block: 'center', behavior: 'instant' })
  }, [initialOpen])
  const [filter, setFilter] = useState<DetailsFilter>(initialFilter)
  const [open, setOpen] = useState<string | undefined>(initialOpen)
  const toggle = useCallback((id: string) => setOpen((shown) => (shown === id ? undefined : id)), [])
  const actions = useLatestActions(props)
  const decisions = loaded ?? []
  const notified = notifiedToday
  const total = notifiedToday + stayedToday
  const shown = filter === 'all' ? decisions : decisions.filter((decision) => decision.notified === (filter === 'notified'))
  return (
    <Surface kind="popover" as="section" role="dialog" aria-labelledby={titleId} aria-modal aria-busy={loaded === undefined || undefined} padding="none" sx={[styles.sheet, styles.sheetHeight]} data-sheet="notifications">
      <DetailsHead titleId={titleId} filter={filter} onFilter={setFilter} total={total} notified={notified} onClose={onClose} />
      <div ref={list} {...stylex.props(styles.scroll, ringRoom.inline)}>
        {loaded === undefined ? null : shown.length === 0 ? (
          <Text variant="ui" tone="muted" as="p" sx={styles.empty}>
            {filter === 'notified' ? 'Nothing has notified you today.' : filter === 'stayed' ? 'Nothing stayed in Juno today.' : 'Juno has not decided on any message today.'}
          </Text>
        ) : (
          // A row's why opens under it and moves the rows below, on purpose.
          <ul aria-label="Today's decisions" data-expands-in-place="" {...stylex.props(styles.list)}>
            {shown.map((decision) => (
              <DecisionRow
                key={decision.id}
                decision={decision}
                open={open === decision.id}
                onToggle={toggle}
                proposal={proposals.get(decision.id)}
                alwaysFor={alwaysFor.get(decision.id)}
                actions={actions}
              />
            ))}
          </ul>
        )}
        {capped && loaded !== undefined ? (
          <Text variant="meta" tone="muted" as="p" sx={styles.capped}>
            Showing the latest {loaded.length}.
          </Text>
        ) : null}
      </div>
    </Surface>
  )
}

const styles = stylex.create({
  sheet: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    maxWidth: layout['--page-width'],
    maxHeight: '100%',
    minHeight: 0,
    boxSizing: 'border-box',
  },
  // As tall as the window allows from the start, so rows arriving or a filter change move nothing.
  sheetHeight: {
    height: '100%',
  },
  head: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: spacing['--space-3'],
    paddingTop: spacing['--space-5'],
    paddingInline: spacing['--space-5'],
    paddingBottom: spacing['--space-3'],
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: colors['--border-subtle'],
  },
  titleLine: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing['--space-3'],
    alignSelf: 'stretch',
  },
  titles: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-1'],
    minWidth: 0,
  },
  scroll: {
    flexGrow: 1,
    minHeight: 0,
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    paddingInline: spacing['--space-3'],
    paddingBottom: spacing['--space-3'],
  },
  capped: {
    paddingBlock: spacing['--space-3'],
    textAlign: 'center',
  },
  empty: {
    paddingBlock: spacing['--space-6'],
    textAlign: 'center',
  },
  list: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
  },
})
