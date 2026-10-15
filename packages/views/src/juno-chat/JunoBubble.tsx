import * as stylex from '@stylexjs/stylex'
import { memo } from 'react'
import type { JunoBubbleItem, JunoInline } from '@juno/agent-contract'
import { colors, motion, spacing } from '@juno/tokens/tokens.stylex'
import { Text } from '@juno/ui'
import type { ChatActions } from './commands'
import { QuoteStub } from './QuoteStub'
import { ReactionBadge } from './ReactionBadge'
import { InlineLink } from './InlineLink'
import { groupGap, isGroupEnd, rowStyles } from './rows'
import { RowActions } from './RowActions'
import { fullTime, messageTime } from '../time'

export interface JunoBubbleProps {
  readonly item: JunoBubbleItem
  readonly now: number
  readonly actions: ChatActions
  /** Fade in on mount: a bubble arrives whole. Pass false for a bubble drawn in a settled list. */
  readonly enter?: boolean
}

/**
 * One Juno bubble (inventory 12). It arrives whole, never streamed, and
 * fades in at full size. The bubbles carry Juno's voice alone, with no
 * mark beside them (SPEC 13.1); a reply shows its quote above; reactions sit on the top corner out of
 * flow; React and Reply wait beside it. The slot under a group's last
 * bubble is kept, as the owner's is, so the spacing matches.
 */
export const JunoBubble = memo(function JunoBubble({ item, now, actions, enter = true }: JunoBubbleProps) {
  const end = isGroupEnd(item.group)
  const menu = actions.onContextMenu
  const target = { _tag: 'bubble', id: item.id } as const
  const replyTo = item.replyTo
  return (
    <div data-chat-juno={item.id} data-unread={item.unread || undefined} {...stylex.props(groupGap[item.group], styles.root, enter && styles.enter)}>
      {replyTo !== undefined ? (
        <div {...stylex.props(styles.quote)}>
          <QuoteStub quote={replyTo} onOpen={() => actions.onQuote(replyTo.target)} />
        </div>
      ) : null}
      <div {...stylex.props(rowStyles.row, rowStyles.contained)}>
        <div
          onContextMenu={menu === undefined ? undefined : (event) => menu({ kind: 'juno', id: item.id }, event)}
          {...stylex.props(rowStyles.bubble, rowStyles.anchor, styles.bubble, end && rowStyles.tailStart)}
        >
          <Text variant="bodySmall" tone="default" selectable dir="auto" as="p" sx={rowStyles.bubbleText}>
            {item.body.map((inline, index) => (
              <Inline key={index} inline={inline} now={now} actions={actions} />
            ))}
          </Text>
          <ReactionBadge reactions={item.reactions} corner="end" />
        </div>
        <Text variant="tag" tone="muted" numeric as="time" title={fullTime(item.at)} sx={rowStyles.time}>
          {messageTime(item.at, now)}
        </Text>
        <RowActions target={target} actions={actions} />
      </div>
      {end ? <div aria-hidden {...stylex.props(rowStyles.lineSlot)} /> : null}
    </div>
  )
})

/** A Slack message's `ts` ("1760500000.000123", seconds) as epoch milliseconds. */
const tsMillis = (ts: string) => Math.round(Number(ts) * 1000)

function Inline({ inline, now, actions }: { readonly inline: JunoInline; readonly now: number; readonly actions: ChatActions }) {
  switch (inline._tag) {
    case 'text':
      return inline.text
    case 'cite':
      return (
        <InlineLink data-cite={inline.messageId} onOpen={(event) => actions.onOpen({ _tag: 'chatMessage', messageId: inline.messageId }, event)}>
          {inline.text}
        </InlineLink>
      )
    case 'source':
      return (
        <InlineLink
          data-source={`${inline.channelId}/${inline.ts}`}
          title={`${inline.place} · ${messageTime(tsMillis(inline.ts), now)}`}
          onOpen={(event) => actions.onOpen({ _tag: 'message', channelId: inline.channelId, ts: inline.ts }, event)}
        >
          {inline.text}
        </InlineLink>
      )
  }
}

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
  bubble: {
    backgroundColor: colors['--surface-hover'],
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
