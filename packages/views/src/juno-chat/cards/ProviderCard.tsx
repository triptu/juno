import * as stylex from '@stylexjs/stylex'
import { useState } from 'react'
import { chatCopy, type ProviderCard as ProviderCardModel } from '@juno/agent-contract'
import { accent, colors, motion, radii, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Button, Text } from '@juno/ui'
import type { ChatActions } from '../commands'
import { ChatCard } from './ChatCard'

export interface ProviderCardProps {
  readonly card: ProviderCardModel
  readonly actions: ChatActions
}

const HOVER = '@media (hover: hover)'

/** "Choose a model provider": the options as 36px rows, the fixed disclosure, and Set up. Afterwards "Using Claude Sonnet 5.5". */
export function ProviderCard({ card, actions }: ProviderCardProps) {
  const copy = chatCopy.card.provider
  const [selected, setSelected] = useState(card.options[0]?.id)
  const open = card.status._tag === 'open'
  return (
    <ChatCard
      id={card.id}
      kind="provider"
      actions={actions}
      status={card.status}
      because={card.because}
      buttons={
        <Button variant="secondary" size="md" onClick={() => selected !== undefined && actions.onCard(card.id, { _tag: 'setUp', provider: selected })} dimmed={selected === undefined}>
          {copy.setUp}
        </Button>
      }
    >
      <Text variant="bodySmall" weight="medium" tone="default">
        {copy.title}
      </Text>
      <div role="radiogroup" aria-label={copy.title} {...stylex.props(styles.options)}>
        {card.options.map((option) => (
          <button key={option.id} type="button" role="radio" aria-checked={option.id === selected} disabled={!open} onClick={() => setSelected(option.id)} {...stylex.props(styles.option, option.id === selected && styles.optionSelected)}>
            <Text variant="preview" weight="medium" tone="default" truncate>
              {option.label}
            </Text>
            <Text variant="meta" tone="muted" truncate>
              {option.note}
            </Text>
          </button>
        ))}
      </div>
      <Text variant="meta" tone="muted" as="p">
        {copy.disclosure}
      </Text>
    </ChatCard>
  )
}

const styles = stylex.create({
  options: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-1'],
  },
  option: {
    appearance: 'none',
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
    width: '100%',
    minHeight: sizes['--control-36'],
    margin: 0,
    paddingBlock: 0,
    paddingInline: spacing['--space-2-5'],
    boxSizing: 'border-box',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'transparent',
    borderRadius: radii['--radius-xl'],
    backgroundColor: {
      default: 'transparent',
      ':hover': { default: null, [HOVER]: colors['--surface-hover'] },
      ':disabled': 'transparent',
    },
    color: colors['--foreground-default'],
    fontFamily: 'inherit',
    textAlign: 'start',
    userSelect: 'none',
    cursor: 'default',
    transitionProperty: 'background-color, border-color',
    transitionDuration: motion['--duration-fast'],
    transitionTimingFunction: motion['--ease-out'],
    pointerEvents: {
      default: 'auto',
      ':disabled': 'none',
    },
    outlineStyle: {
      default: 'none',
      ':focus-visible': 'solid',
    },
    outlineWidth: sizes['--focus-ring-width'],
    outlineOffset: `calc(-1 * ${sizes['--focus-ring-width']})`,
    outlineColor: accent['--focus-ring'],
  },
  optionSelected: {
    borderColor: colors['--border-strong'],
    backgroundColor: {
      default: colors['--secondary-default'],
      ':hover': { default: null, [HOVER]: colors['--secondary-hover'] },
      ':disabled': colors['--secondary-default'],
    },
  },
})
