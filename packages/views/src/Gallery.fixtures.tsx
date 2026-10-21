import { defineFixtures, scene, type FixtureFrame } from '@juno/ui'
import { pictureCards, pictureSources } from './fixtures/pictures'
import { thoughts } from './fixtures/thoughts'
import { Gallery, type GalleryProps } from './Gallery'

const noop = () => {}

const base: GalleryProps = { pictures: pictureCards, thoughts, sources: pictureSources, current: 'monet-impression-sunrise', filter: 'all', onFilter: noop, onOpen: noop, onNear: noop }
const page = (props: Partial<GalleryProps> = {}, frame: FixtureFrame = { width: 1200, height: 760 }) =>
  scene<GalleryProps>(() => <Gallery {...base} {...props} />, { ...frame, padded: false })

/** Only some files on this Mac: the others keep their boxes in the secondary fill. */
const someSources = Object.fromEntries(Object.entries(pictureSources).filter((_, at) => at % 3 !== 1))

export default defineFixtures(Gallery, {
  // Every picture in sections by kind, in rows of one height (SPEC 12, "Pictures and the gallery").
  Wall: {
    all: page(),
    space: page({ filter: 'space' }),
    'files-landing': page({ sources: someSources }),
    'no-files': page({ sources: {} }),
  },
  // The words (SPEC 12): quotes with who said them, and facts, in sections by theme.
  Words: {
    quotes: page({ filter: 'quotes' }),
    facts: page({ filter: 'facts' }),
    'quotes-wide': page({ filter: 'quotes' }, { width: 1600, height: 900 }),
    'facts-wide': page({ filter: 'facts' }, { width: 1920, height: 900 }),
    'quotes-narrow': page({ filter: 'quotes' }, { width: 640, height: 760 }),
    'facts-minimum-window': page({ filter: 'facts' }, { width: 336, height: 436 }),
  },
  Size: {
    narrow: page({}, { width: 640, height: 760 }),
    'minimum-window': page({}, { width: 336, height: 436 }),
  },
  Interaction: {
    'hover-picture': page({}, { width: 1200, height: 760, hover: '[data-gallery-picture="vermeer-milkmaid"] button' }),
    'focus-picture': page({}, { width: 1200, height: 760, focus: '[data-gallery-picture="vermeer-milkmaid"] button' }),
  },
})
