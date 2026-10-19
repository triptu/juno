import * as stylex from '@stylexjs/stylex'
import { useRef, type KeyboardEvent } from 'react'
import type { MessageView, Person, PickConversation, PickConversations } from '@juno/contract'
import { colors, layout, spacing } from '@juno/tokens/tokens.stylex'
import { Avatar, Button, Surface, Text, TextField, type HueName } from '@juno/ui'
import { DestinationChip } from './DestinationPickers'
import { hueFor, initials } from './look'
import { MessageBody } from './MessageBody'

export interface ForwardSheetProps {
  /** The message forwarded, as the list shows it. */
  readonly message: MessageView
  readonly sender: Person | undefined
  /** Where the message was posted: "#eng", "Maya Chen". */
  readonly place: string
  readonly now: number
  readonly hueOf: (id: string) => HueName
  /** Where it goes; none until one is picked. */
  readonly destination: PickConversation | undefined
  readonly pickerOpen: boolean
  readonly onPickerOpen: (open: boolean) => void
  readonly query: string
  readonly onQuery: (query: string) => void
  /** The destination list's sections; undefined while they load. */
  readonly conversations: PickConversations | undefined
  readonly loading?: boolean
  readonly onPick: (conversation: PickConversation) => void
  readonly note: string
  readonly onNote: (note: string) => void
  /** The forward is being queued (a DM may be opened first): Forward waits. */
  readonly busy?: boolean
  readonly onForward: () => void
  readonly onCancel: () => void
}

/**
 * The Forward sheet (spec section 7, "Forward"): one destination from the
 * same list as Home's destination chip, an optional note, the message as
 * it will be shared, then Cancel and Forward. It opens with the list open,
 * so typing searches at once; a pick puts focus in the note. Enter in the
 * note forwards. Escape closes the list first, then the sheet (the
 * container's `SheetLayer`).
 */
export function ForwardSheet({ message, sender, place, now, hueOf, destination, pickerOpen, onPickerOpen, query, onQuery, conversations, loading, onPick, note, onNote, busy = false, onForward, onCancel }: ForwardSheetProps) {
  const noteField = useRef<HTMLInputElement>(null)
  const ready = destination !== undefined && !busy
  const pick = (conversation: PickConversation | undefined) => {
    if (conversation === undefined) return
    onPick(conversation)
    noteField.current?.focus()
  }
  const onNoteKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    event.preventDefault()
    if (ready) onForward()
    else if (destination === undefined) onPickerOpen(true)
  }
  return (
    <Surface kind="popover" as="section" role="dialog" aria-label="Forward message" aria-modal data-forward-sheet="" padding="none" sx={styles.sheet}>
      <div {...stylex.props(styles.inner)}>
        <Text variant="heading" tone="default" as="h2">
          Forward message
        </Text>
        <div {...stylex.props(styles.to)}>
          <Text variant="ui" tone="muted" as="span">
            To
          </Text>
          <DestinationChip
            destination={destination}
            juno={false}
            placement="bottom-start"
            open={pickerOpen}
            onOpen={onPickerOpen}
            query={query}
            onQuery={onQuery}
            conversations={conversations}
            {...(loading === undefined ? {} : { loading })}
            onPick={pick}
          />
        </div>
        <TextField ref={noteField} size={34} label="Note" placeholder="Add a note" value={note} maxLength={4000} onChange={(event) => onNote(event.currentTarget.value)} onKeyDown={onNoteKey} />
        <ForwardPreview message={message} sender={sender} place={place} now={now} hueOf={hueOf} />
        <div {...stylex.props(styles.buttons)}>
          <Button variant="secondary" size="md" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" size="md" disabled={!ready} onClick={onForward}>
            Forward
          </Button>
        </div>
      </div>
    </Surface>
  )
}

/** The message as it will be shared: who wrote it and where, then its words. */
function ForwardPreview({ message, sender, place, now, hueOf }: Pick<ForwardSheetProps, 'message' | 'sender' | 'place' | 'now' | 'hueOf'>) {
  const name = sender?.name ?? 'Someone'
  return (
    <div aria-label="Message to forward" role="group" data-forward-preview="" {...stylex.props(styles.preview)}>
      <div {...stylex.props(styles.sender)}>
        <Avatar
          label={sender === undefined ? '?' : initials(name)}
          size={20}
          hue={sender === undefined ? hueOf(message.senderId ?? message.ts) : hueFor(sender.color, sender.id)}
          {...(sender?.avatarUrl === undefined ? {} : { src: sender.avatarUrl })}
        />
        <Text variant="ui" weight="medium" tone="default" as="span" truncate>
          {name}
        </Text>
        <Text variant="meta" tone="muted" as="span" truncate>
          {place}
        </Text>
      </div>
      <div {...stylex.props(styles.body)}>
        <MessageBody body={message.body} now={now} hueOf={hueOf} />
      </div>
    </div>
  )
}

const styles = stylex.create({
  sheet: {
    width: '100%',
    maxWidth: layout['--palette-width'],
    boxSizing: 'border-box',
  },
  inner: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-3'],
    paddingBlock: spacing['--space-4'],
    paddingInline: spacing['--space-5'],
  },
  to: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
    minWidth: 0,
  },
  // The shared card's shape: a rule on the leading edge, the sender, then the words.
  preview: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-1-5'],
    minWidth: 0,
    paddingInline: spacing['--space-3'],
    paddingBlock: spacing['--space-2'],
    borderInlineStartWidth: spacing['--space-0-5'],
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: colors['--border-strongest'],
  },
  sender: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
    minWidth: 0,
  },
  // A long message is cut, and the cut fades out so a half line never reads as a whole one. The fade sits at the cut, so a short message shows whole.
  body: {
    maxHeight: layout['--thumb-max-height'],
    overflow: 'hidden',
    maskImage: `linear-gradient(to bottom, black calc(${layout['--thumb-max-height']} - ${spacing['--space-8']}), transparent ${layout['--thumb-max-height']})`, // tokens-allow: a mask's alpha, not a colour that shows.
  },
  buttons: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: spacing['--space-1-5'],
    paddingTop: spacing['--space-1'],
  },
})
