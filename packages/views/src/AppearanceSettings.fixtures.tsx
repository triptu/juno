import { defineFixtures, scene } from '@juno/ui'
import { GalleryAppearanceSettings } from './fixtures/appearance'

const noop = () => {}

// The selected theme and accent are the gallery's own (its theme and accent
// switchers, and the shots in both themes), so the checked segment and swatch
// always match the colours the frame is drawn in.
export default defineFixtures(GalleryAppearanceSettings, {
  Titles: {
    'one-line': scene(() => <GalleryAppearanceSettings theme="system" density="compact" topicTitleLines="one" onTopicTitleLinesChange={noop} onThemeChange={noop} onAccentChange={noop} onDensityChange={noop} />),
    'two-lines': scene(() => <GalleryAppearanceSettings theme="system" density="compact" topicTitleLines="two" onTopicTitleLinesChange={noop} onThemeChange={noop} onAccentChange={noop} onDensityChange={noop} />),
  },
  Look: {
    current: scene(() => <GalleryAppearanceSettings onThemeChange={noop} onAccentChange={noop} />),
  },
  System: {
    'system-density': scene(() => <GalleryAppearanceSettings theme="system" density="compact" onThemeChange={noop} onAccentChange={noop} onDensityChange={noop} />),
    // Comfortable picked, drawn in Comfortable.
    'comfortable-density': scene(() => <GalleryAppearanceSettings theme="system" density="comfortable" onThemeChange={noop} onAccentChange={noop} onDensityChange={noop} />, { density: 'comfortable' }),
  },
  Layout: {
    stacked: scene(() => <GalleryAppearanceSettings layout="stack" onThemeChange={noop} onAccentChange={noop} />, { width: 300 }),
    bar: scene(() => <GalleryAppearanceSettings layout="bar" onThemeChange={noop} onAccentChange={noop} />, { width: 520 }),
  },
  Interaction: {
    'hover-swatch': scene(() => <GalleryAppearanceSettings onThemeChange={noop} onAccentChange={noop} />, { hover: '[role="group"] button:nth-of-type(4)' }),
    'focus-swatch': scene(() => <GalleryAppearanceSettings onThemeChange={noop} onAccentChange={noop} />, { focus: '[role="group"] button:nth-of-type(4)' }),
  },
})
