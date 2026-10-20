/**
 * One ⌘K row (inventory 9): its glyph (an icon, a DM's avatar or an
 * accent's dot), label, sub line, badge and key hint.
 */
import { Broom } from '@phosphor-icons/react/dist/icons/Broom'
import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { ArrowCounterClockwise } from '@phosphor-icons/react/dist/icons/ArrowCounterClockwise'
import { ArrowSquareOut } from '@phosphor-icons/react/dist/icons/ArrowSquareOut'
import { Bell } from '@phosphor-icons/react/dist/icons/Bell'
import { ChatCircle } from '@phosphor-icons/react/dist/icons/ChatCircle'
import { ChatsCircle } from '@phosphor-icons/react/dist/icons/ChatsCircle'
import { ChatText } from '@phosphor-icons/react/dist/icons/ChatText'
import { CheckCircle } from '@phosphor-icons/react/dist/icons/CheckCircle'
import { CircleHalf } from '@phosphor-icons/react/dist/icons/CircleHalf'
import { Compass } from '@phosphor-icons/react/dist/icons/Compass'
import { EnvelopeSimple } from '@phosphor-icons/react/dist/icons/EnvelopeSimple'
import { Eye } from '@phosphor-icons/react/dist/icons/Eye'
import { EyeSlash } from '@phosphor-icons/react/dist/icons/EyeSlash'
import { FunnelSimple } from '@phosphor-icons/react/dist/icons/FunnelSimple'
import { Gear } from '@phosphor-icons/react/dist/icons/Gear'
import { HardDrives } from '@phosphor-icons/react/dist/icons/HardDrives'
import { Headphones } from '@phosphor-icons/react/dist/icons/Headphones'
import { Hash } from '@phosphor-icons/react/dist/icons/Hash'
import { House } from '@phosphor-icons/react/dist/icons/House'
import { Info } from '@phosphor-icons/react/dist/icons/Info'
import { Pulse } from '@phosphor-icons/react/dist/icons/Pulse'
import { LinkSimple } from '@phosphor-icons/react/dist/icons/LinkSimple'
import { ImageSquare } from '@phosphor-icons/react/dist/icons/ImageSquare'
import { ListBullets } from '@phosphor-icons/react/dist/icons/ListBullets'
import { Lock } from '@phosphor-icons/react/dist/icons/Lock'
import { MonitorArrowUp } from '@phosphor-icons/react/dist/icons/MonitorArrowUp'
import { Microphone } from '@phosphor-icons/react/dist/icons/Microphone'
import { MicrophoneSlash } from '@phosphor-icons/react/dist/icons/MicrophoneSlash'
import { Moon } from '@phosphor-icons/react/dist/icons/Moon'
import { NotePencil } from '@phosphor-icons/react/dist/icons/NotePencil'
import { Palette } from '@phosphor-icons/react/dist/icons/Palette'
import { PaperPlaneTilt } from '@phosphor-icons/react/dist/icons/PaperPlaneTilt'
import { PencilSimple } from '@phosphor-icons/react/dist/icons/PencilSimple'
import { PhoneX } from '@phosphor-icons/react/dist/icons/PhoneX'
import { Plugs } from '@phosphor-icons/react/dist/icons/Plugs'
import { Plus } from '@phosphor-icons/react/dist/icons/Plus'
import { PushPin } from '@phosphor-icons/react/dist/icons/PushPin'
import { PushPinSlash } from '@phosphor-icons/react/dist/icons/PushPinSlash'
import { Sparkle } from '@phosphor-icons/react/dist/icons/Sparkle'
import { StopCircle } from '@phosphor-icons/react/dist/icons/StopCircle'
import { Sun } from '@phosphor-icons/react/dist/icons/Sun'
import { User } from '@phosphor-icons/react/dist/icons/User'
import { UserCircle } from '@phosphor-icons/react/dist/icons/UserCircle'
import { Users } from '@phosphor-icons/react/dist/icons/Users'
import type { Person } from '@juno/contract'
import { accentSwatches, colors, radii, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Avatar, Chip, Icon, Kbd, OptionRow, Text, type AccentName, type PhosphorIcon } from '@juno/ui'
import { Highlighted, type TextRanges } from './Highlighted'
import { hueFor, initials } from './look'
import { relativeTime } from './time'

