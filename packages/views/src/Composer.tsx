import * as stylex from '@stylexjs/stylex'
import { ArrowUp } from '@phosphor-icons/react/dist/icons/ArrowUp'
import type { ClipboardEvent, DragEvent, KeyboardEvent, MouseEvent, ReactNode, Ref, SyntheticEvent } from 'react'
import { accent, layout, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { IconButton, Surface, Textarea, type TextareaMark } from '@juno/ui'

/** The open @, # or emoji suggestions (inventory 7.1). */
export interface ComposerMention {
  /** The offset of the "@" or "#" being typed: the list lines up under it. */
  readonly anchorAt: number
  /** The list's element id, and its highlighted row's. */
  readonly listId: string
  readonly activeId: string | undefined
  /** `MentionSuggestions`, or nothing while there is no match. */
  readonly list: ReactNode
  /** The field lost focus: the list closes. */
  readonly onDismiss: () => void
}

/** A panel over the field other than the suggestions: the link editor. */
export interface ComposerPopover {
  /** The offset of the first selected character: the panel lines up under it. */
  readonly anchorAt: number
  readonly content: ReactNode
}

export interface ComposerProps {
  /** The draft is the owner's: controlled. */
  readonly value: string
  /** With the caret's offset after the change. */
  readonly onChange: (value: string, caret: number) => void
  /** Enter, or the send button. Called with an empty draft too: the owner decides (Home with nothing chosen opens the destination list). */
  readonly onSend: () => void
  /** "Message", "Message #eng", "Reply". */
  readonly placeholder: string
  /** A send is in flight: the field stays editable, the button does not send twice. */
  readonly sending?: boolean
  /** Above the field, inside its column: Home's Recent and destination chip. */
  readonly above?: ReactNode
  readonly inputRef?: Ref<HTMLTextAreaElement>
  /** ↑ in an empty field: a topic selects its newest message (SPEC section 7, Keyboard). */
  readonly onArrowUpEmpty?: () => void
  /** Inside the box, above the text: the audience warning and the send check bar (inventory 7). */
  readonly notices?: ReactNode
  /** Esc in the field, while there is something to close (the send check bar). */
  readonly onEscape?: () => void
  /**
   * Before the text: the attach button (`AttachButton`, inventory 7). With
   * it the field's start padding is 6px, the send button's end inset.
   */
  readonly leading?: ReactNode
  /** The chips of the files going with the message: a row inside the field, above the text. */
  readonly attachments?: ReactNode
  /** Files pasted into the field or dropped on the composer. */
  readonly onFiles?: (files: ReadonlyArray<File>) => void
  /** Files are being dragged over the topic: the field shows a quiet accent ring. */
  readonly dropping?: boolean
  /** Picked @people and #channels, drawn as chips in the field. */
  readonly marks?: ReadonlyArray<TextareaMark>
  /** The @, # or emoji suggestions while they are open. */
  readonly mention?: ComposerMention
  /** Sees every key in the field first; true when it took the key (the suggestions' arrows, Enter, Tab, Esc, Backspace). */
  readonly onFieldKey?: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean
  /** The caret moved without the text changing: a click or an arrow key. */
  readonly onCaret?: (caret: number) => void
  /** A paste with text and no files; true when the owner took it (a URL over selected words). */
  readonly onPasteText?: (text: string, field: HTMLTextAreaElement) => boolean
  /** A click in the field, after the caret moved to it: ⌘-click opens a link. */
  readonly onFieldClick?: (event: MouseEvent<HTMLTextAreaElement>) => void
  /** The link editor, while it is open. */
  readonly popover?: ComposerPopover
}

/** The field's side of the @ and # suggestions: chips, the caret, the list's anchor and its ARIA wiring. */
export function mentionProps(marks: ComposerProps['marks'], mention: ComposerMention | undefined, onCaret: ComposerProps['onCaret'], popover?: ComposerPopover) {
  return {
    ...(onCaret === undefined ? {} : { onSelect: (event: SyntheticEvent<HTMLTextAreaElement>) => onCaret(event.currentTarget.selectionStart) }),
    ...(marks === undefined ? {} : { marks, 'aria-autocomplete': 'list' as const }),
    ...(mention === undefined
      ? popover === undefined ? {} : { anchorAt: popover.anchorAt }
      : { anchorAt: mention.anchorAt, onBlur: mention.onDismiss, 'aria-controls': mention.listId, 'aria-activedescendant': mention.activeId, 'aria-expanded': mention.list !== null && mention.list !== undefined }),
  }
}

/** A drag that carries files from Finder, not text or a link. */
const carriesFiles = (event: DragEvent<HTMLElement>) => event.dataTransfer.types.includes('Files')

/**
 * A paste or a drop with files is taken, and a text paste the owner takes;
 * other text pastes and text drags stay the browser's.
 */
function transfers(onFiles: ComposerProps['onFiles'], onPasteText: ComposerProps['onPasteText']) {
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files)
    if (files.length === 0 || onFiles === undefined) {
      const pasted = event.clipboardData.getData('text/plain')
      if (files.length === 0 && pasted !== '' && onPasteText?.(pasted, event.currentTarget) === true) event.preventDefault()
      return
    }
    event.preventDefault()
    onFiles(files)
  }
  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (onFiles === undefined || !carriesFiles(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    const files = Array.from(event.dataTransfer.files)
    if (files.length === 0 || onFiles === undefined) return
    event.preventDefault()
    onFiles(files)
  }
  return { onPaste, onDragOver, onDrop }
}

