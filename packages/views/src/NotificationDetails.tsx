import * as stylex from '@stylexjs/stylex'
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { colors, layout, radii, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Avatar, Button, Chip, Segmented, Surface, Text, focusRing, ringRoom } from '@juno/ui'
import { hueFor, initials } from './look'
import { decidedByLabels, instructionLine, type DecidedBy, type Decision, type InstructionDirection } from './notificationRules'
import { SettingsLink } from './SettingsLink'
import { clockLabel } from './time'

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
  /** Today's counts from the page, for the filter while the decisions load, so its width does not change when they arrive. */
  readonly notifiedToday: number
  readonly stayedToday: number
  readonly onClose: () => void
  readonly initialFilter?: DetailsFilter
  /** The row whose why starts open (fixtures). */
  readonly initialOpen?: string
}

/** The decisions a setting made, which Change opens. */
const fromSetting: ReadonlySet<DecidedBy> = new Set(['hours', 'always', 'never', 'ignored', 'directMention', 'alwaysNotify'])
/** The decisions Juno's reading made, which can be corrected. */
const fromReading: ReadonlySet<DecidedBy> = new Set(['reading'])

/**
 * Today's notifications (SPEC 14, "Today"; inventory 13): every decision
 * of the day, newest first, filterable by outcome. Choosing a row opens
 * its why under it: the reason, the action that fits what decided it,
 * and the way to Settings › Notifications. A panel for `SheetLayer`.
 */
export function NotificationDetails(props: NotificationDetailsProps) {
  const { decisions: loaded, notifiedToday, stayedToday, proposals, alwaysFor, onClose, initialFilter = 'all', initialOpen } = props
  const titleId = useId()
  const list = useRef<HTMLDivElement>(null)
  // A why that starts open is shown in view.
  useEffect(() => {
    if (initialOpen !== undefined) list.current?.querySelector(`[data-decision="${initialOpen}"]`)?.scrollIntoView({ block: 'center', behavior: 'instant' })
  }, [initialOpen])
  const [filter, setFilter] = useState<DetailsFilter>(initialFilter)
  const [open, setOpen] = useState<string | undefined>(initialOpen)
  const toggle = useCallback((id: string) => setOpen((shown) => (shown === id ? undefined : id)), [])
  // One object for every row, which calls the latest props: a toggle or a filter re-renders only the rows it changes.
  const latest = useRef<WhyActions>(props)
  useEffect(() => {
    latest.current = props
  })
  const actions = useMemo<WhyActions>(
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
  const decisions = loaded ?? []
  const notified = loaded === undefined ? notifiedToday : decisions.filter((decision) => decision.notified).length
  const total = loaded === undefined ? notifiedToday + stayedToday : decisions.length
  const shown = filter === 'all' ? decisions : decisions.filter((decision) => decision.notified === (filter === 'notified'))
  return (
    <Surface kind="popover" as="section" role="dialog" aria-labelledby={titleId} aria-modal aria-busy={loaded === undefined || undefined} padding="none" sx={[styles.sheet, styles.sheetHeight]} data-sheet="notifications">
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
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All', count: total },
              { value: 'notified', label: 'Notified', count: notified },
              { value: 'stayed', label: 'Stayed in Juno', count: total - notified },
            ]}
          />
        </span>
      </div>
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
      </div>
    </Surface>
  )
}

/** The reason without the words its label already says: "Your instructions: Don't notify: …" under "Your instructions". */
function reasonAfter(label: string, reason: string): string {
  return reason.startsWith(`${label}: `) ? reason.slice(label.length + 2) : reason
}

interface DecisionRowProps {
  readonly decision: Decision
  readonly open: boolean
  readonly onToggle: (id: string) => void
  readonly proposal: ProposedInstruction | undefined
  readonly alwaysFor: string | undefined
  readonly actions: WhyActions
}

/** One decision: who, where and what, then what decided and why on one line. Open, the line shows whole and the actions follow. */
const DecisionRow = memo(function DecisionRow({ decision, open, onToggle, proposal, alwaysFor, actions }: DecisionRowProps) {
  const whyId = useId()
  const label = decidedByLabels[decision.decidedBy]
  return (
    <li data-decision={decision.id} {...stylex.props(styles.item)}>
      <button type="button" aria-expanded={open} aria-controls={open ? whyId : undefined} onClick={() => onToggle(decision.id)} {...stylex.props(styles.row, focusRing.inset, open && styles.rowOpen)}>
        <Text variant="meta" tone="muted" numeric sx={styles.time}>
          {clockLabel(decision.at)}
        </Text>
        <Avatar size={20} label={initials(decision.sender)} name={decision.sender} hue={hueFor('', decision.senderId)} {...(decision.avatarUrl === undefined ? {} : { src: decision.avatarUrl })} />
        <span {...stylex.props(styles.text)}>
          <Text variant="ui" truncate tooltipWhenTruncated>
            <Text variant="ui" weight="semibold" as="span">
              {decision.sender}
            </Text>
            {decision.place === '' ? null : <Text variant="ui" tone="muted" as="span">{` · ${decision.place}`}</Text>}
          </Text>
          <Text variant="ui" tone="subtle" truncate tooltipWhenTruncated>
            {decision.text}
          </Text>
          <span {...stylex.props(styles.reasonLine)}>
            <Chip variant="quiet" size={18}>
              {label}
            </Chip>
            {/* Open, the reason shows whole in case the line cut it. */}
            <Text variant="meta" tone="muted" truncate={!open} tooltipWhenTruncated={!open}>
              {reasonAfter(label, decision.reason)}
            </Text>
          </span>
        </span>
        <Chip variant={decision.notified ? 'filled' : 'outline'} size={20}>
          {decision.notified ? 'Notified' : 'In Juno'}
        </Chip>
      </button>
      {open ? <Why id={whyId} decision={decision} proposal={proposal} alwaysFor={alwaysFor} actions={actions} /> : null}
    </li>
  )
})

