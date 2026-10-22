import { defineFixtures, scene, type FixtureFrame } from '@juno/ui'
import { earthSource, earthStory, largeStory, pictureStory, plainStory, spaceStory, spaceSource, storySource } from './fixtures/pictures'
import { PicturePage, type PicturePageProps } from './PicturePage'

const noop = () => {}

const base: PicturePageProps = { picture: pictureStory, small: storySource, large: storySource, onAllPictures: noop, onStep: noop, onOpenLink: noop }
const page = (props: Partial<PicturePageProps> = {}, frame: FixtureFrame = { width: 1200, height: 760 }) =>
  scene<PicturePageProps>(() => <PicturePage {...base} {...props} />, { ...frame, padded: false })

export default defineFixtures(PicturePage, {
  // The picture as large as the page allows, its wall text beside it (SPEC 12, "Pictures and the gallery").
  Story: {
    // A quote with who said it and its context, the size beside a person, the link and the credit.
    painting: page(),
    // A fact for the line, and how far in light-years.
    space: page({ picture: spaceStory, small: spaceSource, large: spaceSource }),
    // A picture of Earth from far away: how far in kilometres, and how long light takes.
    earth: page({ picture: earthStory, small: earthSource, large: earthSource }),
    // A canvas taller than a person.
    'large-canvas': page({ picture: largeStory }),
    // No scale data: nothing is reserved for it.
    'no-scale': page({ picture: plainStory }),
    // A tall picture fits the page's height; the label keeps its width.
    tall: page({ picture: { ...pictureStory, ratio: 0.65 } }),
    // Before the file is on this Mac: the box at the picture's shape, in the secondary fill.
    'no-file': page({ small: undefined, large: undefined }),
  },
  Size: {
    // Under 900px the label goes under the picture and the page scrolls.
    narrow: page({}, { width: 640, height: 760 }),
    'minimum-window': page({}, { width: 336, height: 436 }),
  },
  Interaction: {
    'hover-next': page({}, { width: 1200, height: 760, hover: 'button[aria-label="Next picture"]' }),
    'hover-learn-more': page({}, { width: 1200, height: 760, hover: '[data-picture-learn-more]' }),
    'focus-learn-more': page({}, { width: 1200, height: 760, focus: '[data-picture-learn-more]' }),
    'focus-all-pictures': page({}, { width: 1200, height: 760, focus: 'button:has(svg)' }),
  },
})
