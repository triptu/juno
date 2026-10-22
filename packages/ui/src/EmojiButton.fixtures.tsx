import * as stylex from '@stylexjs/stylex'
import { spacing } from '@juno/tokens/tokens.stylex'
import { defineFixtures, fixture, scene } from './fixtures/define'
import { EmojiButton } from './EmojiButton'
import { Surface } from './Surface'

const custom = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="#E39A3B"/><circle cx="11" cy="13" r="2" fill="#2B1E00"/><circle cx="21" cy="13" r="2" fill="#2B1E00"/><path d="M10 20c3 4 9 4 12 0" stroke="#2B1E00" stroke-width="2" fill="none" stroke-linecap="round"/></svg>',
)}`

export default defineFixtures(EmojiButton, {
  Emoji: {
    'thumbs-up': fixture({ emoji: '👍', label: 'React 👍' }),
    check: fixture({ emoji: '✅', label: 'React ✅' }),
    eyes: fixture({ emoji: '👀', label: 'React 👀' }),
    custom: fixture({ emoji: ':party-blob:', src: custom, label: 'React :party-blob:' }),
  },
  Interaction: {
    hover: fixture({ emoji: '👍', label: 'React 👍' }, { hover: 'button' }),
    press: fixture({ emoji: '👍', label: 'React 👍' }, { press: 'button' }),
    focus: fixture({ emoji: '👍', label: 'React 👍' }, { focus: 'button' }),
  },
  Overview: {
    'in-a-toolbar': scene(() => (
      <Surface kind="toolbar" padding="none" radius="pill" sx={styles.toolbar}>
        <EmojiButton emoji="👍" label="React 👍" />
        <EmojiButton emoji="✅" label="React ✅" />
        <EmojiButton emoji="👀" label="React 👀" />
      </Surface>
    )),
  },
})

const styles = stylex.create({
  toolbar: {
    display: 'inline-flex',
    padding: spacing['--space-pixel'],
  },
})
