import * as stylex from '@stylexjs/stylex'
import { memo } from 'react'
import { chatCopy, type StatusItem } from '@juno/agent-contract'
import { chat, colors, motion, radii, spacing } from '@juno/tokens/tokens.stylex'
import { Button, Text } from '@juno/ui'
import type { ChatActions } from './commands'
import { JunoMark } from './JunoMark'
import { groupGap, rowStyles } from './rows'

export interface StatusBubbleProps {
  readonly item: StatusItem
  readonly actions: ChatActions
}

/**
 * The one status bubble (SPEC 13.2): three looping dots in Juno's bubble
 * shape, with the status text beside them once the run has something
 * specific to say. Stop sits to the right and shows on hover or focus; its
 * space is always reserved. Always the last row while a run is active.
 */
export const StatusBubble = memo(function StatusBubble({ item, actions }: StatusBubbleProps) {
  return (
    <div data-chat-status={item.runId} role="status" aria-label={item.text ?? 'Juno is working'} {...stylex.props(groupGap.single, rowStyles.row, styles.row)}>
      <span {...stylex.props(styles.gutter)}>
        <JunoMark />
      </span>
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
      <span {...stylex.props(styles.stop)}>
        <Button variant="ghost" size="xs" tone="subtle" onClick={() => actions.onStop(item.runId)}>
          {chatCopy.status.stop}
        </Button>
      </span>
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
  gutter: {
    display: 'inline-flex',
    flexShrink: 0,
    alignSelf: 'flex-end',
    userSelect: 'none',
  },
  bubble: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2-5'],
    boxSizing: 'border-box',
    minWidth: chat['--status-min-width'],
    maxWidth: chat['--bubble-max-width'],
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
  dot: {
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
  dot1: { animationDelay: '0ms' },
  dot2: { animationDelay: `calc(${chat['--status-loop']} / 6)` },
  dot3: { animationDelay: `calc(${chat['--status-loop']} / 3)` },
  text: {
    minWidth: 0,
    animationName: fade,
    animationDuration: motion['--duration-fast'],
    animationTimingFunction: motion['--ease-out'],
    animationFillMode: 'both',
  },
  // Reserved beside the bubble; only opacity changes on hover or focus.
  stop: {
    display: 'inline-flex',
    flexShrink: 0,
    opacity: 'var(--row-action-opacity)',
  },
})
