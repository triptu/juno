import * as stylex from '@stylexjs/stylex'
import { memo } from 'react'
import type { StatusItem } from '@juno/agent-contract'
import { chat, colors, motion, radii, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Text } from '@juno/ui'
import { groupGap, rowStyles } from './rows'

export interface StatusBubbleProps {
  readonly item: StatusItem
}

/**
 * The one status bubble (SPEC 13.2): three looping dots in Juno's bubble
 * shape, like someone typing, with a tool's line beside them. It sits under
 * the newest bubble while a run is active, always the last row. It has no
 * Stop: to change course the owner sends another message.
 */
export const StatusBubble = memo(function StatusBubble({ item }: StatusBubbleProps) {
  return (
    <div data-chat-status={item.runId} role="status" aria-label={item.text ?? 'Juno is working'} {...stylex.props(groupGap.single, rowStyles.row, styles.row)}>
      <div {...stylex.props(styles.bubble)}>
        <span aria-hidden {...stylex.props(styles.dots)}>
          <i {...stylex.props(styles.dot, styles.dot1)} />
          <i {...stylex.props(styles.dot, styles.dot2)} />
          <i {...stylex.props(styles.dot, styles.dot3)} />
        </span>
        {item.text !== undefined ? (
          // A new key on every text change restarts the fade, so a swap reads as a cross-fade and never moves.
          <span key={item.text} {...stylex.props(styles.text)}>
            <Text variant="preview" tone="subtle" dir="auto">
              {item.text}
            </Text>
          </span>
        ) : null}
      </div>
    </div>
  )
})

const pulse = stylex.keyframes({
  '0%': { transform: 'scale(1)' },
  '30%': { transform: `scale(${chat['--status-pulse-scale']})` },
  '60%': { transform: 'scale(1)' },
  '100%': { transform: 'scale(1)' },
})

const fade = stylex.keyframes({
  from: { opacity: 0 },
  to: { opacity: 1 },
})

const styles = stylex.create({
  row: {
    alignItems: 'center',
  },
  bubble: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2-5'],
    boxSizing: 'border-box',
    minWidth: chat['--status-min-width'],
    maxWidth: chat['--bubble-max-width'],
    // The same height with dots alone and with text, so the first status line never grows the bubble.
    minHeight: sizes['--control-40'],
    paddingBlock: spacing['--space-2-5'],
    paddingInline: spacing['--space-3-5'],
    borderRadius: radii['--radius-bubble'],
    borderEndStartRadius: chat['--bubble-tail'],
    backgroundColor: colors['--surface-hover'],
    color: colors['--foreground-default'],
    userSelect: 'none',
  },
  dots: {
    display: 'inline-flex',
    gap: spacing['--space-1'],
    flexShrink: 0,
  },
  // The pulse lives on a pseudo-element: it only scales, so it is no layout and no declared motion on the row.
  dot: {
    display: 'block',
    width: chat['--status-dot'],
    height: chat['--status-dot'],
    '::before': {
      content: '""',
      display: 'block',
      width: chat['--status-dot'],
      height: chat['--status-dot'],
      borderRadius: '50%',
      backgroundColor: colors['--foreground-muted'],
      opacity: chat['--status-dot-opacity'],
      animationName: pulse,
      animationDuration: chat['--status-loop'],
      animationTimingFunction: motion['--ease-out'],
      animationIterationCount: 'infinite',
    },
  },
  dot1: { '::before': { animationDelay: '0ms' } },
  dot2: { '::before': { animationDelay: `calc(${chat['--status-loop']} / 6)` } },
  dot3: { '::before': { animationDelay: `calc(${chat['--status-loop']} / 3)` } },
  text: {
    minWidth: 0,
    animationName: fade,
    animationDuration: motion['--duration-fast'],
    animationTimingFunction: motion['--ease-out'],
    animationFillMode: 'both',
  },
})
