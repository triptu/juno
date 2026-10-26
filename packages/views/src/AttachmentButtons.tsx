import * as stylex from '@stylexjs/stylex'
import { useState } from 'react'
import type { BodyBlock } from '@juno/contract'
import { spacing, text } from '@juno/tokens/tokens.stylex'
import { Button, Text } from '@juno/ui'

type Buttons = Extract<BodyBlock, { kind: 'buttons' }>
type Item = Buttons['items'][number]

/** A press on a message's button: the attachment's and the button's ids. Answers whether Slack took it. */
export type OnAttachmentButton = (attachment: string, button: string) => Promise<boolean>

/**
 * An attachment's buttons: Slackbot's Add Them and Dismiss, or any app's.
 * A press shows at once: the other buttons dim and the row takes no other
 * press until Slack answers. Slack then replaces or removes the message
 * itself. A button with Slack's question asks it first, in place of the
 * row. A press Slack refused says so under the row. Without `onButton`
 * (where the message cannot be acted on) the buttons are dimmed.
 */
export function AttachmentButtons({ block, onButton, tabbable }: { readonly block: Buttons; readonly onButton: OnAttachmentButton | undefined; readonly tabbable: boolean }) {
  const [pending, setPending] = useState<string>()
  const [asking, setAsking] = useState<Item>()
  const [failed, setFailed] = useState(false)
  const tabIndex = tabbable ? 0 : -1
  const send = (item: Item) => {
    if (onButton === undefined || pending !== undefined) return
    setAsking(undefined)
    setFailed(false)
    setPending(item.id)
    void onButton(block.attachment, item.id).then((taken) => {
      setPending(undefined)
      if (!taken) setFailed(true)
    })
  }
  if (asking?.confirm !== undefined) {
    const { title, text: question, ok, dismiss } = asking.confirm
    return <div role="group" aria-label={title ?? question} data-attachment-confirm="" {...stylex.props(styles.confirm)}>
      <Text variant="body" tone="default" as="p" selectable dir="auto">
        {title !== undefined && <span {...stylex.props(styles.title)}>{title} </span>}
        {question}
      </Text>
      <div {...stylex.props(styles.row)}>
        <Button variant="primary" size="sm" tabIndex={tabIndex} onClick={() => send(asking)}>{ok}</Button>
        <Button variant="outline" size="sm" tone="subtle" tabIndex={tabIndex} onClick={() => setAsking(undefined)}>{dismiss}</Button>
      </div>
    </div>
  }
  return <div data-attachment-buttons="" {...stylex.props(styles.confirm)}>
    <div role="group" aria-busy={pending !== undefined} {...stylex.props(styles.row)}>
      {block.items.map((item) => (
        <Button key={item.id} variant={item.style === 'primary' ? 'primary' : 'outline'} size="sm" tabIndex={tabIndex}
          dimmed={onButton === undefined || (pending !== undefined && pending !== item.id)}
          aria-busy={pending === item.id}
          onClick={() => (item.confirm === undefined ? send(item) : pending === undefined && setAsking(item))}>
          {item.text}
        </Button>
      ))}
    </div>
    {failed && <Text variant="meta" tone="danger" as="p" role="alert">Slack didn’t take that. Try again.</Text>}
  </div>
}

const styles = stylex.create({
  confirm: { display: 'flex', flexDirection: 'column', gap: spacing['--space-2'] },
  row: { display: 'flex', flexWrap: 'wrap', gap: spacing['--space-2'] },
  title: { fontWeight: text['--text-heading-weight'] },
})
