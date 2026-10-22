import { useState } from 'react'
import { defineFixtures, fixture } from '@juno/ui'
import { manyReactions } from './fixtures/reactions'
import { ReactionsDialog, type ReactionsDialogEntry, type ReactionsDialogProps } from './ReactionsDialog'

const entries: ReadonlyArray<ReactionsDialogEntry> = manyReactions.map(({ people, me: _me, ...rest }) => ({ ...rest, reactors: people }))
/** Slack listed ten of the forty; the rest are still being asked for, or Slack never gave them. */
const listedTen = entries.map((entry) => (entry.name === 'tada' ? { ...entry, reactors: entry.reactors.slice(0, 10) } : entry))

/** Choosing works in the gallery, so the strip and list can be tried by hand. */
function Dialog(props: Omit<ReactionsDialogProps, 'onSelect'>) {
  const [selected, setSelected] = useState(props.selected)
  return <ReactionsDialog {...props} selected={selected} onSelect={setSelected} />
}

const frame = { padded: true, surface: 'subtle' } as const

export default defineFixtures(Dialog, {
  Dialog: {
    // Twelve emoji, three of them the workspace's; forty people on the first.
    forty: fixture({ reactions: entries, selected: 'tada' }, frame),
    // Opened from a chip far along the strip: it scrolls to it.
    'custom-far': fixture({ reactions: entries, selected: 'this-is-fine' }, frame),
    'long-names': fixture({ reactions: entries, selected: 'heart' }, frame),
    // A message with two small reactions: the list is only as tall as they need.
    small: fixture({ reactions: entries.slice(9, 11), selected: 'this-is-fine' }, frame),
    'tab-focus': fixture({ reactions: entries, selected: '+1' }, { ...frame, focus: '[aria-selected="true"]' }),
    'tab-hover': fixture({ reactions: entries, selected: 'tada' }, { ...frame, hover: '[data-reaction-tab="heart"]' }),
  },
  Data: {
    // Juno is asking Slack for the thirty it did not list: their rows wait in place.
    loading: fixture({ reactions: listedTen, selected: 'tada', loading: true }, frame),
    // Slack never gave them: the list ends with the count.
    unlisted: fixture({ reactions: listedTen, selected: 'tada' }, frame),
  },
})
