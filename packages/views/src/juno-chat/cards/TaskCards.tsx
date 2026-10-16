import * as stylex from '@stylexjs/stylex'
import { chatCopy, type JobPhase, type ProposedTaskCard as ProposedTaskCardModel, type TaskCard as TaskCardModel } from '@juno/agent-contract'
import { motion, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Button, Text } from '@juno/ui'
import type { ChatActions } from '../commands'
import { TextButton } from '../TextButton'
import { ChatCard, DangerGhost, OpenButton } from './ChatCard'

export interface TaskCardProps {
  readonly card: TaskCardModel
  readonly actions: ChatActions
  readonly enter?: boolean
}

const copy = chatCopy.card.task

/** The phases whose footer still has buttons. The rest print an after-line. */
const active: ReadonlySet<JobPhase> = new Set(['running', 'needsYou', 'lostSight', 'stopping'])

/** The state line's text by phase: the agent's live line while it runs, fixed copy otherwise. */
function stateLine(card: TaskCardModel): string {
  if (card.stopFailed && active.has(card.phase)) return copy.stopFailed
  switch (card.phase) {
    case 'running':
    case 'needsYou':
      return card.state ?? ''
    case 'stopping':
      return card.state ?? copy.stopping
    case 'lostSight':
      return copy.lostSight
    case 'done':
      return copy.done
    case 'failed':
      return copy.failed
    case 'stopped':
      return copy.stopped
  }
}

/**
 * A running or settled job (SPEC 13.4): its title, where it runs, and a
 * live state line that swaps text with a fade and never reflows (one line,
 * ellipsis). It has no status; `phase` is its only machine. Stop ends the
 * running job: it is the Task card's own control, not a chat Stop, and it
 * stays until the job has settled.
 */
export function TaskCard({ card, actions, enter }: TaskCardProps) {
  const line = stateLine(card)
  const open = card.open
  return (
    <ChatCard
      id={card.id}
      kind="task"
      actions={actions}
      enter={enter}
      because={card.because}
      buttons={
        active.has(card.phase) ? (
          <>
            {card.phase !== 'lostSight' && open !== undefined ? (
              <Button variant="ghost" size="md" tone="subtle" onClick={(event) => actions.onOpen(open, { metaKey: event.metaKey, shiftKey: event.shiftKey, altKey: event.altKey, source: 'pointer' })}>
                {copy.open}
              </Button>
            ) : null}
            <DangerGhost onClick={() => actions.onCard(card.id, { _tag: 'stop' })} disabled={card.phase === 'stopping'}>
              {copy.stop}
            </DangerGhost>
            {/* The default button last, at the trailing edge, as on the Mac. */}
            {card.phase === 'lostSight' ? (
              <Button variant="secondary" size="md" onClick={() => actions.onCard(card.id, { _tag: 'signIn' })}>
                {copy.signIn}
              </Button>
            ) : null}
          </>
        ) : (
          <Text variant="meta" tone="muted" as="p" sx={styles.after}>
            <Settled card={card} actions={actions} />
          </Text>
        )
      }
    >
      <div data-task-phase={card.phase} {...stylex.props(styles.body)}>
        <Text variant="bodySmall" weight="medium" tone="default" truncate dir="auto">
          {card.title}
        </Text>
        <Text variant="meta" tone="muted" truncate>
          {chatCopy.card.jobKind[card.kind]} · {card.where}
        </Text>
        <div {...stylex.props(styles.stateSlot)}>
          {/* A new key per text restarts the fade; the slot is one line, so a swap never moves the footer. */}
          <span key={line} data-task-state="" {...stylex.props(styles.state)}>
            <Text variant="preview" tone="subtle" truncate dir="auto">
              {line}
            </Text>
          </span>
        </div>
      </div>
    </ChatCard>
  )
}

/** "Done · Open PR 412", "Failed · Show in Activity" or "Stopped". */
function Settled({ card, actions }: TaskCardProps) {
  const open = card.open
  switch (card.phase) {
    case 'done':
      return (
        <>
          {copy.done}
          {open !== undefined ? (
            <>
              {' · '}
              <OpenButton target={open} actions={actions} />
            </>
          ) : null}
        </>
      )
    case 'failed':
      return (
        <>
          {copy.failed} · <TextButton onClick={(event) => actions.onOpen({ _tag: 'page', page: 'activity' }, { metaKey: event.metaKey, shiftKey: event.shiftKey, altKey: event.altKey, source: 'pointer' })}>{copy.showInActivity}</TextButton>
        </>
      )
    case 'stopped':
      return copy.stopped
    default:
      return null
  }
}

export interface ProposedTaskCardProps {
  readonly card: ProposedTaskCardModel
  readonly actions: ChatActions
  readonly enter?: boolean
}

/** A task Juno may not start on its own: the same title and where, then Start or Dismiss. Afterwards "Started". */
export function ProposedTaskCard({ card, actions, enter }: ProposedTaskCardProps) {
  return (
    <ChatCard
      id={card.id}
      kind="proposedTask"
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
      <div {...stylex.props(styles.body)}>
        <Text variant="bodySmall" weight="medium" tone="default" truncate dir="auto">
          {card.title}
        </Text>
        <Text variant="meta" tone="muted" truncate>
          {chatCopy.card.jobKind[card.kind]} · {card.where}
        </Text>
      </div>
    </ChatCard>
  )
}

const fade = stylex.keyframes({
  from: { opacity: 0 },
  to: { opacity: 1 },
})

const styles = stylex.create({
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-0-5'],
    minWidth: 0,
  },
  stateSlot: {
    display: 'flex',
    alignItems: 'center',
    minHeight: sizes['--control-20'],
    minWidth: 0,
    marginTop: spacing['--space-0-5'],
  },
  state: {
    display: 'flex',
    minWidth: 0,
    animationName: fade,
    animationDuration: motion['--duration-fast'],
    animationTimingFunction: motion['--ease-out'],
    animationFillMode: 'both',
  },
  after: {
    width: '100%',
    textWrap: 'pretty',
    userSelect: 'none',
  },
})
