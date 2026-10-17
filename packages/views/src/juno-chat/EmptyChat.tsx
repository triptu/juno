import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { CheckCircle } from '@phosphor-icons/react/dist/icons/CheckCircle'
import { ClockCounterClockwise } from '@phosphor-icons/react/dist/icons/ClockCounterClockwise'
import { PencilSimpleLine } from '@phosphor-icons/react/dist/icons/PencilSimpleLine'
import { TextAlignLeft } from '@phosphor-icons/react/dist/icons/TextAlignLeft'
import { chatCopy } from '@juno/agent-contract'
import { motion, spacing, layout } from '@juno/tokens/tokens.stylex'
import { Illustration, Text, type PhosphorIcon } from '@juno/ui'
import { SuggestionChip } from './SuggestionChip'

export interface EmptyChatProps {
  /** A suggestion pill was clicked: the text is sent as the owner's message. */
  readonly onSuggest: (text: string) => void
  /**
   * Play the staggered entrance. Pass false when the state was visible less than a second ago.
   * Read when the empty chat mounts: once it has drawn whole, a later true does not start the entrance over it.
   */
  readonly enter?: boolean
}

/** Each suggestion's icon, in the order of `chatCopy.empty.suggestions`. */
const suggestionIcons: ReadonlyArray<PhosphorIcon> = [ClockCounterClockwise, TextAlignLeft, PencilSimpleLine, CheckCircle]

/**
 * The empty chat (SPEC 13.1): the seated j, "What do you need?", one line
 * on what Juno can do, and four suggestion chips. The parts enter staggered
 * once, per friendly-layer section 5.
 */
export function EmptyChat({ onSuggest, enter: enterProp = true }: EmptyChatProps) {
  const copy = chatCopy.empty
  const [enter] = useState(enterProp)
  return (
    <div data-chat-empty="" {...stylex.props(styles.root)}>
      <span {...stylex.props(styles.part, enter && styles.enter, enter && styles.delay0)}>
        <Illustration name="juno" size="figure" />
      </span>
      <span {...stylex.props(styles.part, enter && styles.enter, enter && styles.delay1)}>
        <Text variant="display" tone="default" as="h1">
          {copy.title}
        </Text>
      </span>
      <span {...stylex.props(styles.part, enter && styles.enter, enter && styles.delay2)}>
        <Text variant="bodySmall" tone="subtle" as="p" sx={styles.body}>
          {copy.body}
        </Text>
      </span>
      <div role="group" aria-label="Suggestions" {...stylex.props(styles.pills, enter && styles.enter, enter && styles.delay3)}>
        {copy.suggestions.map((suggestion, index) => (
          <SuggestionChip key={suggestion} icon={suggestionIcons[index] ?? ClockCounterClockwise} label={suggestion} onSend={() => onSuggest(suggestion)} />
        ))}
      </div>
    </div>
  )
}

const rise = stylex.keyframes({
  from: { opacity: 0, transform: `translateY(${motion['--rise-stagger']})` },
  to: { opacity: 1, transform: 'translateY(0)' },
})

const styles = stylex.create({
  root: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: `calc(${spacing['--space-4']} + ${spacing['--space-0-5']})`,
    paddingTop: spacing['--space-10'],
    userSelect: 'none',
  },
  part: {
    display: 'block',
  },
  body: {
    maxWidth: layout['--chat-empty-width'],
    textWrap: 'pretty',
  },
  pills: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: spacing['--space-2'],
  },
  enter: {
    animationName: rise,
    animationDuration: motion['--duration-appear'],
    animationTimingFunction: motion['--ease-out'],
    animationFillMode: 'both',
  },
  delay0: { animationDelay: '0ms' },
  delay1: { animationDelay: motion['--stagger'] },
  delay2: { animationDelay: `calc(${motion['--stagger']} * 2)` },
  delay3: { animationDelay: `calc(${motion['--stagger']} * 3)` },
})
