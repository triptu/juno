/**
 * Home's pictures and the gallery's quotes and facts (SPEC 12, "A picture"
 * and "Pictures and the gallery").
 *
 * This module is small and loads with Home: the types, the image file
 * names and the rule that picks the next picture. The catalog itself, with
 * every story, is `./catalog`, its own chunk, loaded when idle after Home
 * paints and when the gallery opens. The quotes and facts are `./thoughts`,
 * another chunk, loaded when the gallery opens.
 */

/** The rough theme of a quote or fact: focus and craft, thinking deeply, wonder at the universe, life, things made, art and beauty. */
export type ThoughtTheme = 'focus' | 'thinking' | 'wonder' | 'life' | 'made' | 'art'

/** A quote (with `by`) or a fact (without). `source` is never shown; it is there to check the entry against. */
export interface Thought {
  readonly text: string
  readonly by?: string
  readonly theme: ThoughtTheme
  readonly source: string
}

/** Paintings (including manuscript pages and calligraphy), prints, scientific and natural-history illustration, and space images. */
export type PictureKind = 'painting' | 'print' | 'illustration' | 'space'

/** Artworks are public domain or CC0; some ESA images are CC BY 4.0 and show their credit. */
export type PictureLicence = 'public-domain' | 'cc0' | 'cc-by-4.0'

/** One fact of a picture's story, with where it is stated. */
export interface PictureFact {
  readonly text: string
  /** The source that states it: a museum page, a catalogue, a release or a book. */
  readonly source: string
  readonly url?: string
}

export interface Picture {
  /** Stable, lower-case words and hyphens; also the image files' name. */
  readonly id: string
  readonly kind: PictureKind
  readonly title: string
  /** The artist, or the telescope, mission or crew for a space image. */
  readonly artist: string
  /** Where and what tradition, when it helps ("Pahari, Tehri Garhwal"). */
  readonly culture?: string
  /** As the holding collection gives it: "c. 1830–32", "late 14th century". */
  readonly date: string
  readonly medium: string
  /** The holding collection and city, or for a space image what and where it is. */
  readonly place: string
  /** Space images: how far away the subject is. */
  readonly distance?: string
  /** One sentence: what the picture is. */
  readonly caption: string
  /** Three to five, the best first. */
  readonly facts: ReadonlyArray<PictureFact>
  readonly licence: PictureLicence
  /** The credit line to show. */
  readonly credit: string
  /** The page for this image: the museum's object page, the Commons file page or the release. */
  readonly sourceUrl: string
  /** Width over height of the image files, so a box can take the picture's shape before it loads. */
  readonly ratio: number
  /** Suits late night as well as a space image does: a nocturne, a moonlit scene. */
  readonly night?: boolean
}

/** The two files of each picture: one for Home's box at 2x, one for the picture page. */
export type PictureSize = 'small' | 'large'

/** A picture id: lower-case letters, digits and single hyphens. */
export const PICTURE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** The file of one size of a picture, as stored in the bucket and on disk. */
export const pictureFile = (id: string, size: PictureSize): string => `${id}-${size}.webp`

/** What Home's caption and box need, saved with the next picture so Home has it in its first frame without the catalog. */
export interface PictureLabel {
  readonly id: string
  readonly title: string
  readonly artist: string
  readonly date: string
  readonly ratio: number
}

export const labelOf = (picture: Picture): PictureLabel => ({ id: picture.id, title: picture.title, artist: picture.artist, date: picture.date, ratio: picture.ratio })

/** The gallery's order of kinds, and their section names. */
export const PICTURE_KINDS: ReadonlyArray<PictureKind> = ['painting', 'print', 'illustration', 'space']

/** Whether a picture suits late night: every space image, and pictures marked for it. */
export const suitsNight = (picture: Picture): boolean => picture.kind === 'space' || picture.night === true

/**
 * Whether a picture suits Home's box: a panorama or a very tall picture
 * would be a thin strip there, so it is in the gallery only.
 */
export const fitsHome = (picture: Picture): boolean => picture.ratio >= 0.55 && picture.ratio <= 2.6

/** Late night as Home's scene counts it (the home README, "Picking a scene"): 22:00 to 4:59. */
export const isLateNight = (now: Date): boolean => now.getHours() >= 22 || now.getHours() < 5

/**
 * The next picture for Home: one that fits Home's box and is not seen yet,
 * at `random` (0 to 1) among them, and late at night one that suits the
 * night while one is left. Once every
 * picture has been seen the list starts over, without the ones in `avoid`
 * (the one showing now), so the same picture never shows twice in a row.
 * Returns the picture and the seen ids after it.
 */
export function pickPicture(
  list: ReadonlyArray<Picture>,
  seen: ReadonlyArray<string>,
  random: number,
  options: { readonly night: boolean; readonly avoid?: ReadonlyArray<string> },
): { readonly picture: Picture; readonly seen: ReadonlyArray<string> } | undefined {
  const fitting = list.filter(fitsHome)
  const candidates = fitting.length > 0 ? fitting : list
  const known = new Set(candidates.map((picture) => picture.id))
  const kept = seen.filter((id) => known.has(id))
  const seenSet = new Set(kept)
  let pool = candidates.filter((picture) => !seenSet.has(picture.id))
  let after = kept
  if (pool.length === 0) {
    const avoided = new Set(options.avoid ?? [])
    pool = candidates.filter((picture) => !avoided.has(picture.id))
    after = []
    if (pool.length === 0) pool = [...candidates]
  }
  if (options.night) {
    const night = pool.filter(suitsNight)
    if (night.length > 0) pool = night
  }
  const picture = pool[Math.min(pool.length - 1, Math.floor(random * pool.length))]
  if (picture === undefined) return undefined
  return { picture, seen: [...after, picture.id] }
}
