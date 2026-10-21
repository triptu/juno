import { defineFixtures, scene, type FixtureFrame } from '@juno/ui'
import { pictureStory, spaceStory, spaceSource, storySource } from './fixtures/pictures'
import { PicturePage, type PicturePageProps } from './PicturePage'

const noop = () => {}

const base: PicturePageProps = { picture: pictureStory, src: storySource, onAllPictures: noop, onStep: noop, onOpenLink: noop }
const page = (props: Partial<PicturePageProps> = {}, frame: FixtureFrame = { width: 1200, height: 760 }) =>
  scene<PicturePageProps>(() => <PicturePage {...base} {...props} />, { ...frame, padded: false })

export default defineFixtures(PicturePage, {
  // The picture as large as the page allows, its label beside it (SPEC 12, "Pictures and the gallery").
  Story: {
    painting: page(),
    space: page({ picture: spaceStory, src: spaceSource }),
    // A tall picture fits the page's height; the label keeps its width.
    tall: page({ picture: { ...pictureStory, ratio: 0.65 } }),
    // Before the file is on this Mac: the box at the picture's shape, in the secondary fill.
    'no-file': page({ src: undefined }),
  },
  Size: {
    // Under 900px the label goes under the picture and the page scrolls.
    narrow: page({}, { width: 640, height: 760 }),
    'minimum-window': page({}, { width: 336, height: 436 }),
  },
  Interaction: {
    'hover-next': page({}, { width: 1200, height: 760, hover: 'button[aria-label="Next picture"]' }),
    'focus-all-pictures': page({}, { width: 1200, height: 760, focus: 'button:has(svg)' }),
  },
})
