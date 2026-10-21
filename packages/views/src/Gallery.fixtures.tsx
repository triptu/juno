import { defineFixtures, scene, type FixtureFrame } from '@juno/ui'
import { pictureCards, pictureSources } from './fixtures/pictures'
import { Gallery, type GalleryProps } from './Gallery'

const noop = () => {}

const base: GalleryProps = { pictures: pictureCards, sources: pictureSources, current: 'monet-impression-sunrise', filter: 'all', onFilter: noop, order: 'kind', onOrder: noop, onOpen: noop, onNear: noop }
const page = (props: Partial<GalleryProps> = {}, frame: FixtureFrame = { width: 1200, height: 760 }) =>
  scene<GalleryProps>(() => <Gallery {...base} {...props} />, { ...frame, padded: false })

/** Early pictures with long titles and long, loose dates, as the oldest catalog entries have. */
const longTimeline: GalleryProps['pictures'] = [
  { ...pictureCards[2]!, id: 'fixture-scroll', title: 'Riverbank with a Long Title That Wraps', artist: 'A Painter of the Southern Tang', date: 'second half 9th–mid-10th century', year: 870, ratio: 0.52 },
  { ...pictureCards[7]!, id: 'fixture-hanging', title: 'Summer Mountains', artist: 'Attributed to a Court Painter', date: 'Southern Tang dynasty (937–76)', year: 937, ratio: 0.45 },
  ...pictureCards,
]

/** Only some files on this Mac: the others keep their boxes in the secondary fill. */
const someSources = Object.fromEntries(Object.entries(pictureSources).filter((_, at) => at % 3 !== 1))

export default defineFixtures(Gallery, {
  // By kind: sections by kind, in columns, each picture with its label and its line (SPEC 12, "Pictures and the gallery").
  Wall: {
    all: page(),
    space: page({ filter: 'space' }),
    objects: page({ filter: 'objects' }),
    'files-landing': page({ sources: someSources }),
    'no-files': page({ sources: {} }),
  },
  // By time: sections by period (centuries, millennia BCE, before 10,000 BCE), oldest first, in rows with the date under each picture.
  Time: {
    all: page({ order: 'time' }),
    paintings: page({ order: 'time', filter: 'painting' }),
    'no-files': page({ order: 'time', sources: {} }),
    // Long titles wrap to two lines and long dates end in an ellipsis; a tall picture's tile is as wide as a caption.
    'long-titles': page({ order: 'time', pictures: longTimeline }),
    wide: page({ order: 'time' }, { width: 1920, height: 900 }),
  },
  Size: {
    narrow: page({}, { width: 640, height: 760 }),
    wide: page({}, { width: 1600, height: 900 }),
    'widest': page({}, { width: 1920, height: 900 }),
    'minimum-window': page({}, { width: 336, height: 436 }),
    'time-minimum-window': page({ order: 'time' }, { width: 336, height: 436 }),
  },
  Interaction: {
    'hover-picture': page({}, { width: 1200, height: 760, hover: '[data-gallery-picture="vermeer-milkmaid"] button' }),
    'focus-picture': page({}, { width: 1200, height: 760, focus: '[data-gallery-picture="vermeer-milkmaid"] button' }),
  },
})
