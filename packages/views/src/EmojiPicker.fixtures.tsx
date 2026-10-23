import * as stylex from '@stylexjs/stylex'
import { sizes } from '@juno/tokens/tokens.stylex'
import { emojiCatalog, prepareEmojiPicker } from '@juno/contract'
import { useState } from 'react'
import { defineFixtures, fixture, scene, type FixtureFrame } from '@juno/ui'
import { EmojiPicker, type EmojiPickerProps } from './EmojiPicker'

const noop = () => {}

/** Small SVG drawings keep the fixture independent of a server and platform emoji fonts. */
const image = (drawing: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${drawing}</svg>`)}`

const custom = [
  { name: 'juno_wave', aliases: ['hello_juno'], url: image('<path d="M10 28 4 16q-2-5 2-5l5 7L7 5q0-5 4-2l5 12-2-12q1-5 4-1l3 13 1-10q3-4 4 1l-1 14 3-4q5-2 3 4l-6 10q-8 6-15-2" fill="#f4bc58" stroke="#a96728" stroke-width="1.5"/>') },
  { name: 'juno_shipit', url: image('<path d="m4 22 11-3 3-14q10-4 12-3 1 9-4 16L14 22l-6 7Z" fill="#7b8de0"/><path d="m12 23-6 2-3 7 8-4Z" fill="#ed9752"/><circle cx="24" cy="9" r="3" fill="#d4f3ff"/>') },
  { name: 'juno_coffee', url: image('<path d="M6 12h18v11q-8 10-18 0Z" fill="#c48e68"/><path d="M24 14q13 0 0 10M10 8q-4-3 0-6M18 8q-4-3 0-6" fill="none" stroke="#c48e68" stroke-width="3"/><path d="M4 29h24" stroke="#85583e" stroke-width="2"/>') },
  { name: 'juno_party', url: image('<path d="m4 29 7-21 14 14Z" fill="#b27bdb"/><path d="m7 20 10 5M10 13l12 9" stroke="#e6c4fa" stroke-width="3"/><path d="m21 2-2 7m11-1-6 4m5 6-5-1" stroke="#f0b642" stroke-width="3"/><circle cx="13" cy="3" r="2" fill="#6eb7ad"/>') },
  { name: 'juno_cat', url: image('<path d="M3 3 13 9h6L29 3l-2 16q-11 18-22 0Z" fill="#e6a258"/><path d="m6 7 5 5H6m20-5-5 5h5" fill="#dd827b"/><path d="M8 17h3m10 0h3m-9 5h3m-2 0v4" stroke="#614b43" stroke-width="2"/>') },
  { name: 'juno_heart', url: image('<path d="M16 29 3 16C-5 5 9-3 16 7 23-3 37 5 29 16Z" fill="#e66b86"/><path d="M5 11q0-5 5-5" fill="none" stroke="#ffbdc8" stroke-width="2"/>') },
  { name: 'juno_check', url: image('<circle cx="16" cy="16" r="15" fill="#69ad85"/><path d="m8 16 5 5L25 10" stroke="#f4fff6" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>') },
  { name: 'juno_juno', url: image('<circle cx="16" cy="16" r="14" fill="#96a5e4"/><path d="M10 10v9q0 7 8 6t7-8V9h-5v9q0 4-3 4t-3-4v-8Z" fill="#f5f1ff"/><circle cx="7" cy="6" r="3" fill="#e7ba66"/>') },
  { name: 'simple_smile', url: image('<circle cx="16" cy="16" r="14" fill="#f4bc58"/><circle cx="11" cy="13" r="2" fill="#2b1e00"/><circle cx="21" cy="13" r="2" fill="#2b1e00"/><path d="M10 20c3 4 9 4 12 0" stroke="#2b1e00" stroke-width="2" fill="none" stroke-linecap="round"/>') },
  { name: 'workspace_smile', url: image('<circle cx="16" cy="16" r="14" fill="#c86bd6"/><circle cx="11" cy="13" r="2" fill="#2b1e00"/><circle cx="21" cy="13" r="2" fill="#2b1e00"/><path d="M10 20c3 4 9 4 12 0" stroke="#2b1e00" stroke-width="2" fill="none" stroke-linecap="round"/>') },
]

const recent = ['+1', 'white_check_mark', 'eyes', 'tada', 'juno_wave', 'heart', 'joy', 'pray', 'rocket', 'fire', '100']

const picker = (overrides: Partial<EmojiPickerProps> = {}, frame?: FixtureFrame) =>
  fixture<EmojiPickerProps>({ data: prepareEmojiPicker(emojiCatalog, []), onPick: noop, onClose: noop, ...overrides }, frame)

export default defineFixtures(EmojiPicker, {
  Browse: {
    default: picker(),
    regression: scene(() => <RegressionPicker />),
    workspace: picker({ data: prepareEmojiPicker(emojiCatalog, custom) }),
    'workspace-2000': picker({ data: prepareEmojiPicker(emojiCatalog, Array.from({ length: 2000 }, (_, i) => ({ name: `workspace_${i}`, url: custom[i % custom.length]!.url }))) }),
    'recent-and-custom': picker({ recent, data: prepareEmojiPicker(emojiCatalog, custom) }),
    'hover-emoji': picker({ recent, data: prepareEmojiPicker(emojiCatalog, custom) }, { hover: 'button[data-emoji]' }),
  },
  Search: {
    matches: picker({ data: prepareEmojiPicker(emojiCatalog, custom), initialQuery: 'smile' }),
    alias: picker({ data: prepareEmojiPicker(emojiCatalog, custom), initialQuery: 'hello_juno' }),
    'no-match': picker({ data: prepareEmojiPicker(emojiCatalog, custom), initialQuery: 'zzqx' }),
  },
})

/** A person can pick and dismiss the fixture, so gallery checks exercise the callbacks. */
function RegressionPicker() {
  const [picked, setPicked] = useState('')
  const [glyph, setGlyph] = useState('')
  const [open, setOpen] = useState(true)
  return <>{open ? <EmojiPicker data={prepareEmojiPicker(emojiCatalog, [...custom, { name: 'thumbsup_parrot', url: custom[0]!.url }, { name: 'broken_image', url: '/broken-emoji.svg' }, { name: 'broken_neighbor', url: custom[1]!.url }, { name: '+1', unicode: '👍', aliases: ['approval'] }, { name: 'tada', url: custom[3]!.url }])} recent={['hello_juno', 'eyes']} selected={[{ name: 'hello_juno', url: custom[0]!.url }, { name: 'eyes' }, { name: 'tada' }]} onPick={(name, unicode) => { setPicked(name); setGlyph(unicode ?? '') }} onClose={() => setOpen(false)} /> : null}<output aria-label="Picked emoji" {...stylex.props(styles.feedback)}>{picked}</output><output aria-label="Picked glyph" {...stylex.props(styles.feedback)}>{glyph}</output></>
}

const styles = stylex.create({
  // Accessible callback feedback for the tests, outside the picker’s layout.
  feedback: { position: 'absolute', insetBlockStart: 0, insetInlineStart: 0, width: sizes['--icon-16'], height: sizes['--icon-16'], overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap' },
})
