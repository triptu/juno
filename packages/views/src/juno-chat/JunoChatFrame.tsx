import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { accent, colors, spacing, z } from '@juno/tokens/tokens.stylex'
import { rootDuration } from '@juno/ui'

export interface JunoChatFrameProps {
  /** `JunoHeader`, over the top of the list. */
  readonly header: ReactNode
  /** `JunoChatList`. */
  readonly children: ReactNode
  /** The "New message" pill over the bottom of the list while scrolled up. */
  readonly pill?: ReactNode
  /** `JunoComposer`. */
  readonly composer: ReactNode
  /** `panel`: drawn on the Juno panel's own material, with no page colour. Default `page`. */
  readonly column?: 'page' | 'panel'
}

/**
 * The Juno chat as the Juno tab and the Juno panel show it: the header's
 * islands over the list, the pill over its bottom edge, the composer under
 * it. Neither the header nor the pill takes part in the list's layout.
 */
export function JunoChatFrame({ header, children, pill, composer, column = 'page' }: JunoChatFrameProps) {
  return (
    <div data-juno-chat="" {...stylex.props(styles.root, column === 'panel' && styles.panel)}>
      <div data-juno-chat-middle="" {...stylex.props(styles.middle)}>
        {header}
        {children}
        {pill !== undefined ? <div {...stylex.props(styles.pill)}>{pill}</div> : null}
      </div>
      {composer}
    </div>
  )
}

/** The flash's hold and fade in milliseconds, read once. */
let flashMs: { readonly hold: number; readonly fade: number } | undefined
function flashTiming(): { readonly hold: number; readonly fade: number } {
  flashMs ??= { hold: rootDuration('--flash-hold'), fade: rootDuration('--duration-flash-fade') }
  return flashMs
}

/** Flashes a row Juno jumped to (a topic message, a citation, a reply's quote) with the soft accent: it holds, then fades. */
export function flashChatRow(row: Element): void {
  const { hold, fade } = flashTiming()
  const total = hold + fade
  row.animate(
    [
      { backgroundColor: accent['--hl-soft'], offset: 0 },
      { backgroundColor: accent['--hl-soft'], offset: total === 0 ? 0 : hold / total, easing: 'ease-out' },
      { backgroundColor: 'transparent', offset: 1 },
    ],
    { duration: total },
  )
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
  // On the panel's own surface, with Juno's bubbles lifted off it.
  panel: {
    backgroundColor: 'transparent',
    '--juno-bubble-bg': colors['--panel-bubble'],
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
})
