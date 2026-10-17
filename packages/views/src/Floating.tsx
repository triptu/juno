import * as stylex from '@stylexjs/stylex'
import { Quotes } from '@phosphor-icons/react/dist/icons/Quotes'
import type { MouseEvent, ReactNode } from 'react'
import { chatCopy } from '@juno/agent-contract'
import { menuKeys } from '@juno/contract/channels'
import { spacing, z } from '@juno/tokens/tokens.stylex'
import { Button, SparkleDuotone, Surface, tooltip } from '@juno/ui'

/**
 * Where a floating element sits, in CSS pixels from the top left of the
 * topic's message area (`TopicView`'s `floating` slot), which the container
 * measured.
 *
 * - `below-end`: under `y`, its right edge at `x` (the emoji picker under
 *   the toolbar's More reactions button).
 * - `above-end`: over `y`, its right edge at `x` (the picker near the
 *   bottom of the list).
 * - `above-center`: centred on `x`, its bottom `--space-2` over `y` (the
 *   selection's toolbar).
 */
export type FloatingPlacement = 'below-end' | 'above-end' | 'above-center'

export interface FloatingProps {
  readonly x: number
  readonly y: number
  readonly placement: FloatingPlacement
  readonly layer: 'picker' | 'selection'
  readonly children: ReactNode
}

/**
 * Floats a panel or a button over the message list, outside the rows,
 * whose paint containment would clip it. The container measures once and
 * passes the point; nothing here reads layout.
 */
export function Floating({ x, y, placement, layer, children }: FloatingProps) {
  return (
    <div data-floating={layer} {...stylex.props(styles.base, layer === 'picker' ? styles.picker : styles.selection, styles.at(x, y), placements[placement])}>
      {children}
    </div>
  )
}

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

/** The floating toolbar over a text selection in a message (inventory 6.6): Quote, and Ask Juno while AI assist is on. */
export function SelectionToolbar({ onQuote, onAskJuno }: SelectionToolbarProps) {
  return (
    <Surface kind="toolbar" padding="xs" role="toolbar" aria-label="Selection" data-selection-toolbar="" sx={styles.toolbar}>
      <Button variant="ghost" size="sm" tone="subtle" iconStart={Quotes} data-selection-quote="" {...pressProps(onQuote)}>
        Quote
      </Button>
      {onAskJuno === undefined ? null : (
        <Button variant="ghost" size="sm" tone="subtle" iconStart={SparkleDuotone} data-selection-ask-juno="" aria-keyshortcuts="Meta+J" {...tooltip(chatCopy.panel.askJunoTip, menuKeys('juno.toggle'))} {...pressProps(onAskJuno)}>
          {chatCopy.panel.askJuno}
        </Button>
      )}
    </Surface>
  )
}

const styles = stylex.create({
  toolbar: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-0-5'],
  },
  base: {
    position: 'absolute',
    display: 'inline-flex',
    // Over a title bar's drag strip near the top of the page, which would otherwise take the press.
    WebkitAppRegion: 'no-drag',
  },
  picker: {
    zIndex: z['--z-picker'],
  },
  selection: {
    zIndex: z['--z-selection'],
  },
  at: (x: number, y: number) => ({
    left: `${x}px`,
    top: `${y}px`,
  }),
})

const placements = stylex.create({
  'below-end': {
    translate: `-100% ${spacing['--space-1']}`,
  },
  'above-end': {
    translate: `-100% calc(-100% - ${spacing['--space-1']})`,
  },
  'above-center': {
    translate: `-50% calc(-100% - ${spacing['--space-2']})`,
  },
})
