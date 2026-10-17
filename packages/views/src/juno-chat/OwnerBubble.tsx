import * as stylex from '@stylexjs/stylex'
import { memo, type MouseEvent } from 'react'
import { aboutLabel, chatCopy, type About, type Delivery, type OwnerMessageItem } from '@juno/agent-contract'
import { accent, chat, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Text } from '@juno/ui'
import type { ChatActions } from './commands'
import { OwnerFiles } from './OwnerFiles'
import { QuoteStub } from './QuoteStub'
import { ReactionBadge } from './ReactionBadge'
import { groupGap, isGroupEnd, rowStyles } from './rows'
import { TextButton } from './TextButton'
import { fullTime, messageTime } from '../time'

export interface OwnerBubbleProps {
  readonly item: OwnerMessageItem
  readonly now: number
  readonly actions: ChatActions
  /** Laid out in full even off screen, never at the size estimate. */
  readonly eager?: boolean
}

/**
 * The owner's bubble (inventory 12): right-aligned in the owner fill, the
 * tail on the last of a group, the time on hover to its left, and the
 * delivery line in the fixed slot under the group's last bubble. A message
 * sent from the Juno panel or with an About chip has the "About …" line
 * over its group's first bubble; a topic's opens the topic. A reply
 * shows its quote above; Juno's reaction sits on the top corner, out of
 * flow. Images and text files the message gave Juno sit over the bubble;
 * a message of files alone has no bubble. A message sent while Juno works looks like any other. The fill
 * and text come from the `chat` token group, so the owner's colour choice
 * is a token change.
 */
export const OwnerBubble = memo(function OwnerBubble({ item, now, actions, eager = false }: OwnerBubbleProps) {
  const end = isGroupEnd(item.group)
  const menu = actions.onContextMenu
  const replyTo = item.replyTo
  const about = item.about !== undefined && (item.group === 'first' || item.group === 'single') ? item.about : undefined
  const files = item.files !== undefined && item.files.length > 0 ? item.files : undefined
  // A message of files alone has no bubble.
  const wordless = files !== undefined && item.text.trim() === ''
  const onMenu = menu === undefined ? undefined : (event: MouseEvent<HTMLElement>) => menu({ kind: 'owner', opId: item.opId, ...(item.id === undefined ? {} : { id: item.id }) }, event)
  return (
    <div data-chat-owner={item.opId} {...stylex.props(groupGap[item.group], styles.root)}>
      {about !== undefined ? <AboutLine about={about} actions={actions} /> : null}
      {replyTo !== undefined ? (
        <div {...stylex.props(styles.quote)}>
          <QuoteStub quote={replyTo} onOpen={() => actions.onQuote(replyTo.target)} />
        </div>
      ) : null}
      <div {...stylex.props(rowStyles.row, rowStyles.contained, eager && rowStyles.eager, styles.row)}>
        <Text variant="tag" tone="muted" numeric as="time" title={fullTime(item.at)} sx={rowStyles.time}>
          {messageTime(item.at, now)}
        </Text>
        <div {...stylex.props(styles.content)}>
          {files !== undefined ? (
            <div onContextMenu={wordless ? onMenu : undefined} {...stylex.props(wordless && rowStyles.anchor)}>
              <OwnerFiles opId={item.opId} files={files} renderImage={actions.renderOwnerImage} />
              {wordless ? <ReactionBadge reactions={item.reactions} corner="start" /> : null}
            </div>
          ) : null}
          {wordless ? null : (
            <div onContextMenu={onMenu} {...stylex.props(rowStyles.bubble, rowStyles.anchor, styles.bubble, styles.fill, end && rowStyles.tailEnd)}>
              <Text variant="bodySmall" tone="inherit" selectable dir="auto" as="p" sx={rowStyles.bubbleText}>
                {item.text}
              </Text>
              <ReactionBadge reactions={item.reactions} corner="start" />
            </div>
          )}
        </div>
      </div>
      {end ? (
        <div {...stylex.props(rowStyles.lineSlot, styles.lineSlot)}>
          <DeliveryLine delivery={item.delivery} onRetry={() => actions.onRetry(item.opId)} />
        </div>
      ) : null}
    </div>
  )
})

function AboutLine({ about, actions }: { readonly about: About; readonly actions: ChatActions }) {
  const text = `${chatCopy.about.prefix}${aboutLabel(about)}`
  if (about._tag !== 'topic') {
    return (
      <Text variant="tag" tone="muted" truncate dir="auto" data-about={about._tag} sx={styles.about}>
        {text}
      </Text>
    )
  }
  const open = (event: MouseEvent<HTMLButtonElement>) =>
    actions.onOpen({ _tag: 'topic', topicId: about.topicId }, { metaKey: event.metaKey, shiftKey: event.shiftKey, altKey: event.altKey, source: 'pointer' })
  return (
    <button type="button" data-about="topic" onClick={open} {...stylex.props(styles.about, styles.aboutButton)}>
      <Text variant="tag" tone="muted" truncate dir="auto">
        {text}
      </Text>
    </button>
  )
}

function DeliveryLine({ delivery, onRetry }: { readonly delivery: Delivery; readonly onRetry: () => void }) {
  const copy = chatCopy.delivery
  switch (delivery._tag) {
    case 'sending':
    case 'sent':
      return null
    case 'waiting':
      return (
        <Text variant="meta" tone="muted" sx={rowStyles.lineText} data-delivery="waiting">
          {copy.waiting[delivery.for]}
        </Text>
      )
    case 'failed':
      return delivery.reason === 'tooLong' ? (
        <Text variant="meta" tone="muted" sx={rowStyles.lineText} data-delivery="failed">
          {copy.tooLong}
        </Text>
      ) : (
        <Text variant="meta" tone="muted" sx={rowStyles.lineText} data-delivery="failed">
          {copy.notDelivered} · <TextButton onClick={onRetry}>{copy.tryAgain}</TextButton>
        </Text>
      )
  }
}

const styles = stylex.create({
  root: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    minWidth: 0,
  },
  row: {
    justifyContent: 'flex-end',
    width: '100%',
  },
  bubble: {
    backgroundColor: chat['--owner-bubble-bg'],
    color: chat['--owner-bubble-fg'],
  },
  lineSlot: {
    justifyContent: 'flex-end',
    textAlign: 'end',
    paddingInlineEnd: spacing['--space-0-5'],
  },
  // One line over the group, right-aligned and no wider than a bubble.
  about: {
    display: 'flex',
    maxWidth: chat['--bubble-max-width'],
    minWidth: 0,
    marginBottom: spacing['--space-0-5'],
    userSelect: 'none',
  },
  aboutButton: {
    appearance: 'none',
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    font: 'inherit',
    textAlign: 'end',
    cursor: 'default',
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineWidth: sizes['--focus-ring-width'],
    outlineOffset: sizes['--focus-ring-offset'],
    scrollMargin: sizes['--focus-ring-room'],
    outlineColor: accent['--focus-ring'],
  },
  // Inside `content`, which already has the bubble's width.
  fill: {
    maxWidth: '100%',
  },
  // Files over the bubble, both on the row's end edge, no wider than a bubble.
  content: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    minWidth: 0,
    maxWidth: chat['--bubble-max-width'],
  },
  quote: {
    display: 'flex',
    justifyContent: 'flex-end',
    maxWidth: chat['--bubble-max-width'],
    marginBottom: spacing['--space-0-5'],
  },
})