/** What a row's icon shows. */
export type PaletteIconName =
  | 'thread'
  | 'public'
  | 'private'
  | 'dm'
  | 'group'
  | 'message'
  | 'scope'
  | 'person'
  | 'send'
  | 'open-dm'
  | 'ask'
  | 'resolve'
  | 'reopen'
  | 'theme-light'
  | 'theme-dark'
  | 'theme-system'
  | 'new-tab'
  | 'new-message'
  | 'settings'
  | 'hide-text'
  | 'show-text'
  | 'presence'
  | 'pin'
  | 'unpin'
  | 'unread'
  | 'juno'
  | 'link'
  | 'open-in-slack'
  | 'rename'
  | 'start-thread'
  | 'home'
  | 'all-topics'
  | 'gallery'
  | 'appearance'
  | 'notifications'
  | 'ignored'
  | 'tidy-up'
  | 'connections'
  | 'backup'
  | 'about'
  | 'ai-activity'
  | 'tour'
  | 'huddle'
  | 'mute'
  | 'unmute'
  | 'leave-huddle'
  | 'share-screen'
  | 'stop-sharing'

const icons: Record<PaletteIconName, PhosphorIcon> = {
  thread: ChatsCircle,
  public: Hash,
  private: Lock,
  dm: User,
  group: Users,
  message: ChatText,
  scope: FunnelSimple,
  person: User,
  send: PaperPlaneTilt,
  'open-dm': ChatCircle,
  ask: Sparkle,
  resolve: CheckCircle,
  reopen: ArrowCounterClockwise,
  'theme-light': Sun,
  'theme-dark': Moon,
  'theme-system': CircleHalf,
  'new-tab': Plus,
  'new-message': NotePencil,
  settings: Gear,
  'hide-text': EyeSlash,
  'show-text': Eye,
  presence: UserCircle,
  pin: PushPin,
  unpin: PushPinSlash,
  unread: EnvelopeSimple,
  juno: Sparkle,
  link: LinkSimple,
  'open-in-slack': ArrowSquareOut,
  rename: PencilSimple,
  'start-thread': ChatsCircle,
  home: House,
  'all-topics': ListBullets,
  gallery: ImageSquare,
  appearance: Palette,
  notifications: Bell,
  ignored: EyeSlash,
  'tidy-up': Broom,
  connections: Plugs,
  backup: HardDrives,
  about: Info,
  'ai-activity': Pulse,
  tour: Compass,
  huddle: Headphones,
  mute: MicrophoneSlash,
  unmute: Microphone,
  'leave-huddle': PhoneX,
  'share-screen': MonitorArrowUp,
  'stop-sharing': StopCircle,
}

export interface PaletteItem {
  readonly id: string
  readonly icon: PaletteIconName
  readonly label: string
  /** The parts of `label` the text matched, to show in semibold. */
  readonly labelHighlight?: TextRanges
  /** The plain part of the sub line: "#eng", "Public channel · Main". */
  readonly sub?: string
  /** Epoch milliseconds, shown after `sub` as "4m". */
  readonly at?: number
  /** A matched message, shown after `sub` as "Leo: text". Hidden in privacy mode. */
  readonly snippet?: { readonly sender: string; readonly text: string }
  /** A command's confidence, "95%". */
  readonly badge?: string
  /** The key hint on the active row: its keys, a space, then what they do ("↵ Send"). "⌘↵ New tab" by default when `opensTab`, else "↵". */
  readonly hint?: string
  /** ⌘Enter and ⌘-click open it in a new tab. */
  readonly opensTab?: boolean
  /** It has a context menu (a channel). */
  readonly menu?: boolean
  /** A DM: the person's avatar in place of the icon. */
  readonly person?: Person
  /** An accent command: a dot of that accent in place of the icon. */
  readonly accent?: AccentName
  /** One line, 36px: conversations and commands. `sub` sits at the row's end. */
  readonly compact?: boolean
}

export const rowDomId = (id: string) => `palette-${id}`

interface PaletteRowProps {
  readonly item: PaletteItem
  readonly active: boolean
  readonly now: number
  readonly onSelect: (newTab: boolean) => void
  readonly onActivate: () => void
  readonly onMenu?: (at: { readonly x: number; readonly y: number }) => void
}

export function PaletteRow({ item, active, now, onSelect, onActivate, onMenu }: PaletteRowProps) {
  const sub = subLine(item, now)
  const hint = <KeyHint item={item} />
  const compact = item.compact === true
  return (
    <OptionRow
      id={rowDomId(item.id)}
      size={compact ? 36 : 55}
      active={active}
      leading={
        <>
          <Glyph item={item} />
          {/* Laid over the row's end: moving the active row must not reflow any row's text. */}
          {active && item.badge === undefined ? (
            <span aria-hidden="true" {...stylex.props(styles.hintOver)}>
              {hint}
            </span>
          ) : null}
        </>
      }
      label={item.icon === 'public' && item.label.startsWith('#') ? item.label.slice(1) : <Highlighted text={item.label} ranges={item.labelHighlight} />}
      {...(sub === undefined ? {} : { sub, subPlacement: compact ? ('end' as const) : ('below' as const) })}
      trailing={
        // A command keeps its hint's place in flow, hidden while another row is active.
        item.badge === undefined ? undefined : (
          <>
            <Chip variant="filled" size={20} icon={Sparkle} iconSize={12} title="Juno's read of what you typed" numeric>
              {item.badge}
            </Chip>
            <span aria-hidden="true" {...stylex.props(!active && styles.hintHidden)}>
              {hint}
            </span>
          </>
        )
      }
      onSelect={(event) => onSelect(event.metaKey && item.opensTab === true)}
      onActivate={onActivate}
      {...(onMenu === undefined
        ? {}
        : {
            onContextMenu: (event) => {
              event.preventDefault()
              onMenu({ x: event.clientX, y: event.clientY })
            },
          })}
    />
  )
}


