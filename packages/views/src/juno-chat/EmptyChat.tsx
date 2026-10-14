import * as stylex from '@stylexjs/stylex'
import { chatCopy } from '@juno/agent-contract'
import { accent, colors, motion, radii, sizes, spacing, text } from '@juno/tokens/tokens.stylex'
import { Illustration, Text } from '@juno/ui'

export interface EmptyChatProps {
  /** A suggestion pill was clicked: the text is sent as the owner's message. */
  readonly onSuggest: (text: string) => void
  /** Play the staggered entrance. Pass false when the state was visible less than a second ago. */
  readonly enter?: boolean
}

const HOVER = '@media (hover: hover)'

/**
 * The empty chat (SPEC 13.1): the seated j, "What do you need?", one line
 * on what Juno can do, and four suggestion pills. The parts enter staggered
 * once, per friendly-layer section 5.
 */
export function EmptyChat({ onSuggest, enter = true }: EmptyChatProps) {
  const copy = chatCopy.empty
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
        {copy.suggestions.map((suggestion) => (
          <button key={suggestion} type="button" onClick={() => onSuggest(suggestion)} {...stylex.props(styles.pill)}>
            {suggestion}
          </button>
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
    maxWidth: '520px',
    textWrap: 'pretty',
  },
  pills: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: spacing['--space-2'],
  },
  pill: {
    appearance: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    height: sizes['--control-34'],
    margin: 0,
    paddingInline: spacing['--space-3'],
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: {
      default: colors['--border-strong'],
      ':hover': { default: null, [HOVER]: colors['--border-strongest'] },
    },
    borderRadius: radii['--radius-pill'],
    backgroundColor: {
      default: colors['--surface-default'],
      ':hover': { default: null, [HOVER]: colors['--surface-hover'] },
    },
    color: colors['--foreground-default'],
    fontFamily: text['--text-button-small-family'],
    fontSize: text['--text-button-small-size'],
    fontWeight: text['--text-button-small-weight'],
    lineHeight: text['--text-button-small-leading'],
    letterSpacing: text['--text-button-small-tracking'],
    whiteSpace: 'nowrap',
    userSelect: 'none',
    cursor: 'default',
    transitionProperty: 'scale, background-color, border-color',
    transitionDuration: motion['--duration-fast'],
    transitionTimingFunction: motion['--ease-out'],
    scale: {
      default: '1',
      ':active': motion['--press-scale'],
    },
    outlineStyle: {
      default: 'none',
      ':focus-visible': 'solid',
    },
    outlineWidth: sizes['--focus-ring-width'],
    outlineOffset: sizes['--focus-ring-offset'],
    outlineColor: accent['--focus-ring'],
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
