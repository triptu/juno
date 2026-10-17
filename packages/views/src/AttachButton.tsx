import * as stylex from '@stylexjs/stylex'
import { Plus } from '@phosphor-icons/react/dist/icons/Plus'
import { useRef, type ChangeEvent } from 'react'
import { spacing } from '@juno/tokens/tokens.stylex'
import { IconButton } from '@juno/ui'

export interface AttachButtonProps {
  /** The files picked in the system's file picker. */
  readonly onFiles: (files: ReadonlyArray<File>) => void
  /** In the Tab order. Home leaves it out, so Shift Tab goes from the field to the destination chip (SPEC 12). */
  readonly tabbable?: boolean
}

/**
 * The composer's attach button (inventory 7): a 28px round `plus`, 6px in
 * from the field's start edge as the send button is from its end. It opens
 * the system's file picker; picking the same file twice works, since the
 * input is emptied after each pick.
 */
export function AttachButton({ onFiles, tabbable = true }: AttachButtonProps) {
  const input = useRef<HTMLInputElement>(null)
  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ''
    if (files.length > 0) onFiles(files)
  }
  return (
    <span {...stylex.props(styles.slot)}>
      <IconButton icon={Plus} label="Attach files" size={28} iconSize={18} radius="full" variant="ghost" tone="subtle" data-attach="" {...(tabbable ? {} : { tabIndex: -1 })} onClick={() => input.current?.click()} />
      <input ref={input} type="file" multiple tabIndex={-1} aria-hidden onChange={onChange} {...stylex.props(styles.input)} />
    </span>
  )
}

const styles = stylex.create({
  // The send button's slot, mirrored: 6px above and below at one line.
  slot: {
    display: 'inline-flex',
    flexShrink: 0,
    paddingBlock: spacing['--space-1-5'],
  },
  input: {
    display: 'none',
  },
})
