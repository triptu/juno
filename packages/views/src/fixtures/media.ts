/**
 * A message's several pictures, for its grid (MessageList, Media) and the
 * media viewer's filmstrip. Split from `messages.ts`.
 */
import type { FileView } from '@juno/contract'
import { downloadable, downloadUrl, image, picture, window } from './messages'
import { people } from './topics'

/** Six pictures of different shapes, Slack's copies with full images: a message's grid and the viewer's filmstrip. */
export const album: ReadonlyArray<FileView> = [
  { ...image('F0AL1', 'rack-front.png', 1600, 1000, picture(1600, 1000, '#8EB5C9')), full: picture(1600, 1000, '#8EB5C9'), download: downloadUrl('F0AL1') },
  { ...image('F0AL2', 'rack-back.jpg', 900, 1400, picture(900, 1400, '#C9A98E')), full: picture(900, 1400, '#C9A98E'), download: downloadUrl('F0AL2') },
  { ...image('F0AL3', 'cable-map.png', 1200, 1200, picture(1200, 1200, '#A7B8A0')), full: picture(1200, 1200, '#A7B8A0'), download: downloadUrl('F0AL3') },
  { ...image('F0AL4', 'patch-panel.png', 2000, 900, picture(2000, 900, '#D9C7E8')), full: picture(2000, 900, '#D9C7E8'), download: downloadUrl('F0AL4') },
  { ...image('F0AL5', 'label-maker.jpg', 1000, 1300, picture(1000, 1300, '#E8D9C7')), full: picture(1000, 1300, '#E8D9C7'), download: downloadUrl('F0AL5') },
  { ...image('F0AL6', 'floor-plan.png', 1500, 1000, picture(1500, 1000, '#B9C7D9')), full: picture(1500, 1000, '#B9C7D9'), download: downloadUrl('F0AL6') },
]

/** A message with the first `count` pictures of the album. */
export const albumOf = (count: number) => window([{ ago: 20, from: people.priya, text: 'Photos from the rack move.', files: album.slice(0, count) }])

/** Pictures and a PDF: the pictures make the grid, the PDF keeps its card. */
export const mediaAndPdf = window([{ ago: 20, from: people.priya, text: 'Photos and the cabling plan.', files: [album[0]!, downloadable.pdf, album[1]!, album[2]!] }])
