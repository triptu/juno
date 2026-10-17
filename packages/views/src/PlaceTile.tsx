import * as stylex from '@stylexjs/stylex'
import { sizes } from '@juno/tokens/tokens.stylex'
import { Avatar, GroupAvatar, TopicArt } from '@juno/ui'
import { hueFor, initials, stackPerson } from './look'
import type { PlaceTileModel } from './tileModel'

/**
 * A topic's tile on Home and its review sheets, as the sidebar's row draws
 * it (SPEC section 5, "Row anatomy"): a DM's Main is the person's photo, a
 * group DM's Main two members' photos in a pair, and every other topic its
 * art, 40px in the same 44px slot so the text lines up either way.
 */
export function PlaceTile({ tile }: { readonly tile: PlaceTileModel }) {
  const { person, members = [] } = tile
  if (person !== undefined) return <Avatar label={initials(person.name)} size={44} hue={hueFor(person.color, person.id)} {...(person.avatarUrl === undefined ? {} : { src: person.avatarLargeUrl || person.avatarUrl })} />
  if (members.length >= 2) return <GroupAvatar people={members.map((member) => stackPerson(member, true))} size={44} />
  return (
    <span {...stylex.props(styles.slot)}>
      <TopicArt topicId={tile.topicId} {...(tile.art === undefined ? {} : { recipe: tile.art })} size={40} />
    </span>
  )
}

const styles = stylex.create({
  slot: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: sizes['--tile-44'],
    height: sizes['--tile-44'],
  },
})
