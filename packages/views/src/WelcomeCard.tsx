import * as stylex from '@stylexjs/stylex'
import { Check } from '@phosphor-icons/react/dist/icons/Check'
import { useId } from 'react'
import { accent, colors, radii, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Button, Icon, Surface, systemWords, Text } from '@juno/ui'
import type { PeekKeyName } from './PeekKeySetting'

/** The three things to try, in the card's order. */
export type WelcomeHintName = 'peek' | 'tab' | 'juno'

const order: ReadonlyArray<WelcomeHintName> = ['peek', 'tab', 'juno']

/** The card's words (SPEC 4, "The welcome"; SPEC 17). */
export const welcomeCopy = {
  heading: 'Three things to try',
  allSet: 'You’re all set',
  hide: 'Hide',
  done: 'Done',
  hint: (hint: WelcomeHintName, peekKey: PeekKeyName): string =>
    hint === 'peek'
      ? `Hold ${peekKey === 'space' ? 'Space' : systemWords.optionGlyph} over a topic to read it without opening it`
      : hint === 'tab'
        ? `${systemWords.commandClick} a topic to open it in a new tab`
        : 'Ask Juno below. It sends nothing without your OK.',
  progress: (count: number) => `${count} of 3 done`,
} as const

export interface WelcomeCardProps {
  /** The hints done so far. */
  readonly done: ReadonlyArray<WelcomeHintName>
  /** The peek key the owner chose in Settings › General, so the first hint names it. */
  readonly peekKey: PeekKeyName
  /** Hide, or Done once all three are ticked. Either way the card counts as seen. */
  readonly onClose: () => void
  /**
   * Keeps the card's room with nothing in it: before the sidebar has rows,
   * and after Hide until Home appears again, so the rows above never move.
   */
  readonly hidden?: boolean
}

/**
 * The welcome (SPEC 4): a small card on Home, under its rows and over the
 * field the last hint points at, with three things to try. Each ticks when
 * the owner does it, wherever that happens; with all three done the heading
 * says so and Hide becomes Done. A tick changes nothing's size, so the card
 * never moves what is around it.
 */
export function WelcomeCard({ done, peekKey, onClose, hidden = false }: WelcomeCardProps) {
  const headingId = useId()
  const allSet = order.every((hint) => done.includes(hint))
  return (
    <Surface
      kind="card"
      as="section"
      padding="lg"
      aria-labelledby={headingId}
      sx={[styles.card, hidden && styles.hidden]}
      inert={hidden}
      aria-hidden={hidden || undefined}
      data-welcome={allSet ? 'all-set' : ''}
    >
      <div {...stylex.props(styles.head)}>
        <Text variant="rowTitle" tone="default" weight="medium" as="h3" id={headingId}>
          {allSet ? welcomeCopy.allSet : welcomeCopy.heading}
        </Text>
        <Button variant="ghost" tone="subtle" size="xs" onClick={onClose} data-welcome-close="">
          {allSet ? welcomeCopy.done : welcomeCopy.hide}
        </Button>
      </div>
      <ul {...stylex.props(styles.hints)}>
        {order.map((hint) => {
          const ticked = done.includes(hint)
          return (
            <li key={hint} data-welcome-hint={hint} data-done={ticked ? '' : undefined} {...stylex.props(styles.hint)}>
              <span aria-hidden {...stylex.props(styles.tick, ticked && styles.ticked)}>
                {ticked ? <Icon icon={Check} size={12} weight="bold" /> : null}
              </span>
              <Text variant="bodySmall" tone={ticked ? 'subtle' : 'default'} as="span">
                {welcomeCopy.hint(hint, peekKey)}
                {ticked ? <span {...stylex.props(styles.announce)}> (done)</span> : null}
              </Text>
            </li>
          )
        })}
      </ul>
      {/* What VoiceOver says when a hint ticks. */}
      <p role="status" aria-live="polite" {...stylex.props(styles.announce)}>
        {done.length === 0 ? '' : welcomeCopy.progress(done.length)}
      </p>
    </Surface>
  )
}

/** Home's container (`Home`) under 560 tall: the card sits closer to the rows. */
const SHORT = '@container home (height < 560px)'

const styles = stylex.create({
  card: {
    marginTop: { default: spacing['--space-6'], [SHORT]: spacing['--space-3'] },
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-2-5'],
    width: '100%',
    boxSizing: 'border-box',
    textAlign: 'start',
    userSelect: 'none',
  },
  hidden: {
    visibility: 'hidden',
  },
  head: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing['--space-2'],
    // The button's height, so Hide and Done never change the row's.
    minHeight: sizes['--control-20'],
  },
  hints: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-2'],
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  hint: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2-5'],
    minWidth: 0,
  },
  // An empty ring, filled with the accent and a check once done. Its size never changes.
  tick: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: sizes['--control-20'],
    height: sizes['--control-20'],
    boxSizing: 'border-box',
    borderRadius: radii['--radius-full'],
    borderWidth: spacing['--space-pixel'],
    borderStyle: 'solid',
    // 3:1 on the card, so an unticked circle reads as a control.
    borderColor: colors['--border-control'],
    color: accent['--hl-fg'],
  },
  ticked: {
    borderColor: accent['--hl'],
    backgroundColor: accent['--hl'],
  },
  announce: {
    position: 'absolute',
    width: '1px', // tokens-allow: the visually hidden pattern
    height: '1px', // tokens-allow: the visually hidden pattern
    margin: 0,
    overflow: 'hidden',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap',
  },
})
