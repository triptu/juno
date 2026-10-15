import * as stylex from '@stylexjs/stylex'
import { Hash } from '@phosphor-icons/react/dist/icons/Hash'
import { Lock } from '@phosphor-icons/react/dist/icons/Lock'
import type { MentionChannel, MentionPerson } from '@juno/contract'
import { layout, sizes, spacing, z } from '@juno/tokens/tokens.stylex'
import { Avatar, Icon, OptionGroupLabel, OptionList, OptionRow, Surface } from '@juno/ui'
import { hueFor, initials } from './look'

// StyleX reads only static values, so the anchor names are written here as
// well: the composer's field box (`Composer`) and the "@" or "#" being typed
// (`Textarea`'s `TEXTAREA_ANCHOR`).
const COMPOSER_BOX_ANCHOR = '--composer-box'
const TEXTAREA_ANCHOR = '--textarea-anchor'

export type MentionSuggestionsProps =
  | {
      readonly kind: 'person'
      readonly rows: ReadonlyArray<MentionPerson>
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

/** The row id of a suggestion, for `activeId` and `aria-activedescendant`. */
export const mentionRowId = (listId: string, id: string) => `${listId}-${id}`

/**
 * The @ and # suggestions (inventory 7.1): a small list above the
 * composer, its rows' names lined up under the "@" or "#" being typed,
 * kept inside the composer's width. Focus stays in the field, which drives
 * the list with the arrow keys (`aria-activedescendant`); a press picks a
 * row without taking focus. People show their avatar and real name,
 * channels their kind.
 */
export function MentionSuggestions(props: MentionSuggestionsProps) {
  const { id, activeId, onActivate, onPick } = props
  return (
    <div data-mention-suggestions="" {...stylex.props(styles.panel, props.kind === 'person' ? styles.underPerson : styles.underChannel)}>
      <Surface kind="popover">
      <OptionList id={id} label={props.kind === 'person' ? 'People' : 'Channels'} {...(activeId === undefined ? {} : { activeId })}>
        <OptionGroupLabel>{props.kind === 'person' ? 'People' : 'Channels'}</OptionGroupLabel>
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
          : props.rows.map((channel) => {
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
        </OptionList>
      </Surface>
    </div>
  )
}

/** The channel icon's size. */
const CHANNEL_ICON = '15px'

const styles = stylex.create({
  // Above the field box with the usual 6px gap, never over the text. The
  // names line up under the "@"; the panel stays inside the box's width.
  panel: {
    position: 'absolute',
    zIndex: z['--z-mention'],
    width: layout['--menu-width-mention'],
    bottom: `anchor(${COMPOSER_BOX_ANCHOR} top)`,
    marginBottom: spacing['--space-1-5'],
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
