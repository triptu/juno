import type { PictureCardView } from '../PictureImage'
import type { PictureStoryView } from '../PicturePage'

/** A flat stand-in for a painting: two bands and a sun, at the picture's shape, so fixtures need no image files. */
const painting = (ratio: number, sky: string, ground: string, sun: string) => {
  const width = Math.round(120 * ratio)
  return `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 120" preserveAspectRatio="none"><rect width="${width}" height="120" fill="${sky}"/><rect y="74" width="${width}" height="46" fill="${ground}"/><circle cx="${Math.round(width * 0.66)}" cy="44" r="10" fill="${sun}"/></svg>`,
  )}`
}

/** A night sky: dark, with a few stars. */
const space = (ratio: number) => {
  const width = Math.round(120 * ratio)
  const stars = [0.12, 0.3, 0.47, 0.71, 0.86].map((x, at) => `<circle cx="${Math.round(width * x)}" cy="${18 + at * 19}" r="1.6" fill="#F4EEDC"/>`).join('')
  return `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 120" preserveAspectRatio="none"><rect width="${width}" height="120" fill="#141A2E"/><ellipse cx="${Math.round(width * 0.4)}" cy="70" rx="${Math.round(width * 0.3)}" ry="30" fill="#5B3B6E" opacity="0.7"/>${stars}</svg>`,
  )}`
}

export const pictureCards: ReadonlyArray<PictureCardView & { readonly src: string }> = [
  { id: 'monet-impression-sunrise', kind: 'painting', title: 'Impression, Sunrise', artist: 'Claude Monet', date: '1872', ratio: 1.29, src: painting(1.29, '#9DB3AC', '#5E7F84', '#E2643A') },
  { id: 'vermeer-milkmaid', kind: 'painting', title: 'The Milkmaid', artist: 'Johannes Vermeer', date: 'c. 1660', ratio: 0.89, src: painting(0.89, '#C9C0A4', '#3F5A8C', '#E8D27A') },
  { id: 'kota-radha-krishna', kind: 'painting', title: 'Radha and Krishna Walk in a Flowering Grove', artist: 'The Kota Master', date: 'c. 1720', ratio: 0.65, src: painting(0.65, '#3E6B45', '#B23A2C', '#F0C04A') },
  { id: 'turner-temeraire', kind: 'painting', title: 'The Fighting Temeraire', artist: 'J. M. W. Turner', date: '1839', ratio: 1.35, src: painting(1.35, '#D9B57A', '#6F7F8C', '#F2763A') },
  { id: 'van-gogh-irises', kind: 'painting', title: 'Irises', artist: 'Vincent van Gogh', date: '1889', ratio: 1.29, src: painting(1.29, '#7FA35A', '#3D4E9E', '#E8A33A') },
  { id: 'friedrich-wanderer', kind: 'painting', title: 'Wanderer above the Sea of Fog', artist: 'Caspar David Friedrich', date: 'c. 1817', ratio: 0.78, src: painting(0.78, '#B9C3C9', '#3B3935', '#E9E3D3') },
  { id: 'hokusai-great-wave', kind: 'print', title: 'Under the Wave off Kanagawa', artist: 'Katsushika Hokusai', date: 'c. 1830–32', ratio: 1.49, src: painting(1.49, '#E8DCC0', '#29497A', '#F4F1E8') },
  { id: 'hiroshige-sudden-shower', kind: 'print', title: 'Sudden Shower over Shin-Ōhashi Bridge and Atake', artist: 'Utagawa Hiroshige', date: '1857', ratio: 0.66, src: painting(0.66, '#5D6670', '#3E6E8C', '#C9C2A8') },
  { id: 'haeckel-discomedusae', kind: 'illustration', title: 'Discomedusae', artist: 'Ernst Haeckel', date: '1904', ratio: 0.7, src: painting(0.7, '#EFE8D6', '#C46A4A', '#3E6E8C') },
  { id: 'webb-cosmic-cliffs', kind: 'space', title: 'Cosmic Cliffs in the Carina Nebula', artist: 'James Webb Space Telescope', date: '2022', ratio: 1.73, src: space(1.73) },
  { id: 'apollo-8-earthrise', kind: 'space', title: 'Earthrise', artist: 'William Anders, Apollo 8', date: '1968', ratio: 1, src: space(1) },
  { id: 'hubble-ultra-deep-field', kind: 'space', title: 'Hubble Ultra Deep Field', artist: 'Hubble Space Telescope', date: '2004', ratio: 1, src: space(1) },
]

export const pictureSources: Readonly<Record<string, string>> = Object.fromEntries(pictureCards.map((card) => [card.id, card.src]))

const first = pictureCards[0]!

/** A picture with its story, as the picture page shows it. Fixture text, not catalog text. */
export const pictureStory: PictureStoryView = {
  id: first.id,
  kind: first.kind,
  title: first.title,
  artist: first.artist,
  date: first.date,
  ratio: first.ratio,
  medium: 'Oil on canvas',
  place: 'Musée Marmottan Monet, Paris',
  caption: 'The port of Le Havre at dawn, seen from a window over the water: a red sun, its reflection and two rowing boats in the haze.',
  facts: [
    { text: 'Monet showed it in April 1874 at the first exhibition of the group that soon took the name Impressionists, in the photographer Nadar’s former studio in Paris.', source: 'Musée Marmottan Monet, collection entry', url: 'https://example.org/marmottan' },
    { text: 'A critic’s mocking review of the show took its title from this picture. The name stuck, and the painters took it up.', source: 'A museum essay', url: 'https://example.org/essay' },
    { text: 'Critics objected to how unfinished it looked: loose strokes, no fine detail, against the Salon’s rule of a smooth, finished surface.', source: 'A book on the period' },
  ],
  credit: 'Musée Marmottan Monet, via Wikimedia Commons, public domain',
  sourceUrl: 'https://example.org/commons',
}

/** A space image's story, with the culture line absent and a long place. */
export const spaceStory: PictureStoryView = {
  id: 'webb-cosmic-cliffs',
  kind: 'space',
  title: 'Cosmic Cliffs in the Carina Nebula',
  artist: 'James Webb Space Telescope',
  date: '2022',
  ratio: 1.73,
  medium: 'Near-infrared image, NIRCam',
  place: 'NGC 3324 in the Carina Nebula, about 7,600 light-years away',
  caption: 'The edge of a cavity of gas and dust that hot young stars have blown open.',
  facts: [
    { text: 'The tallest peaks in the picture are about 7 light-years high.', source: 'NASA release', url: 'https://example.org/nasa' },
    { text: 'Infrared light passes through dust, so stars hidden from visible-light telescopes show here.', source: 'NASA release', url: 'https://example.org/nasa' },
    { text: 'Colours are assigned to infrared wavelengths: the shortest show as blue, the longest as red.', source: 'NASA release', url: 'https://example.org/nasa' },
  ],
  credit: 'NASA, ESA, CSA, STScI, public domain',
  sourceUrl: 'https://example.org/nasa',
}

export const storySource = pictureSources[first.id]!
export const spaceSource = pictureSources['webb-cosmic-cliffs']!
