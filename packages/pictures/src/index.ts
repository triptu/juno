/**
 * Home's pictures and their words (SPEC 12, "A picture" and "Pictures and
 * the gallery").
 *
 * This module is small and loads with Home: the types, the image file
 * names and the rule that picks the next picture. The catalog itself, with
 * every picture's words, is `./catalog`, its own chunk, loaded when idle
 * after Home paints and when the gallery opens.
 */

/** Paintings (including manuscript pages and calligraphy), prints, scientific and natural-history illustration, and space images. */
export type PictureKind = 'painting' | 'print' | 'illustration' | 'space'

/** Artworks are public domain or CC0; some ESA images are CC BY 4.0 and show their credit. */
export type PictureLicence = 'public-domain' | 'cc0' | 'cc-by-4.0'

/**
 * The one line that goes with a picture: something a named person said or
 * wrote about it (a quote, with `by`), or one dated fact about it (no `by`).
 * At most about 140 characters, so it fits in two lines on Home.
 */
export interface PictureLine {
  readonly text: string
  /** Who said it: shown as a quiet attribution after a quote. */
  readonly by?: string
  /** One short clause shown on the picture page only, after `by`: "in Le Charivari, 1874, of this picture." */
  readonly context?: string
  /** Where it is stated: kept to check it against, never shown. */
  readonly source: string
  readonly url?: string
}

/** The single best page to read more: shown as one link labelled with the institution, never the address. */
export interface PictureLearnMore {
  readonly label: string
  readonly url: string
}

/**
 * How big or how far, where it says something: an artwork's size, drawn next
 * to a person; how far a space object is in light-years, so how long its
 * light took; or how far away a picture of Earth or the Moon was taken.
 * Every number is checked; `source` is never shown.
 */
export type PictureScale =
  | { readonly kind: 'size'; readonly widthCm: number; readonly heightCm: number; readonly source?: string }
  | { readonly kind: 'distance'; readonly lightYears: number; readonly note?: string; readonly source?: string }
  | { readonly kind: 'distance'; readonly km: number; readonly note?: string; readonly source?: string }

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
  /** One sentence: what the picture is. Not shown; it is the picture's description for screen readers. */
  readonly caption: string
  readonly line: PictureLine
  /** Two to four plain sentences about the picture, for its page. */
  readonly about: string
  readonly learnMore: PictureLearnMore
  readonly scale?: PictureScale
  readonly licence: PictureLicence
  /** The credit line to show. */
  readonly credit: string
  /** Where the image file comes from: the museum's object page, the Commons file page or the release. Not shown. */
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

/** What Home's label, line and box need, saved with the next picture so Home has it in its first frame without the catalog. */
export interface PictureLabel {
  readonly id: string
  readonly title: string
  readonly artist: string
  readonly date: string
  readonly ratio: number
  readonly line: { readonly text: string; readonly by?: string }
}

export const labelOf = (picture: Picture): PictureLabel => ({
  id: picture.id,
  title: picture.title,
  artist: picture.artist,
  date: picture.date,
  ratio: picture.ratio,
  line: picture.line.by === undefined ? { text: picture.line.text } : { text: picture.line.text, by: picture.line.by },
})

/**
 * The year a picture was made, as near as its date says: the first year in
 * it ("c. 1830–32" is 1830), or the middle of the first century it names
 * ("late 14th century" is 1350). For the gallery's order by time.
 */
export function yearOf(date: string): number | undefined {
  const year = /\b(\d{3,4})\b/.exec(date)
  if (year !== null) return Number(year[1])
  const century = /\b(\d{1,2})(?:st|nd|rd|th)\b/.exec(date)
  return century === null ? undefined : (Number(century[1]) - 1) * 100 + 50
}

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
