import { emojiCatalog } from '@juno/contract'
import { defineFixtures, fixture, type FixtureFrame } from '@juno/ui'
import { EmojiPicker, type EmojiPickerProps } from './EmojiPicker'

const noop = () => {}

/** A round face in one colour, as a small SVG, like the custom reaction fixtures. */
const blob = (fill: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="${fill}"/><circle cx="11" cy="13" r="2" fill="#2B1E00"/><circle cx="21" cy="13" r="2" fill="#2B1E00"/><path d="M10 20c3 4 9 4 12 0" stroke="#2B1E00" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`,
  )}`

const custom = [
  { name: 'party-blob', url: blob('#E39A3B') },
  { name: 'blob-wave', url: blob('#6BAF5F') },
  { name: 'blob-thinking', url: blob('#5B8DD6') },
  { name: 'ship-it', url: blob('#C86BD6') },
]

const recent = ['+1', 'white_check_mark', 'eyes', 'tada', 'party-blob', 'heart', 'joy', 'pray', 'rocket', 'fire', '100']

const picker = (overrides: Partial<EmojiPickerProps> = {}, frame?: FixtureFrame) =>
  fixture<EmojiPickerProps>({ catalog: emojiCatalog, onPick: noop, onClose: noop, ...overrides }, frame)

export default defineFixtures(EmojiPicker, {
  Browse: {
    default: picker(),
    'recent-and-custom': picker({ recent, custom }),
    'hover-emoji': picker({ recent, custom }, { hover: 'button[data-emoji]' }),
  },
  Search: {
    matches: picker({ custom, initialQuery: 'party' }),
    'no-match': picker({ custom, initialQuery: 'zzqx' }),
  },
})
