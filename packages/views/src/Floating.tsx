import * as stylex from '@stylexjs/stylex'
import { Quotes } from '@phosphor-icons/react/dist/icons/Quotes'
import { Sparkle } from '@phosphor-icons/react/dist/icons/Sparkle'
import type { MouseEvent, ReactNode } from 'react'
import { junoPanelCopy } from '@juno/agent-contract'
import { menuKeys } from '@juno/contract/channels'
import { spacing, z } from '@juno/tokens/tokens.stylex'
import { IconButton, Surface } from '@juno/ui'

/**
 * Where a floating element sits, in CSS pixels from the top left of the
 * list area (`TopicView`'s and `JunoChatFrame`'s `floating` slot), which the
 * container measured.
 *
 * - `below-end`: under `y`, its right edge at `x` (the emoji picker under
 *   the toolbar's More reactions button, the Juno chat's reactions under React).
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
 * passes the point; nothing here reads layout. The point is rounded to whole
 * pixels: a selection's edges rarely are, and the icons inside would then
 * draw off their buttons' centres.
 */
export function Floating({ x, y, placement, layer, children }: FloatingProps) {
  return (
    <div data-floating={layer} {...stylex.props(styles.base, layer === 'picker' ? styles.picker : styles.selection, styles.at(Math.round(x), Math.round(y)), placements[placement])}>
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