/** The sub line: `sub`, the time, and a matched message's sender and text. */
function subLine(item: PaletteItem, now: number): ReactNode {
  const time = item.at === undefined ? undefined : relativeTime(item.at, now)
  const plain = [item.sub, item.snippet === undefined ? time : undefined].filter((part) => part !== undefined && part !== '').join(' · ')
  if (item.snippet === undefined) return plain === '' ? undefined : plain
  return (
    <>
      {plain === '' ? null : `${plain} · `}
      <span dir="auto" data-sensitive="">
        {item.snippet.sender === '' ? null : (
          <>
            <bdi>{item.snippet.sender}</bdi>:{' '}
          </>
        )}
        {item.snippet.text}
      </span>
    </>
  )
}

/** One look for every hint: the keys as a keycap, then what they do. "↵ Send" is the key and its word. */
function KeyHint({ item }: { readonly item: PaletteItem }) {
  const [keys, ...words] = (item.hint ?? (item.opensTab === true ? '⌘↵ New tab' : '↵')).split(' ')
  return (
    <span {...stylex.props(styles.hintLine)}>
      <Kbd look="key">{keys}</Kbd>
      {words.length === 0 ? null : (
        <Text variant="tagSmall" tone="muted">
          {words.join(' ')}
        </Text>
      )}
    </span>
  )
}

/** A DM's avatar, an accent's dot, or the row's icon. */
function Glyph({ item }: { readonly item: PaletteItem }) {
  if (item.person !== undefined) {
    return <Avatar size={20} label={initials(item.person.name)} hue={hueFor(item.person.color, item.person.id)} {...(item.person.avatarUrl === undefined ? {} : { src: item.person.avatarUrl })} />
  }
  return (
    <span aria-hidden="true" {...stylex.props(styles.glyphSlot, item.compact === true && styles.glyphSlotCompact)}>
      {item.accent !== undefined ? <span {...stylex.props(styles.accentDot, accentDots[item.accent])} /> : <Icon icon={icons[item.icon]} size={16} />}
    </span>
  )
}

const styles = stylex.create({
  glyphSlot: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: sizes['--icon-16'],
    height: sizes['--icon-16'],
  },
  // One-line rows can hold a DM's 20px avatar, so every glyph there takes 20px and the names line up.
  glyphSlotCompact: {
    width: sizes['--icon-20'],
    height: sizes['--icon-20'],
  },
  accentDot: {
    width: sizes['--icon-12'],
    height: sizes['--icon-12'],
    borderRadius: radii['--radius-full'],
  },
  hintLine: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-1'],
  },
  hintHidden: {
    visibility: 'hidden',
  },
  // Over the end of the active row (its `contain` makes it the containing block), on its background, with a soft edge over any text it covers.
  hintOver: {
    position: 'absolute',
    insetInlineEnd: spacing['--space-2-5'],
    top: '50%',
    transform: 'translateY(-50%)',
    paddingInlineStart: spacing['--space-2'],
    backgroundColor: colors['--surface-hover'],
    boxShadow: `calc(-1 * ${spacing['--space-2']}) 0 ${spacing['--space-2']} ${colors['--surface-hover']}`,
  },
})

/** Each accent's swatch fill, for the accent commands' dot. */
const accentDots = stylex.create({
  coral: { backgroundColor: accentSwatches['--swatch-coral'] },
  ink: { backgroundColor: accentSwatches['--swatch-ink'] },
  marigold: { backgroundColor: accentSwatches['--swatch-marigold'] },
  teal: { backgroundColor: accentSwatches['--swatch-teal'] },
  midnight: { backgroundColor: accentSwatches['--swatch-midnight'] },
  emerald: { backgroundColor: accentSwatches['--swatch-emerald'] },
  claret: { backgroundColor: accentSwatches['--swatch-claret'] },
  cyan: { backgroundColor: accentSwatches['--swatch-cyan'] },
})