/** Under an open row: the action that fits what decided it, and Notification settings; or the proposed instruction with Add it and Just this time. */
function Why({ id, decision, proposal, alwaysFor, actions }: { readonly id: string; readonly decision: Decision; readonly proposal: ProposedInstruction | undefined; readonly alwaysFor: string | undefined; readonly actions: WhyActions }) {
  if (proposal !== undefined) {
    return (
      <div id={id} data-why="" {...stylex.props(styles.why)}>
        <Text variant="ui" tone="subtle" as="p">
          Juno suggests adding an instruction:
        </Text>
        <Text variant="ui" weight="semibold" as="p">
          {instructionLine(proposal.direction, proposal.text)}
        </Text>
        <span {...stylex.props(styles.actions)}>
          <Button variant="primary" size="sm" onClick={() => actions.onAddInstruction(decision, proposal)}>
            Add it
          </Button>
          <Button variant="secondary" size="sm" onClick={() => actions.onDismissSuggestion(decision)}>
            Just this time
          </Button>
        </span>
      </div>
    )
  }
  return (
    <div id={id} data-why="" aria-label={decision.notified ? 'Why did this notify?' : 'Why no notification?'} role="group" {...stylex.props(styles.why)}>
      <span {...stylex.props(styles.actions)}>
        {fromSetting.has(decision.decidedBy) ? (
          <Button variant="secondary" size="sm" onClick={() => actions.onChange(decision)}>
            Change
          </Button>
        ) : null}
        {decision.decidedBy === 'instruction' ? (
          <Button variant="secondary" size="sm" onClick={actions.onEditInstructions}>
            Edit instructions
          </Button>
        ) : null}
        {fromReading.has(decision.decidedBy) ? (
          <Button variant="secondary" size="sm" onClick={() => actions.onSuggest(decision)}>
            {decision.notified ? "Shouldn't have notified" : 'Should have notified'}
          </Button>
        ) : null}
        {alwaysFor === undefined ? null : (
          <Button variant="secondary" size="sm" onClick={() => actions.onAlways(decision)}>
            Always for {alwaysFor}
          </Button>
        )}
        <span {...stylex.props(styles.settings)}>
          <Text variant="meta">
            <SettingsLink onClick={actions.onSettings}>Notification settings</SettingsLink>
          </Text>
        </span>
      </span>
    </div>
  )
}

/** The time column: "13:42" in tabular numbers. */
const TIME_WIDTH = 44 // tokens-allow: the time column (inventory 13)
/** A row before it is laid out: three lines and its padding. */
const ROW_ESTIMATE = '78px' // tokens-allow: content-visibility size estimate

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
  empty: {
    paddingBlock: spacing['--space-6'],
    textAlign: 'center',
  },
  list: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
  },
  item: {
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: colors['--border-subtle'],
    contentVisibility: 'auto',
    containIntrinsicSize: `auto ${ROW_ESTIMATE}`,
  },
  row: {
    appearance: 'none',
    display: 'flex',
    alignItems: 'flex-start',
    gap: spacing['--space-2-5'],
    width: '100%',
    margin: 0,
    paddingBlock: spacing['--space-2'],
    paddingInline: spacing['--space-2'],
    borderWidth: 0,
    borderRadius: radii['--radius-md'],
    backgroundColor: {
      default: 'transparent',
      ':hover': { default: null, '@media (hover: hover)': colors['--surface-hover'] },
    },
    color: 'inherit',
    font: 'inherit',
    textAlign: 'start',
    cursor: 'default',
  },
  rowOpen: {
    backgroundColor: colors['--surface-hover'],
  },
  time: {
    flexShrink: 0,
    width: TIME_WIDTH,
    lineHeight: sizes['--control-20'],
  },
  text: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-0-5'],
    flexGrow: 1,
    minWidth: 0,
  },
  reasonLine: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-1-5'],
    minWidth: 0,
  },
  // Inset to the row's text: past the time, the avatar and their gaps.
  why: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-1'],
    paddingTop: spacing['--space-1'],
    paddingBottom: spacing['--space-3'],
    paddingInlineStart: `calc(${spacing['--space-2']} + ${TIME_WIDTH}px + ${sizes['--control-20']} + 2 * ${spacing['--space-2-5']})`,
    paddingInlineEnd: spacing['--space-2'],
  },
  actions: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing['--space-1-5'],
    marginTop: spacing['--space-1-5'],
  },
  settings: {
    marginInlineStart: 'auto',
  },
})
