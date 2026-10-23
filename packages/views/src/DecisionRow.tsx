import * as stylex from '@stylexjs/stylex'
import { memo, useId } from 'react'
import { colors, radii, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Avatar, Button, Chip, Text, focusRing } from '@juno/ui'
import { hueFor, initials } from './look'
import type { ProposedInstruction, WhyActions } from './NotificationDetails'
import { decidedByLabels, instructionLine, type DecidedBy, type Decision } from './notificationRules'
import { SettingsLink } from './SettingsLink'
import { clockLabel } from './time'

/** The decisions a setting made, which Change opens. */
const fromSetting: ReadonlySet<DecidedBy> = new Set(['hours', 'always', 'never', 'ignored', 'directMention', 'alwaysNotify'])
/** The decisions Juno's reading made, which can be corrected. */
const fromReading: ReadonlySet<DecidedBy> = new Set(['reading'])

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
export const DecisionRow = memo(function DecisionRow({ decision, open, onToggle, proposal, alwaysFor, actions }: DecisionRowProps) {
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
