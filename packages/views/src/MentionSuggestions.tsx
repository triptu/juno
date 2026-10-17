import * as stylex from '@stylexjs/stylex'
import { Hash } from '@phosphor-icons/react/dist/icons/Hash'
import { Lock } from '@phosphor-icons/react/dist/icons/Lock'
import { UsersThree } from '@phosphor-icons/react/dist/icons/UsersThree'
import type { MentionChannel, MentionGroup, MentionPerson } from '@juno/contract'
import { colors, layout, radii, sizes, spacing, z } from '@juno/tokens/tokens.stylex'
import { Avatar, Icon, Text, OptionGroupLabel, OptionList, OptionRow, Surface } from '@juno/ui'
import { hueFor, initials } from './look'
import { mentionRowId } from './mentionRowId'

// StyleX reads only static values, so the anchor names are written here as
// well: the composer's field box (`Composer`) and the "@" or "#" being typed
// (`Textarea`'s `TEXTAREA_ANCHOR`).
const COMPOSER_BOX_ANCHOR = '--composer-box'
const TEXTAREA_ANCHOR = '--textarea-anchor'

export interface EmojiSuggestion {
  readonly id: string
  readonly name: string
  readonly insert: string
  readonly url?: string
}

export type MentionSuggestionsProps =
  | {
      readonly kind: 'emoji'
      readonly rows: ReadonlyArray<EmojiSuggestion>
      readonly id: string
      readonly activeId: string | undefined
      readonly onActivate: (rowId: string) => void
      readonly onPick: (rowId: string) => void
    }
  | {
      readonly kind: 'person'
      readonly rows: ReadonlyArray<MentionPerson>
      /** User groups, after the people under their own label. */
      readonly groups?: ReadonlyArray<MentionGroup>
      readonly id: string
      readonly activeId: string | undefined
      readonly onActivate: (rowId: string) => void
      readonly onPick: (rowId: string) => void
    }
  | {
      readonly kind: 'channel'
      readonly rows: ReadonlyArray<MentionChannel>
      readonly id: string
      readonly activeId: string | undefined
      readonly onActivate: (rowId: string) => void
      readonly onPick: (rowId: string) => void
    }

/**
 * The @ and # suggestions (inventory 7.1): a small list above the
 * composer, its rows' names lined up under the "@" or "#" being typed,
 * kept inside the composer's width. Focus stays in the field, which drives
 * the list with the arrow keys (`aria-activedescendant`); a press picks a
 * row without taking focus. People show their avatar and real name, user
 * groups (after the people, under "Groups") their handle and name in a
 * round tile the avatar's size, channels their kind.
 */
