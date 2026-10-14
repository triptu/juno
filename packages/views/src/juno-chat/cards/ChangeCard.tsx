import * as stylex from '@stylexjs/stylex'
import { useState } from 'react'
import { chatCopy, type ChangeCard as ChangeCardModel, type ChangeField } from '@juno/agent-contract'
import { colors, radii, spacing } from '@juno/tokens/tokens.stylex'
import { Button, Text } from '@juno/ui'
import type { ChatActions } from '../commands'
import { TextButton } from '../TextButton'
import { ChatCard } from './ChatCard'

export interface ChangeCardProps {
  readonly card: ChangeCardModel
  readonly actions: ChatActions
}

/** A write to a connection: the server and target, each field with its before and after, rendered from the payload. Apply or Dismiss. */
export function ChangeCard({ card, actions }: ChangeCardProps) {
  const copy = chatCopy.card.change
  return (
    <ChatCard
      id={card.id}
      kind="change"
      actions={actions}
      source={
        <Text variant="meta" tone="muted" truncate>
          {card.server} · {card.target}
        </Text>
      }
      status={card.status}
      because={card.because}
      dismiss
      buttons={
        <Button variant="primary" size="md" onClick={() => actions.onCard(card.id, { _tag: 'apply' })}>
          {copy.apply}
        </Button>
      }
    >
      <div {...stylex.props(styles.fields)}>
        {card.fields.map((field) => (
          <Field key={field.name} field={field} />
        ))}
      </div>
      {card.caption !== undefined ? (
        <Text variant="meta" tone="muted" as="p" dir="auto">
          {card.caption}
        </Text>
      ) : null}
    </ChatCard>
  )
}

/**
 * One field. A `long` value shows six lines; "Show all" lets the same box
 * scroll instead of growing it, so the card keeps its height. It toggles.
 */
function Field({ field }: { readonly field: ChangeField }) {
  const [all, setAll] = useState(false)
  const long = field.long === true
  return (
    <div data-change-field={field.name} {...stylex.props(styles.field)}>
      <div {...stylex.props(styles.fieldHead)}>
        <Text variant="meta" tone="muted" truncate>
          {field.name}
        </Text>
        {long ? (
          <Text variant="meta" tone="muted" sx={styles.showAll}>
            <TextButton aria-pressed={all} onClick={() => setAll((value) => !value)}>
              {chatCopy.card.change.showAll}
            </TextButton>
          </Text>
        ) : null}
      </div>
      <div {...stylex.props(styles.values, long && styles.clamped, long && all && styles.scrolls)}>
        {field.before !== undefined ? (
          <Text variant="bodySmall" tone="subtle" selectable dir="auto" as="p" sx={styles.before}>
            {field.before}
          </Text>
        ) : null}
        <Text variant="bodySmall" tone="default" selectable dir="auto" as="p" sx={styles.after}>
          {field.after}
        </Text>
      </div>
    </div>
  )
}

const styles = stylex.create({
  fields: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-2'],
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-1'],
    minWidth: 0,
  },
  fieldHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing['--space-2'],
    minWidth: 0,
    userSelect: 'none',
  },
  showAll: {
    flexShrink: 0,
  },
  values: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-1'],
    paddingBlock: spacing['--space-2-5'],
    paddingInline: spacing['--space-3'],
    borderRadius: radii['--radius-lg'],
    backgroundColor: colors['--background'],
    minWidth: 0,
  },
  // Six lines of the 14px body at 1.55, plus the padding.
  clamped: {
    maxHeight: `calc(6 * 1.55 * 14px + 2 * ${spacing['--space-2-5']})`,
    boxSizing: 'border-box',
    overflow: 'hidden',
  },
  scrolls: {
    overflowY: 'auto',
  },
  before: {
    textDecorationLine: 'line-through',
    textDecorationColor: colors['--foreground-muted'],
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
  },
  after: {
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
  },
})