/**
 * The composer (inventory 7): a 752px field whose textarea grows to 194px,
 * and the round send button, dimmed while there is nothing to send. Enter
 * sends, Shift Enter adds a line. At one line it has the `ComposerSlot`'s
 * geometry, so one replaces the other with no shift. The text starts 18px in,
 * as in the Juno composer; `leading` is where the attach button goes.
 * `notices` grow the box upwards; the text row stays where it is.
 */
export function Composer({ value, onChange, onSend, placeholder, sending = false, above, inputRef, onArrowUpEmpty, leading, notices, onEscape, attachments, onFiles, dropping = false, marks, mention, onFieldKey, onCaret, onPasteText, onFieldClick, popover }: ComposerProps) {
  const empty = value.trim().length === 0
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (onFieldKey?.(event) === true) return
    if (event.key === 'ArrowUp' && value === '' && onArrowUpEmpty !== undefined && !event.shiftKey && !event.metaKey && !event.altKey && !event.ctrlKey) {
      event.preventDefault()
      onArrowUpEmpty()
      return
    }
    if (event.key === 'Escape' && onEscape !== undefined && !event.nativeEvent.isComposing) {
      event.preventDefault()
      onEscape()
      return
    }
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    if (!sending) onSend()
  }
  const { onPaste, onDragOver, onDrop } = transfers(onFiles, onPasteText)
  return (
    <div data-composer="" onDragOver={onFiles === undefined ? undefined : onDragOver} onDrop={onFiles === undefined ? undefined : onDrop} {...stylex.props(styles.outer)}>
      {above !== undefined ? <div {...stylex.props(styles.above)}>{above}</div> : null}
      <Surface kind="field" data-composer-field="" data-dropping={dropping ? '' : undefined} sx={[styles.box, dropping && styles.dropping]}>
        {notices}
        {attachments !== undefined ? <div {...stylex.props(styles.attachments)}>{attachments}</div> : null}
        <div {...stylex.props(styles.row, leading !== undefined && styles.rowWithLeading)}>
          {leading}
          <Textarea
            ref={inputRef}
            variant="inline"
            maxHeight="composer"
            label={placeholder}
            placeholder={placeholder}
            value={value}
            onChange={(event) => onChange(event.currentTarget.value, event.currentTarget.selectionStart)}
            onKeyDown={onKeyDown}
            {...mentionProps(marks, mention, onCaret, popover)}
            onPaste={onFiles === undefined && onPasteText === undefined ? undefined : onPaste}
            onClick={onFieldClick}
            dir="auto"
          />
          <span {...stylex.props(styles.send)}>
            <IconButton
              icon={ArrowUp}
              label="Send"
              size={28}
              iconSize={16}
              iconWeight="bold"
              radius="full"
              variant="primary"
              dimmed={empty || sending}
              onClick={() => {
                if (!sending) onSend()
              }}
            />
          </span>
        </div>
      </Surface>
      {mention?.list}
      {popover?.content}
    </div>
  )
}

const styles = stylex.create({
  outer: {
    flexShrink: 0,
    width: '100%',
    paddingTop: spacing['--space-2'],
    paddingInline: spacing['--space-6'],
    paddingBottom: spacing['--space-5'],
    boxSizing: 'border-box',
    // The suggestions are placed against the field box and the "@" inside it (`MentionSuggestions`).
    position: 'relative',
    anchorScope: 'all',
  },
  above: {
    display: 'flex',
    width: '100%',
    maxWidth: layout['--composer-width'],
    marginInline: 'auto',
    marginBottom: spacing['--space-2'],
  },
  box: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    maxWidth: layout['--composer-width'],
    marginInline: 'auto',
    boxSizing: 'border-box',
    anchorName: '--composer-box',
  },
  // An outline over the 1px border and just outside it: one ring, and no layout change.
  dropping: {
    outlineStyle: 'solid',
    outlineWidth: sizes['--focus-ring-width'],
    outlineOffset: '-1px', // tokens-allow: Inset the outline by the border width.
    outlineColor: accent['--hl-ring'],
  },
  // Under the notices and over the text: the chips start 6px in, under the attach button, 6px under what is above.
  attachments: {
    display: 'flex',
    paddingTop: spacing['--space-1-5'],
    paddingInline: spacing['--space-1-5'],
    minWidth: 0,
  },
  // The row is 40px at one line (the textarea's 9 + 22 + 9). It reaches into the field's 1px border,
  // so the field is 40px tall too, like the ComposerSlot it replaces.
  row: {
    display: 'flex',
    alignItems: 'flex-end',
    minWidth: 0,
    // The padding is the row's, not the box's, so the notices above it span the box.
    paddingInlineStart: spacing['--space-3-5'],
    paddingInlineEnd: spacing['--space-1-5'],
    gap: spacing['--space-1'],
    marginBlock: '-1px', // tokens-allow: Overlap the composer border by one pixel.
  },
  // A 28px leading control sits 6px in, as the send button does at the end.
  rowWithLeading: {
    paddingInlineStart: spacing['--space-1-5'],
  },
  send: {
    display: 'inline-flex',
    flexShrink: 0,
    paddingBlock: spacing['--space-1-5'],
  },
})
