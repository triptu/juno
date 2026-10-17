import * as stylex from '@stylexjs/stylex'
import { useState, type ReactNode } from 'react'
import { layout, motion, spacing } from '@juno/tokens/tokens.stylex'

interface HomeWriteTopProps {
  readonly recent: ReactNode
  readonly chip: ReactNode
  /** The topic chip, right of the destination chip. Pass it always, so it can leave with its fade. */
  readonly topic?: ReactNode
  /** A person or channel is chosen: the topic chip shows. */
  readonly topicShown?: boolean
}

/**
 * Recent, then the destination chip and the topic chip, as one stack above
 * the field. The topic chip comes and goes on the chips' row, right of the
 * destination chip, so neither the destination chip nor the field moves; it
 * comes in fast and leaves slower (--duration-menu-in, --duration-exit), a
 * fade alone with reduced motion. On a narrow window the topic chip
 * shortens first, to --topic-chip-min-width, then the destination chip.
 */
export function HomeWriteTop({ recent, chip, topic, topicShown = false }: HomeWriteTopProps) {
  // Kept while it leaves; one shown at first paint does not come in.
  const [kept, setKept] = useState(topicShown)
  const [atFirstPaint, setAtFirstPaint] = useState(topicShown)
  if (topicShown && !kept) setKept(true)
  const leaving = !topicShown && kept
  return (
    <div data-home-write="" {...stylex.props(styles.top)}>
      {recent}
      <div {...stylex.props(styles.chipRow)}>
        <span {...stylex.props(styles.chipSlot)}>{chip}</span>
        {kept && topic !== undefined ? (
          <span
            data-topic-chip=""
            inert={leaving}
            aria-hidden={leaving || undefined}
            onAnimationEnd={
              leaving
                ? (event) => {
                    // Only its own fade: the chip's name and list animate inside it.
                    if (event.target !== event.currentTarget) return
                    setKept(false)
                    setAtFirstPaint(false)
                  }
                : undefined
            }
            {...stylex.props(styles.topicSlot, leaving ? styles.topicOut : !atFirstPaint && styles.topicIn)}
          >
            {topic}
          </span>
        ) : null}
      </div>
    </div>
  )
}

// The topic chip grows out of its left edge, by the destination chip; the scale token is 1 with reduced motion.
const topicIn = stylex.keyframes({
  from: { opacity: 0, transform: `scale(${motion['--appear-scale']})` },
  to: { opacity: 1, transform: 'none' },
})

const topicOut = stylex.keyframes({
  from: { opacity: 1, transform: 'none' },
  to: { opacity: 0, transform: `scale(${motion['--appear-scale']})` },
})

const styles = stylex.create({
  top: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-3'],
    width: '100%',
    minWidth: 0,
  },
  chipRow: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-1-5'],
    minWidth: 0,
  },
  // The destination chip gives way only once the topic chip is at its narrowest.
  chipSlot: {
    display: 'inline-flex',
    flexShrink: 1,
    minWidth: 0,
  },
  topicSlot: {
    display: 'inline-flex',
    flexShrink: 10000,
    minWidth: layout['--topic-chip-min-width'],
    transformOrigin: 'left center',
  },
  topicIn: {
    animationName: topicIn,
    animationDuration: motion['--duration-menu-in'],
    animationTimingFunction: motion['--ease-out'],
    animationFillMode: 'both',
  },
  topicOut: {
    animationName: topicOut,
    animationDuration: motion['--duration-exit'],
    animationTimingFunction: motion['--ease-out'],
    animationFillMode: 'both',
  },
})
