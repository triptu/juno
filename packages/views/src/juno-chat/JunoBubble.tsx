import * as stylex from '@stylexjs/stylex'
import { memo, type ReactNode } from 'react'
import { chatCopy, type Ending, type JunoInline, type JunoMessageItem, type OpId } from '@juno/agent-contract'
import { colors, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Text } from '@juno/ui'
import { renderCard } from './cards'
import type { ChatActions } from './commands'
import { JunoMark } from './JunoMark'
import { groupGap, isGroupEnd, rowStyles } from './rows'
import { TextButton } from './TextButton'
import { fullTime, messageTime } from '../time'

export interface JunoBubbleProps {
  readonly item: JunoMessageItem
  readonly now: number
  readonly actions: ChatActions
}

/**
 * Juno's bubble (inventory 12): the mark beside the last bubble of a group,
 * plain text with recall citations, the cards under it at column width,
 * and the ending line in the fixed slot under the group's last bubble.
 * While `streaming` the text grows in place with no cursor. A message whose
 * run ended before its first token has an empty body and shows the ending
 * line alone.
 */
export const JunoBubble = memo(function JunoBubble({ item, now, actions }: JunoBubbleProps) {
  const end = isGroupEnd(item.group)
  const hasBubble = item.body.length > 0 || item.streaming
  const menu = actions.onContextMenu
  return (
    <div data-chat-juno={item.id} data-unread={item.unread || undefined} {...stylex.props(groupGap[item.group], styles.root)}>
      {hasBubble ? (
        <div {...stylex.props(rowStyles.row, rowStyles.contained)}>
          <span {...stylex.props(styles.gutter)}>{end ? <JunoMark /> : null}</span>
          <div
            data-streaming={item.streaming || undefined}
            onContextMenu={menu === undefined ? undefined : (event) => menu({ kind: 'juno', id: item.id }, event)}
            {...stylex.props(rowStyles.bubble, styles.bubble, end && rowStyles.tailStart)}
          >
            <Text variant="bodySmall" tone="default" selectable dir="auto" as="p" sx={rowStyles.bubbleText}>
              {item.body.map((inline, index) => (
                <Inline key={index} inline={inline} actions={actions} />
              ))}
            </Text>
          </div>
          <Text variant="tag" tone="muted" numeric as="time" title={fullTime(item.at)} sx={rowStyles.time}>
            {messageTime(item.at, now)}
          </Text>
        </div>
      ) : null}
      {item.cards.length > 0 ? (
        <div {...stylex.props(styles.cards)}>
          {item.cards.map((card) => (
            <div key={card.id} {...stylex.props(styles.card)}>
              {renderCard(card, actions, now)}
            </div>
          ))}
        </div>
      ) : null}
      {end ? (
        <div {...stylex.props(rowStyles.lineSlot, styles.lineSlot)}>
          <EndingLine ending={item.ending} onRetry={actions.onRetry} />
        </div>
      ) : null}
    </div>
  )
})

function Inline({ inline, actions }: { readonly inline: JunoInline; readonly actions: ChatActions }) {
  if (inline._tag === 'text') return inline.text
  return (
    <TextButton tone="subtle" data-cite={inline.messageId} onClick={() => actions.onOpen({ _tag: 'chatMessage', messageId: inline.messageId }, { metaKey: false, shiftKey: false, altKey: false, source: 'pointer' })}>
      {inline.text}
    </TextButton>
  )
}

function EndingLine({ ending, onRetry }: { readonly ending: Ending; readonly onRetry: (opId: OpId) => void }) {
  const copy = chatCopy.ending
  const retry = (opId: OpId | undefined) => (opId === undefined ? null : <TextButton onClick={() => onRetry(opId)}>{copy.tryAgain}</TextButton>)
  switch (ending._tag) {
    case 'complete':
      return null
    case 'stopped':
      return <Line kind="stopped">{copy.stopped}</Line>
    case 'interrupted':
      return (
        <Line kind="interrupted">
          {copy.interrupted} {retry(ending.retry)}
        </Line>
      )
    case 'blocked':
      return <Line kind="blocked">{copy.blocked[ending.reason]}</Line>
    case 'failed':
      return (
        <Line kind="failed">
          {copy.failed[ending.reason]} {retry(ending.retry)}
        </Line>
      )
  }
}

function Line({ kind, children }: { readonly kind: string; readonly children: ReactNode }) {
  return (
    <Text variant="meta" tone="muted" data-ending={kind} sx={rowStyles.lineText}>
      {children}
    </Text>
  )
}

const styles = stylex.create({
  root: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    minWidth: 0,
  },
  gutter: {
    display: 'inline-flex',
    flexShrink: 0,
    width: sizes['--avatar-28'],
    minHeight: sizes['--avatar-28'],
    userSelect: 'none',
  },
  bubble: {
    backgroundColor: colors['--surface-hover'],
    color: colors['--foreground-default'],
  },
  // Under the bubble, past the mark's column: 28px mark plus the 10px gap.
  cards: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-2'],
    width: '100%',
    boxSizing: 'border-box',
    marginTop: spacing['--space-2'],
    paddingInlineStart: `calc(${spacing['--space-7']} + ${spacing['--space-2-5']})`,
  },
  card: {
    display: 'flex',
    width: '100%',
    minWidth: 0,
  },
  lineSlot: {
    paddingInlineStart: `calc(${spacing['--space-7']} + ${spacing['--space-2-5']} + ${spacing['--space-0-5']})`,
  },
})
