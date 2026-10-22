import * as stylex from '@stylexjs/stylex'
import { Quotes } from '@phosphor-icons/react/dist/icons/Quotes'
import { Sparkle } from '@phosphor-icons/react/dist/icons/Sparkle'
import type { MouseEvent } from 'react'
import { junoPanelCopy } from '@juno/agent-contract'
import { menuKeys } from '@juno/contract/channels'
import { spacing } from '@juno/tokens/tokens.stylex'
import { IconButton, Surface } from '@juno/ui'

export interface SelectionToolbarProps {
  /** Quotes the selected text in the topic's composer. Runs on mouse down, so the selection is still there. */
  readonly onQuote: () => void
  /** Asks Juno about the selected text in the panel beside the topic. Absent while AI assist is off. */
  readonly onAskJuno?: () => void
}

/** Mouse down acts, so the selection is still there; a keyboard activation has no mouse down and acts on click. */
const pressProps = (action: () => void) => ({
  onMouseDown: (event: MouseEvent<HTMLButtonElement>) => {
    // Keep the selection: the action takes it.
    event.preventDefault()
    if (event.button === 0) action()
  },
  onClick: (event: MouseEvent<HTMLButtonElement>) => {
    if (event.detail === 0) action()
  },
})

/**
 * The floating toolbar over a text selection in a message (inventory 6.6):
 * Quote, and Ask Juno while AI assist is on. Icon only, in the hover
 * toolbar's 24px round buttons; the tooltip names each. Ask Juno has the
 * header's outline sparkle.
 */
export function SelectionToolbar({ onQuote, onAskJuno }: SelectionToolbarProps) {
  return (
    <Surface kind="toolbar" padding="none" radius="pill" role="toolbar" aria-label="Selection" data-selection-toolbar="" sx={styles.toolbar}>
      <IconButton icon={Quotes} label="Quote" size={24} {...pressProps(onQuote)} />
      {onAskJuno === undefined ? null : (
        <IconButton icon={Sparkle} label={junoPanelCopy.askJuno} shortcut={menuKeys('juno.toggle')} size={24} aria-keyshortcuts="Meta+J" {...pressProps(onAskJuno)} />
      )}
    </Surface>
  )
}

const styles = stylex.create({
  // The hover toolbar's shell: 24px buttons, a 1px inset and the 1px border.
  toolbar: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: spacing['--space-pixel'],
  },
})