export function MentionSuggestions(props: MentionSuggestionsProps) {
  const { id, activeId, onActivate, onPick } = props
  const groups = props.kind === 'person' ? (props.groups ?? []) : []
  const label = props.kind === 'person' ? (groups.length === 0 ? 'People' : props.rows.length === 0 ? 'Groups' : 'People and groups') : props.kind === 'emoji' ? 'Emoji' : 'Channels'
  return (
    <div data-mention-suggestions="" {...stylex.props(styles.panel, props.kind === 'channel' ? styles.underChannel : styles.underPerson)}>
      <Surface kind="popover">
      <OptionList id={id} label={label} {...(activeId === undefined ? {} : { activeId })}>
        {props.kind === 'person' && props.rows.length === 0 ? null : <OptionGroupLabel>{props.kind === 'person' ? 'People' : props.kind === 'emoji' ? 'Emoji' : 'Channels'}</OptionGroupLabel>}
        {props.kind === 'person'
          ? props.rows.map((person) => {
              const rowId = mentionRowId(id, person.id)
              return (
                <OptionRow
                  key={person.id}
                  id={rowId}
                  size={32}
                  active={rowId === activeId}
                  leading={<Avatar size={20} label={initials(person.realName ?? person.name)} name={person.name} hue={hueFor(person.color, person.id)} {...(person.avatarUrl === undefined ? {} : { src: person.avatarUrl })} />}
                  label={person.name}
                  {...(person.realName === undefined ? {} : { sub: person.realName })}
                  onSelect={() => onPick(rowId)}
                  onActivate={() => onActivate(rowId)}
                />
              )
            })
          : props.kind === 'emoji' ? props.rows.map((emoji) => {
              const rowId = mentionRowId(id, emoji.id)
              return <OptionRow key={emoji.id} id={rowId} size={32} active={rowId === activeId}
                leading={emoji.url === undefined ? <Text aria-hidden>{emoji.insert}</Text> : <img src={emoji.url} alt="" {...stylex.props(styles.emoji)} />}
                label={`:${emoji.name}:`} onSelect={() => onPick(rowId)} onActivate={() => onActivate(rowId)} />
            }) : props.rows.map((channel) => {
              const rowId = mentionRowId(id, channel.id)
              return (
                <OptionRow
                  key={channel.id}
                  id={rowId}
                  size={32}
                  active={rowId === activeId}
                  leading={<Icon icon={channel.kind === 'private' ? Lock : Hash} size={15} />}
                  label={channel.name}
                  sub={channel.kind === 'private' ? 'Private channel' : 'Public channel'}
                  onSelect={() => onPick(rowId)}
                  onActivate={() => onActivate(rowId)}
                />
              )
            })}
        {groups.length === 0 ? null : <OptionGroupLabel>Groups</OptionGroupLabel>}
        {groups.map((group) => {
          const rowId = mentionRowId(id, group.id)
          return (
            <OptionRow
              key={group.id}
              id={rowId}
              size={32}
              active={rowId === activeId}
              leading={<span aria-hidden {...stylex.props(styles.groupTile)}><Icon icon={UsersThree} size={13} /></span>}
              label={`@${group.handle}`}
              {...(group.name === undefined ? {} : { sub: group.name })}
              onSelect={() => onPick(rowId)}
              onActivate={() => onActivate(rowId)}
            />
          )
        })}
        </OptionList>
      </Surface>
    </div>
  )
}

/** The channel icon's size. */
const CHANNEL_ICON = '15px' // tokens-allow: the channel icon's size

const styles = stylex.create({
  emoji: { width: sizes['--avatar-20'], height: sizes['--avatar-20'], objectFit: 'contain' },
  // A group's tile: an avatar's size and shape, so its handle lines up with the people's names.
  groupTile: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: sizes['--avatar-20'],
    height: sizes['--avatar-20'],
    borderRadius: radii['--radius-full'],
    backgroundColor: colors['--secondary-default'],
    color: colors['--foreground-muted'],
  },
  // Above the field box with the usual 6px gap, never over the text. The
  // names line up under the "@"; the panel stays inside the box's width.
  panel: {
    position: 'absolute',
    zIndex: z['--z-mention'],
    width: layout['--menu-width-mention'],
    bottom: `anchor(${COMPOSER_BOX_ANCHOR} top)`,
    marginBottom: spacing['--space-1-5'],
    // In a short window the list can rise over a title bar's drag strip.
    WebkitAppRegion: 'no-drag',
  },
  // The left edge that puts a row's name under the "@" or "#": the panel's
  // and the row's insets, the avatar or icon, and the gap.
  underPerson: {
    left: `clamp(anchor(${COMPOSER_BOX_ANCHOR} left), calc(anchor(${TEXTAREA_ANCHOR} left) - ${spacing['--space-1-5']} - ${spacing['--space-2']} - ${sizes['--avatar-20']} - ${spacing['--space-2-5']}), calc(anchor(${COMPOSER_BOX_ANCHOR} right) - ${layout['--menu-width-mention']}))`,
  },
  underChannel: {
    left: `clamp(anchor(${COMPOSER_BOX_ANCHOR} left), calc(anchor(${TEXTAREA_ANCHOR} left) - ${spacing['--space-1-5']} - ${spacing['--space-2']} - ${CHANNEL_ICON} - ${spacing['--space-2-5']}), calc(anchor(${COMPOSER_BOX_ANCHOR} right) - ${layout['--menu-width-mention']}))`,
  },
})
