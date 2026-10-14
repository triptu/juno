import * as stylex from '@stylexjs/stylex'
import { useState } from 'react'
import { chatCopy, type ProposedMessage, type ProposedMessageId, type SendMessageCard as SendMessageCardModel } from '@juno/agent-contract'
import { colors, radii, sizes, spacing, text } from '@juno/tokens/tokens.stylex'
import { Button, ContextPill, Text, Textarea } from '@juno/ui'
import type { ChatActions } from '../commands'
import { TextButton } from '../TextButton'
import { ChatCard, MayDuplicate, OpenButton, placeIconFor } from './ChatCard'

export interface SendMessageCardProps {
  readonly card: SendMessageCardModel
  readonly actions: ChatActions
  readonly enter?: boolean
}

/**
 * One to five proposed Slack messages (inventory 12). Each row has the
 * context pill for where it goes, "in {topic}" for a reply inside a
 * thread, and the text, editable until Send. After Send the text box keeps
 * its geometry and each row's result line fills the slot under it, so the
 * card never changes height as rows settle.
 */
export function SendMessageCard({ card, actions, enter }: SendMessageCardProps) {
  const [texts, setTexts] = useState<Readonly<Record<string, string>>>(() => Object.fromEntries(card.messages.map((m) => [m.id, m.text])))
  const editable = card.status._tag === 'open'
  // The text stays in its box while the send is in flight, read-only; the static text takes over once every row has settled.
  const inBox = editable || card.status._tag === 'working'
  const copy = chatCopy.card.sendMessage
  const first = card.messages[0]
  const source = first === undefined ? undefined : <ContextPill tint={first.target.tint} icon={placeIconFor(first.target)} name={first.target.name} kindLabel={first.target.kindLabel} size={22} />
  const send = () => actions.onCard(card.id, { _tag: 'send', texts: card.messages.map((m) => ({ id: m.id, text: texts[m.id] ?? m.text })) })
  return (
    <ChatCard
      id={card.id}
      kind="sendMessage"
      actions={actions}
      enter={enter}
      source={source}
      status={card.status}
      because={card.because}
      dismiss
      buttons={
        <Button variant="primary" size="md" onClick={send}>
          {copy.send}
        </Button>
      }
    >
      <div role="list" {...stylex.props(styles.rows)}>
        {card.messages.map((message) => (
          <Row key={message.id} message={message} text={texts[message.id] ?? message.text} editable={editable} inBox={inBox} onChange={(text) => setTexts((prev) => ({ ...prev, [message.id]: text }))} onSendRow={(id) => actions.onCard(card.id, { _tag: 'sendRow', messageId: id })} actions={actions} />
        ))}
      </div>
    </ChatCard>
  )
}

function Row({
  message,
  text,
  editable,
  inBox,
  onChange,
  onSendRow,
  actions,
}: {
  readonly message: ProposedMessage
  readonly text: string
  readonly editable: boolean
  readonly inBox: boolean
  readonly onChange: (text: string) => void
  readonly onSendRow: (id: ProposedMessageId) => void
  readonly actions: ChatActions
  readonly enter?: boolean
}) {
  const copy = chatCopy.card.sendMessage
  const result = message.result
  return (
    <div role="listitem" data-send-row={result._tag} {...stylex.props(styles.row)}>
      <div {...stylex.props(styles.where)}>
        <ContextPill tint={message.target.tint} icon={placeIconFor(message.target)} name={message.target.name} kindLabel={message.target.kindLabel} showKind size={22} />
        {message.inTopic !== undefined ? (
          <Text variant="meta" tone="muted" truncate>
            {copy.inTopic(message.inTopic.title)}
          </Text>
        ) : null}
      </div>
      {inBox ? (
        <Textarea variant="card" label={`Message to ${message.target.name}`} value={text} readOnly={!editable} onChange={(event) => onChange(event.currentTarget.value)} dir="auto" />
      ) : (
        <p dir="auto" {...stylex.props(styles.sentText)}>
          {text}
        </p>
      )}
      <div {...stylex.props(styles.result)}>
        {result._tag === 'sent' ? (
          <Text variant="meta" tone="muted">
            {copy.sent} · <OpenButton target={result.open} actions={actions} />
          </Text>
        ) : result._tag === 'notSent' ? (
          <Text variant="meta" tone="muted">
            {copy.notSent} · <TextButton onClick={() => onSendRow(message.id)}>{chatCopy.delivery.tryAgain}</TextButton>
            <MayDuplicate />
          </Text>
        ) : result._tag === 'unknown' ? (
          <Text variant="meta" tone="muted">
            {copy.unknown} <OpenButton target={result.check} actions={actions} label={copy.check} /> · <TextButton onClick={() => onSendRow(message.id)}>{copy.sendAgain}</TextButton>
            <MayDuplicate />
          </Text>
        ) : null}
      </div>
    </div>
  )
}

const styles = stylex.create({
  rows: {
    display: 'flex',
    flexDirection: 'column',
  },
  row: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-1-5'],
    paddingBlock: spacing['--space-2'],
    borderTopWidth: '1px',
    borderTopStyle: 'solid',
    borderTopColor: {
      default: colors['--border-subtle'],
      ':first-child': 'transparent',
    },
  },
  where: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
    minWidth: 0,
    minHeight: sizes['--control-22'],
    userSelect: 'none',
  },
  // The same box as the card textarea (its type setting, two rows, padding 8 10, a 1px edge), with the edge gone.
  sentText: {
    boxSizing: 'border-box',
    margin: 0,
    minHeight: `calc(2 * ${text['--text-body-size']} * ${text['--text-body-small-leading']} + 2 * ${spacing['--space-2']} + 2px)`,
    fontFamily: text['--text-body-family'],
    fontSize: text['--text-body-size'],
    fontWeight: text['--text-body-weight'],
    lineHeight: text['--text-body-small-leading'],
    letterSpacing: text['--text-body-tracking'],
    color: colors['--foreground-subtle'],
    userSelect: 'text',
    paddingBlock: spacing['--space-2'],
    paddingInline: spacing['--space-2-5'],
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'transparent',
    borderRadius: radii['--radius-lg'],
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
  },
  // The row's outcome, in a slot that is there from the start.
  result: {
    display: 'flex',
    alignItems: 'center',
    minHeight: sizes['--control-18'],
    minWidth: 0,
    userSelect: 'none',
  },
})
