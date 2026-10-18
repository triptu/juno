import * as stylex from '@stylexjs/stylex'
import { useState } from 'react'
import { chatCopy, type QuestionCard as QuestionCardModel } from '@juno/agent-contract'
import { accent, colors, motion, radii, sizes, spacing, text } from '@juno/tokens/tokens.stylex'
import { Button, Chip, Text, TextField } from '@juno/ui'
import type { ChatActions } from '../commands'
import { ChatCard } from './ChatCard'

export interface QuestionCardProps {
  readonly card: QuestionCardModel
  readonly actions: ChatActions
  readonly enter?: boolean
}

const HOVER = '@media (hover: hover)'

/**
 * A question from Juno or from a T3 Code session, headed by who asks. Two
 * to four options as full-width buttons; the first takes Enter from the
 * reply field. A typed reply when `freeText`. Afterwards "You chose …" or
 * "You replied" from the status line.
 */
export function QuestionCard({ card, actions, enter }: QuestionCardProps) {
  const [reply, setReply] = useState('')
  const copy = chatCopy.card.question
  const open = card.status._tag === 'open'
  const first = card.options[0]
  const submit = () => {
    // Enter in the reply field is not a click: a card that is not open takes neither.
    if (!open) return
    const trimmed = reply.trim()
    if (trimmed.length > 0) actions.onCard(card.id, { _tag: 'reply', text: trimmed })
    else if (first !== undefined) actions.onCard(card.id, { _tag: 'choose', optionId: first.id })
  }
  return (
    <ChatCard
      id={card.id}
      kind="question"
      actions={actions}
      enter={enter}
      label={card.asks._tag === 't3' ? copy.t3Asks : copy.junoAsks}
      source={card.asks._tag === 't3' ? <Chip variant="filled" size={20} title={card.asks.job.title}>{card.asks.job.title}</Chip> : undefined}
      status={card.status}
      because={card.because}
      buttons={
        card.freeText ? (
          <div {...stylex.props(styles.replyRow)}>
            <TextField size={30} label={copy.reply} value={reply} onChange={(event) => setReply(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submit() } }} readOnly={!open} aria-disabled={!open || undefined} dir="auto" />
            <Button variant="secondary" size="md" onClick={submit} dimmed={reply.trim().length === 0}>
              {copy.reply}
            </Button>
          </div>
        ) : undefined
      }
    >
      <Text variant="bodySmall" tone="default" selectable dir="auto" as="p">
        {card.prompt}
      </Text>
      <div role="group" aria-label={copy.junoAsks} {...stylex.props(styles.options)}>
        {card.options.map((option) => (
          <button key={option.id} type="button" aria-disabled={!open || undefined} dir="auto" onClick={() => open && actions.onCard(card.id, { _tag: 'choose', optionId: option.id })} {...stylex.props(styles.option, !open && styles.optionSettled)}>
            {option.label}
          </button>
        ))}
      </div>
    </ChatCard>
  )
}

const styles = stylex.create({
  options: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-1-5'],
  },
  option: {
    appearance: 'none',
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    minHeight: sizes['--control-36'],
    margin: 0,
    paddingBlock: spacing['--space-1-5'],
    paddingInline: spacing['--space-3'],
    boxSizing: 'border-box',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: {
      default: colors['--border-default'],
      ':hover': { default: null, [HOVER]: colors['--border-strong'] },
      ':disabled': colors['--border-default'],
    },
    borderRadius: radii['--radius-xl'],
    backgroundColor: {
      default: 'transparent',
      ':hover': { default: null, [HOVER]: colors['--surface-hover'] },
      ':disabled': 'transparent',
    },
    color: colors['--foreground-default'],
    fontFamily: text['--text-preview-family'],
    fontSize: text['--text-preview-size'],
    fontWeight: text['--text-preview-weight'],
    lineHeight: text['--text-preview-leading'],
    letterSpacing: text['--text-preview-tracking'],
    textAlign: 'start',
    userSelect: 'none',
    cursor: 'default',
    transitionProperty: 'scale, background-color, border-color',
    transitionDuration: motion['--duration-fast'],
    transitionTimingFunction: motion['--ease-out'],
    scale: {
      default: '1',
      ':active': motion['--press-scale'],
      ':disabled': '1',
    },
    pointerEvents: {
      default: 'auto',
      ':disabled': 'none',
    },
    outlineStyle: {
      default: 'none',
      ':focus-visible': 'solid',
    },
    outlineWidth: sizes['--focus-ring-width'],
    outlineOffset: sizes['--focus-ring-offset'],
    scrollMargin: sizes['--focus-ring-room'],
    outlineColor: accent['--focus-ring'],
  },
  // Settled: the options stay for the record, with no hover, press or pointer.
  optionSettled: {
    pointerEvents: 'none',
  },
  replyRow: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-1-5'],
    flexGrow: 1,
    minWidth: 0,
  },
})
