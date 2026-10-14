import * as stylex from '@stylexjs/stylex'
import { chatCopy, type Deliver, type ProposedScheduleCard as ProposedScheduleCardModel, type ScheduleCard as ScheduleCardModel } from '@juno/agent-contract'
import { colors, radii, spacing } from '@juno/tokens/tokens.stylex'
import { Button, Text } from '@juno/ui'
import type { ChatActions } from '../commands'
import { ChatCard } from './ChatCard'

const copy = chatCopy.card.schedule

function ScheduleBody({ what, when, deliver }: { readonly what: string; readonly when: string; readonly deliver: Deliver }) {
  return (
    <div {...stylex.props(styles.body)}>
      <Text variant="bodySmall" weight="medium" tone="default" dir="auto">
        {what}
      </Text>
      <Text variant="preview" tone="subtle">
        {when}
      </Text>
      <Text variant="meta" tone="muted">
        {copy.delivers[deliver]}
      </Text>
    </div>
  )
}

export interface ScheduleCardProps {
  readonly card: ScheduleCardModel
  readonly actions: ChatActions
  readonly enter?: boolean
}

/** A schedule Juno created from a clean run: what, when, how it delivers. Keep, Pause or Delete; afterwards "Kept", "Paused" or "Deleted". */
export function ScheduleCard({ card, actions, enter }: ScheduleCardProps) {
  return (
    <ChatCard
      id={card.id}
      kind="schedule"
      actions={actions}
      enter={enter}
      status={card.status}
      because={card.because}
      buttons={
        <>
          <Button variant="secondary" size="md" onClick={() => actions.onCard(card.id, { _tag: 'keep' })}>
            {copy.keep}
          </Button>
          <Button variant="ghost" size="md" tone="subtle" onClick={() => actions.onCard(card.id, { _tag: 'pause' })}>
            {copy.pause}
          </Button>
          <Button variant="ghost" size="md" tone="subtle" onClick={() => actions.onCard(card.id, { _tag: 'delete' })}>
            {copy.delete}
          </Button>
        </>
      }
    >
      <ScheduleBody what={card.what} when={card.when} deliver={card.deliver} />
    </ChatCard>
  )
}

export interface ProposedScheduleCardProps {
  readonly card: ProposedScheduleCardModel
  readonly actions: ChatActions
  readonly enter?: boolean
}

/** A schedule from a tainted run: the same body, then the prompt each wake runs, in full. Start creates it. */
export function ProposedScheduleCard({ card, actions, enter }: ProposedScheduleCardProps) {
  return (
    <ChatCard
      id={card.id}
      kind="proposedSchedule"
      actions={actions}
      enter={enter}
      status={card.status}
      because={card.because}
      dismiss
      buttons={
        <Button variant="secondary" size="md" onClick={() => actions.onCard(card.id, { _tag: 'start' })}>
          {copy.start}
        </Button>
      }
    >
      <ScheduleBody what={card.what} when={card.when} deliver={card.deliver} />
      <div data-schedule-prompt="" {...stylex.props(styles.prompt)}>
        <Text variant="preview" tone="subtle" selectable dir="auto" as="p" sx={styles.promptText}>
          {card.prompt}
        </Text>
      </div>
    </ChatCard>
  )
}

const styles = stylex.create({
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-0-5'],
    minWidth: 0,
  },
  // Never truncated: the click approves these words.
  prompt: {
    paddingBlock: spacing['--space-2'],
    paddingInline: spacing['--space-2-5'],
    borderRadius: radii['--radius-lg'],
    backgroundColor: colors['--surface-hover'],
  },
  promptText: {
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
  },
})
