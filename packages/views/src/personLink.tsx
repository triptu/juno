import * as stylex from '@stylexjs/stylex'
import { createContext, useContext, type ReactNode } from 'react'
import { colors, radii, sizes } from '@juno/tokens/tokens.stylex'
import type { BodyInline } from '@juno/contract'
import { Chip, focusRing, type HueName } from '@juno/ui'

/**
 * What a person in a message opens: `MessageList`'s `onPerson`. Elsewhere,
 * as in the Forward sheet, people look as plain text does.
 */
export const PersonLinks = createContext<((id: string, behind: boolean) => void) | undefined>(undefined)

/** Whether the last press on a message list moved far enough to be a drag selection (`MessageList` tracks it). */
export const press = { dragged: false }

interface PersonLinkProps {
  /** The person; undefined when Juno has nothing to open for them (an app with no DM). */
  readonly id: string | undefined
  /** "Maya Chen", or "yourself": the tooltip says "Message Maya Chen". None where the person has a tooltip of their own (@you). */
  readonly label?: string | undefined
  /** The sender's name or avatar, or a chip. The avatar, which the name already covers, is no Tab stop. */
  readonly part: 'name' | 'avatar' | 'chip'
  /** The row's links' tabindex: a Tab stop only on the row Tab reaches. */
  readonly tabIndex?: 0 | -1
  readonly children: ReactNode
}

/**
 * A person in a message that opens your DM with them (SPEC 7, "People"): a
 * sender's name or avatar, or an @person chip. On one click, not at the end
 * of a drag (also one that came back) or on a double-click; on Enter or
 * Space from the keyboard; ⌘ opens it behind the current tab.
 */
export function PersonLink({ id, label, part, tabIndex = -1, children }: PersonLinkProps) {
  'use no memo'
  const open = useContext(PersonLinks)
  if (open === undefined || id === undefined) return children
  return (
    <span
      // The name is the button for assistive tech and the keyboard; the avatar is the same target for the pointer only.
      {...(part === 'avatar' ? {} : { role: 'button', tabIndex })}
      data-tooltip={label && `Message ${label}`}
      // The avatar's tooltip adds the person's status under the name (SPEC 7, "People").
      {...(part === 'avatar' ? { 'data-tooltip-person': id } : {})}
      data-opens-person=""
      onClick={(event) => event.detail === 1 && !press.dragged && open(id, event.metaKey)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        if (!event.repeat) open(id, event.metaKey)
      }}
      {...stylex.props(styles[part], part !== 'avatar' && styles.underline, part !== 'avatar' && focusRing.outside)}
    >
      {children}
    </span>
  )
}

/**
 * An @person chip, which opens your DM with them, yours for "@you", as a
 * click on a sender does. Its text sits in <bdi> so "@Name" keeps its own
 * direction inside a right-to-left paragraph.
 */
export function PersonChip({ inline, hue, tabIndex }: { readonly inline: Extract<BodyInline, { kind: 'user' }>; readonly hue: HueName; readonly tabIndex: 0 | -1 }) {
  'use no memo'
  const own = inline.isMe
  return (
    <PersonLink id={inline.unreachable === true ? undefined : inline.id} label={own ? undefined : inline.name} part="chip" tabIndex={tabIndex}>
      <Chip variant={own ? 'mention' : 'person'} size="inline" {...(own ? { title: 'Mentions you' } : { hue, 'data-person': inline.id, 'data-person-name': inline.name })}>
        <bdi>@{inline.name}</bdi>
      </Chip>
    </PersonLink>
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
