/**
 * Styles the bubble rows share: group spacing, the hover-revealed time,
 * and the fixed line under a group's last bubble where a delivery or an
 * ending line goes. The line's slot is always there, so a line arriving
 * or leaving never moves the bubbles.
 */
import * as stylex from '@stylexjs/stylex'
import type { GroupPosition } from '@juno/agent-contract'
import { chat, colors, radii, sizes, spacing } from '@juno/tokens/tokens.stylex'

export const HOVER = '@media (hover: hover)'

/** The space between a bubble and the one before it: 2px inside a group, 8px between groups (the 18px line slot adds the rest). */
export const groupGap = stylex.create({
  single: { marginTop: spacing['--space-2'] },
  first: { marginTop: spacing['--space-2'] },
  middle: { marginTop: spacing['--space-0-5'] },
  last: { marginTop: spacing['--space-0-5'] },
})

export const isGroupEnd = (group: GroupPosition): boolean => group === 'last' || group === 'single'

export const rowStyles = stylex.create({
  row: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: spacing['--space-2-5'],
    minWidth: 0,
    // Hidden until the pointer is over the row or keyboard focus is inside it; only opacity changes.
    '--row-action-opacity': {
      default: '0',
      ':hover': { default: null, [HOVER]: '1' },
      ':focus-visible': '1',
      ':has(:focus-visible)': '1',
    },
  },
  // The row is a layout and paint unit; off-screen rows are skipped (performance.md 3.3).
  contained: {
    contain: 'content',
    contentVisibility: 'auto',
    containIntrinsicSize: `auto ${sizes['--row-message-estimate']}`,
  },
  time: {
    flexShrink: 0,
    alignSelf: 'center',
    opacity: 'var(--row-action-opacity)',
    whiteSpace: 'nowrap',
  },
  bubble: {
    boxSizing: 'border-box',
    maxWidth: chat['--bubble-max-width'],
    minWidth: 0,
    paddingBlock: spacing['--space-2'],
    paddingInline: spacing['--space-3'],
    borderRadius: radii['--radius-bubble'],
  },
  bubbleText: {
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
  },
  // The 4px tail on the last bubble of a group.
  tailEnd: {
    borderEndEndRadius: chat['--bubble-tail'],
  },
  tailStart: {
    borderEndStartRadius: chat['--bubble-tail'],
  },
  // The fixed slot for a delivery or ending line.
  lineSlot: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-1'],
    minHeight: sizes['--control-18'],
    minWidth: 0,
    color: colors['--foreground-muted'],
    userSelect: 'none',
  },
  lineText: {
    textWrap: 'pretty',
  },
})
