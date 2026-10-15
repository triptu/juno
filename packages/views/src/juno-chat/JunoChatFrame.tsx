import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { accent, colors, spacing, z } from '@juno/tokens/tokens.stylex'
import { Popover } from '@juno/ui'
import { ReactionPicker } from './ReactionPicker'

export interface JunoChatFrameProps {
  /** `JunoHeader`, over the top of the list. */
  readonly header: ReactNode
  /** `JunoChatList`. */
  readonly children: ReactNode
  /** The "New message" pill over the bottom of the list while scrolled up. */
  readonly pill?: ReactNode
  /** `JunoComposer`. */
  readonly composer: ReactNode
  /** The reaction picker, open at a point in the window (the React button's corner). */
  readonly picker?: ReactionPickerAt
}

export interface ReactionPickerAt {
  readonly x: number
  readonly y: number
  readonly selected?: string
  readonly onPick: (emoji: string | null) => void
  readonly onClose: () => void
}

/**
 * The Juno chat as the Juno tab and the Juno panel show it: the header's
 * islands over the list, the pill over its bottom edge, the composer under
 * it. Neither the header nor the pill takes part in the list's layout. The
 * reaction picker floats at the point the container gives it.
 */
export function JunoChatFrame({ header, children, pill, composer, picker }: JunoChatFrameProps) {
  return (
    <div data-juno-chat="" {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.middle)}>
        {header}
        {children}
        {pill !== undefined ? <div {...stylex.props(styles.pill)}>{pill}</div> : null}
      </div>
      {composer}
      {picker !== undefined ? (
        <div {...stylex.props(styles.at(picker.x, picker.y))}>
          <Popover open onClose={picker.onClose} anchor={<span />} placement="bottom-end" width="picker" layer="picker" padding="none" label="Reactions">
            <ReactionPicker {...(picker.selected === undefined ? {} : { selected: picker.selected })} onPick={picker.onPick} />
          </Popover>
        </div>
      ) : null}
    </div>
  )
}

/** The `--duration-appear` value in milliseconds, read once. */
let appearMs: number | undefined
function appearDuration(): number {
  appearMs ??= Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--duration-appear')) || 0
  return appearMs
}

/** Flashes a row the chat scrolled to (a citation, a reply's quote) with the soft accent, once. */
export function flashChatRow(row: Element): void {
  row.animate([{ backgroundColor: accent['--hl-soft'] }, { backgroundColor: colors['--background'] }], { duration: appearDuration(), easing: 'ease-out' })
}

const styles = stylex.create({
  root: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    width: '100%',
    height: '100%',
    minWidth: 0,
    minHeight: 0,
    backgroundColor: colors['--background'],
  },
  middle: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    minHeight: 0,
  },
  pill: {
    position: 'absolute',
    bottom: spacing['--space-3'],
    left: '50%',
    translate: '-50% 0',
    display: 'inline-flex',
    zIndex: z['--z-toolbar'],
  },
  at: (x: number, y: number) => ({
    position: 'fixed',
    left: x,
    top: y,
    width: 0,
    height: 0,
  }),
})
