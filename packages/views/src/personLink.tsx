import * as stylex from '@stylexjs/stylex'
import { createContext, useContext, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { colors, radii, sizes } from '@juno/tokens/tokens.stylex'
import { focusRing, type ActivateEvent } from '@juno/ui'

/**
 * What a click on a person in a message does: the list's `onPerson`, given
 * once for all its rows, so a chip deep in a body needs no prop. Without it
 * people open nothing and look as plain text does.
 */
export const PersonLinks = createContext<((id: string, event: ActivateEvent) => void) | undefined>(undefined)

/** A press that moves this far before it lets go selects text instead of opening the person, px. */
const DRAG = 4

/** Where the last press on a person went down, to tell a click from a short drag that selects. */
let pressedAt = { x: 0, y: 0 }

interface PersonLinkProps {
  /** The person; undefined when Juno has nothing to open for them (an app with no DM), which draws `children` alone. */
  readonly id: string | undefined
  /** "Maya Chen", or "yourself": the tooltip says "Message Maya Chen". */
  readonly label: string
  /** The sender's name or avatar, or a chip. The avatar, which the name already covers, is no Tab stop. */
  readonly part: 'name' | 'avatar' | 'chip'
  /** The row's links' tabindex: a Tab stop only on the row Tab reaches. */
  readonly tabIndex?: 0 | -1
  readonly children: ReactNode
}

/**
 * A person in a message that opens your DM with them (SPEC 7, "People"): a
 * sender's name or avatar, or an @person chip. Unlike a row it opens on
 * click, not on mouse down, so a drag that starts on it still selects text;
 * a press that moved before it let go opens nothing. Enter and Space open it
 * from the keyboard, ⌘ with either for a background tab.
 */
export function PersonLink({ id, label, part, tabIndex = -1, children }: PersonLinkProps) {
  'use no memo'
  const onPerson = useContext(PersonLinks)
  if (onPerson === undefined || id === undefined) return children
  const open = (event: MouseEvent | KeyboardEvent, source: ActivateEvent['source']) => {
    event.stopPropagation()
    onPerson(id, { metaKey: event.metaKey, shiftKey: event.shiftKey, altKey: event.altKey, source })
  }
  return (
    <span
      role="button"
      tabIndex={part === 'avatar' ? undefined : tabIndex}
      aria-hidden={part === 'avatar' || undefined}
      data-tooltip={`Message ${label}`}
      data-opens-person=""
      onPointerDown={(event: PointerEvent) => {
        pressedAt = { x: event.clientX, y: event.clientY }
      }}
      onClick={(event) => {
        if (event.detail === 0) open(event, 'keyboard')
        else if (Math.hypot(event.clientX - pressedAt.x, event.clientY - pressedAt.y) < DRAG) open(event, 'pointer')
      }}
      onKeyDown={(event) => {
        if ((event.key !== 'Enter' && event.key !== ' ') || event.target !== event.currentTarget) return
        event.preventDefault()
        if (!event.repeat) open(event, 'keyboard')
      }}
      {...stylex.props(styles[part], part !== 'avatar' && styles.underline, part !== 'avatar' && focusRing.outside)}
    >
      {children}
    </span>
  )
}

const HOVER = '@media (hover: hover)'

const styles = stylex.create({
  // A quiet underline on hover, as a link in muted text has (`MessageLink` quiet).
  underline: {
    textDecorationLine: { default: 'none', ':hover': { default: null, [HOVER]: 'underline' } },
    textDecorationColor: colors['--link-underline'],
    textUnderlineOffset: sizes['--link-underline-offset'],
  },
  // Gives way in the header as the name does; the time never does.
  name: {
    flexShrink: 1,
    minWidth: 0,
    borderRadius: radii['--radius-xs'],
  },
  // A hairline ring on hover, as a reaction chip's border steps up.
  avatar: {
    display: 'inline-flex',
    borderRadius: radii['--radius-full'],
    outlineWidth: '1px',
    outlineStyle: { default: 'none', ':hover': { default: null, [HOVER]: 'solid' } },
    outlineColor: colors['--border-strongest'],
  },
  chip: {
    borderRadius: radii['--radius-tag'],
  },
})
