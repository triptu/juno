import * as stylex from '@stylexjs/stylex'
import { memo } from 'react'
import type { JunoBubbleItem } from '@juno/agent-contract'
import { chat, colors, motion, spacing } from '@juno/tokens/tokens.stylex'
import { focusRing, Text, tooltip } from '@juno/ui'
import type { ChatActions } from './commands'
import { QuoteStub } from './QuoteStub'
import { ReactionBadge } from './ReactionBadge'
import { JunoRichText } from './JunoRichText'
import { groupGap, isGroupEnd, rowStyles } from './rows'
import { fullTime, messageHeaderTime } from '../time'

export interface JunoBubbleProps {
  readonly item: JunoBubbleItem
  readonly now: number
  readonly actions: ChatActions
  /** Fade in on mount: a bubble arrives whole. Pass false for a bubble drawn in a settled list. */
  readonly enter?: boolean
  /** Laid out in full even off screen, never at the size estimate. */
  readonly eager?: boolean
  /** A narrow column: the time leaves the row, so the bubble keeps its room, and shows as the bubble's tooltip. */
  readonly compact?: boolean
}

/**
 * One Juno bubble (inventory 12). It arrives whole, never streamed, and
 * fades in at full size. The bubbles carry Juno's voice alone, with no
 * mark beside them (SPEC 13.1); a reply shows its quote above; reactions sit on the top corner out of
 * flow; the time shows beside it on hover. Its menu (a right-click) reacts,
 * replies and copies. The slot under a group's last bubble is kept, as the
 * owner's is, so the spacing matches.
 */
export const JunoBubble = memo(function JunoBubble({ item, now, actions, enter = true, eager = false, compact = false }: JunoBubbleProps) {
  const end = isGroupEnd(item.group)
  const menu = actions.onContextMenu
  const replyTo = item.replyTo
  return (
    <div data-chat-juno={item.id} data-unread={item.unread || undefined} {...stylex.props(groupGap[item.group], styles.root, enter && styles.enter)}>
      {replyTo !== undefined ? (
        <div {...stylex.props(styles.quote)}>
          <QuoteStub quote={replyTo} onOpen={() => actions.onQuote(replyTo.target)} />
        </div>
      ) : null}
      <div {...stylex.props(rowStyles.row, rowStyles.contained, eager && rowStyles.eager)}>
        <div
          data-chat-run={item.runId}
          data-chat-row=""
          tabIndex={-1}
          onContextMenu={menu === undefined ? undefined : (event) => menu({ kind: 'juno', id: item.id }, event)}
          {...(compact ? tooltip(fullTime(item.at)) : {})}
          {...stylex.props(rowStyles.bubble, rowStyles.anchor, styles.bubble, end && rowStyles.tailStart, focusRing.inset)}
        >
          <Text variant="bodySmall" tone="default" selectable dir="auto" as="div" sx={[rowStyles.bubbleText, styles.blocks]}>
            <JunoRichText body={item.body} now={now} actions={actions} />
          </Text>
          {actions.renderReactions?.(item.reactions, 'end') ?? <ReactionBadge reactions={item.reactions} corner="end" />}
        </div>
        {compact ? null : (
          <Text variant="tag" tone="muted" numeric as="time" title={fullTime(item.at)} sx={rowStyles.time}>
            {messageHeaderTime(item.at, now)}
          </Text>
        )}
      </div>
      {end ? <div aria-hidden {...stylex.props(rowStyles.lineSlot)} /> : null}
    </div>
  )
})

const appear = stylex.keyframes({
  from: { opacity: 0 },
  to: { opacity: 1 },
})

const styles = stylex.create({
  root: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    minWidth: 0,
  },
  // Laid out at full size and only fades in: a bubble arriving never grows.
  enter: {
    animationName: appear,
    animationDuration: motion['--duration-appear'],
    animationTimingFunction: motion['--ease-out'],
    animationFillMode: 'both',
  },
  // Blocks of a bubble sit a short step apart, closer than bubbles do.
  blocks: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-1-5'],
    minWidth: 0,
  },
  bubble: {
    backgroundColor: chat['--juno-bubble-bg'],
    color: colors['--foreground-default'],
  },
  // Above the bubble, on its edge.
  quote: {
    display: 'flex',
    maxWidth: '100%',
    boxSizing: 'border-box',
    marginBottom: spacing['--space-0-5'],
  },
})
