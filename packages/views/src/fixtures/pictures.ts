import type { GalleryPictureView } from '../Gallery'
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

/** Fixture words, not catalog text: a quote with who said it, or a fact. */
export const pictureCards: ReadonlyArray<GalleryPictureView & { readonly src: string }> = [
  { id: 'monet-impression-sunrise', kind: 'painting', title: 'Impression, Sunrise', artist: 'Claude Monet', date: '1872', ratio: 1.29, year: 1872, line: { text: 'Wallpaper in its first stage is more finished than this seascape.', by: 'A critic, 1874' }, src: painting(1.29, '#9DB3AC', '#5E7F84', '#E2643A') },
  { id: 'vermeer-milkmaid', kind: 'painting', title: 'The Milkmaid', artist: 'Johannes Vermeer', date: 'c. 1660', ratio: 0.89, year: 1660, line: { text: 'Scans found a basket for warming a baby by her feet, painted out.' }, src: painting(0.89, '#C9C0A4', '#3F5A8C', '#E8D27A') },
  { id: 'kota-radha-krishna', kind: 'painting', title: 'Radha and Krishna Walk in a Flowering Grove', artist: 'The Kota Master', date: 'c. 1720', ratio: 0.65, year: 1720, line: { text: 'The trees flower in every colour the painter had, though no real grove looks like this.' }, src: painting(0.65, '#3E6B45', '#B23A2C', '#F0C04A') },
  { id: 'turner-temeraire', kind: 'painting', title: 'The Fighting Temeraire', artist: 'J. M. W. Turner', date: '1839', ratio: 1.35, year: 1839, line: { text: 'He kept it all his life and left it to the nation.' }, src: painting(1.35, '#D9B57A', '#6F7F8C', '#F2763A') },
  { id: 'van-gogh-irises', kind: 'painting', title: 'Irises', artist: 'Vincent van Gogh', date: '1889', ratio: 1.29, year: 1889, line: { text: 'I am working on a picture of irises, which takes my mind off things.', by: 'A painter, in a letter' }, src: painting(1.29, '#7FA35A', '#3D4E9E', '#E8A33A') },
  { id: 'friedrich-wanderer', kind: 'painting', title: 'Wanderer above the Sea of Fog', artist: 'Caspar David Friedrich', date: 'c. 1817', ratio: 0.78, year: 1817, line: { text: 'The peaks come from separate walks, joined into one view.' }, src: painting(0.78, '#B9C3C9', '#3B3935', '#E9E3D3') },
  { id: 'hokusai-great-wave', kind: 'print', title: 'Under the Wave off Kanagawa', artist: 'Katsushika Hokusai', date: 'c. 1830–32', ratio: 1.49, year: 1830, line: { text: 'The small triangle in the hollow of the wave is a mountain.' }, src: painting(1.49, '#E8DCC0', '#29497A', '#F4F1E8') },
  { id: 'hiroshige-sudden-shower', kind: 'print', title: 'Sudden Shower over Shin-Ōhashi Bridge and Atake', artist: 'Utagawa Hiroshige', date: '1857', ratio: 0.66, year: 1857, line: { text: 'A painter copied this print in oil thirty years later.' }, src: painting(0.66, '#5D6670', '#3E6E8C', '#C9C2A8') },
  { id: 'haeckel-discomedusae', kind: 'illustration', title: 'Discomedusae', artist: 'Ernst Haeckel', date: '1904', ratio: 0.7, year: 1904, line: { text: 'Every jellyfish on the plate was drawn from a real one under a microscope or from life, then arranged into one symmetrical page.' }, src: painting(0.7, '#EFE8D6', '#C46A4A', '#3E6E8C') },
  { id: 'webb-cosmic-cliffs', kind: 'space', title: 'Cosmic Cliffs in the Carina Nebula', artist: 'James Webb Space Telescope', date: '2022', ratio: 1.73, year: 2022, line: { text: 'The tallest peaks here are about seven light-years high.' }, src: space(1.73) },
  { id: 'apollo-8-earthrise', kind: 'space', title: 'Earthrise', artist: 'William Anders, Apollo 8', date: '1968', ratio: 1, year: 1968, line: { text: 'We came to explore the Moon and found the Earth.', by: 'A crew member' }, src: space(1) },
  { id: 'hubble-ultra-deep-field', kind: 'space', title: 'Hubble Ultra Deep Field', artist: 'Hubble Space Telescope', date: '2004', ratio: 1, year: 2004, line: { text: 'Almost every point of light here is a galaxy.' }, src: space(1) },
  { id: 'cave-horses', kind: 'painting', title: 'Panel of the Horses', artist: 'Unknown painters', date: 'c. 36,000 years ago', ratio: 1.5, year: -34000, line: { text: 'The wall was scraped clean before the horses were drawn on it in charcoal.' }, src: painting(1.5, '#C9A57A', '#8A6A48', '#2E2620') },
  { id: 'indus-seal', kind: 'objects', title: 'Stamp seal with a bull', artist: 'Unknown maker', date: 'c. 2600–1900 BCE', ratio: 1, year: -2600, line: { text: 'The signs along the top are a script no one has yet read.' }, src: painting(1, '#8A8478', '#D9D2C2', '#6B6458') },
  { id: 'chola-nataraja', kind: 'objects', title: 'Shiva as Lord of the Dance', artist: 'Unknown maker', date: 'late 11th century', ratio: 0.75, year: 1070, line: { text: 'The ring of flames stands for the universe he dances into being and out again.' }, src: painting(0.75, '#B9BDB4', '#4E6B5E', '#C9A85A') },
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
  line: { text: 'Wallpaper in its first stage is more finished than this seascape.', by: 'A critic', context: 'in a newspaper, 1874, of this picture. He meant it as mockery; the painters took the name.' },
  about: 'Painted from a window over the harbour in a few hours, with the boats and the sun added last. It was shown in 1874 at the first exhibition of the group that soon took the name Impressionists. Critics objected to its loose strokes and lack of finish.',
  learnMore: { label: 'Musée Marmottan Monet', url: 'https://example.org/museum' },
  scale: { kind: 'size', widthCm: 63, heightCm: 48 },
  credit: 'Musée Marmottan Monet, via Wikimedia Commons, public domain',
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
  line: { text: 'The tallest peaks in the picture are about seven light-years high.' },
  about: 'Infrared light passes through dust, so stars hidden from visible-light telescopes show here. Colours are assigned to infrared wavelengths: the shortest show as blue, the longest as red.',
  learnMore: { label: 'NASA', url: 'https://example.org/nasa' },
  scale: { kind: 'distance', lightYears: 7600 },
  credit: 'NASA, ESA, CSA, STScI, public domain',
}

/** A picture of Earth from far away, with no line context and a distance in kilometres. */
export const earthStory: PictureStoryView = {
  ...spaceStory,
  id: 'apollo-8-earthrise',
  title: 'Earthrise',
  artist: 'William Anders, Apollo 8',
  date: '1968',
  ratio: 1,
  medium: 'Colour photograph',
  place: 'Earth above the Moon’s horizon, from lunar orbit',
  caption: 'Earth, half lit, rising over the grey horizon of the Moon.',
  line: { text: 'We came to explore the Moon and found the Earth.', by: 'A crew member' },
  scale: { kind: 'distance', km: 384_400, note: 'Taken from lunar orbit, about as far as the Moon is from Earth.' },
}

/** A picture with no scale data: nothing is reserved for it. */
export const plainStory: PictureStoryView = (({ scale: _scale, ...rest }) => rest)(pictureStory)

/** A very large canvas, so the person is the small one. */
export const largeStory: PictureStoryView = { ...pictureStory, title: 'A Large Canvas', scale: { kind: 'size', widthCm: 453, heightCm: 379 } }

export const storySource = pictureSources[first.id]!
export const spaceSource = pictureSources['webb-cosmic-cliffs']!
export const earthSource = pictureSources['apollo-8-earthrise']!
