import * as stylex from '@stylexjs/stylex'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { accent, colors, radii, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { activateHandlers, Button, FilterPill, PillRow, Segmented, Text, type ActivateEvent } from '@juno/ui'
import { PictureImage, pictureLift, type PictureCardView } from './PictureImage'
import { PictureLine, type PictureLineView } from './PictureLine'

export type GalleryKind = PictureCardView['kind']
/** All is every picture; each kind has a pill. */
export type GalleryFilter = 'all' | GalleryKind
/** By kind: pictures in columns with their words, in sections by kind. By time: in rows, in sections by period (`periodOf`). */
export type GalleryOrder = 'kind' | 'time'

/** A picture on the gallery's wall: its card, its line, and the year it was made (negative before the common era). */
export interface GalleryPictureView extends PictureCardView {
  readonly line: PictureLineView
  readonly year: number
}

/** The gallery's sections, in order, with their names. */
export const GALLERY_SECTIONS: ReadonlyArray<{ readonly kind: GalleryKind; readonly name: string }> = [
  { kind: 'painting', name: 'Paintings' },
  { kind: 'print', name: 'Prints' },
  { kind: 'illustration', name: 'Nature' },
  { kind: 'space', name: 'Space' },
  { kind: 'objects', name: 'Objects' },
]

const ORDERS = [
  { value: 'kind', label: 'By kind' },
  { value: 'time', label: 'By time' },
] as const

export interface GalleryProps {
  /** Every picture, in the catalog's order. */
  readonly pictures: ReadonlyArray<GalleryPictureView>
  /** The small file of each picture on this Mac, by id; a picture without one shows its box in the secondary fill. */
  readonly sources: Readonly<Record<string, string>>
  /** The picture Home showed last: a thin ring. */
  readonly current?: string
  readonly filter: GalleryFilter
  readonly onFilter: (filter: GalleryFilter) => void
  readonly order: GalleryOrder
  readonly onOrder: (order: GalleryOrder) => void
  /** Fires on mouse down; `event.metaKey` asks for a new tab. */
  readonly onOpen: (id: string, event: ActivateEvent) => void
  /** A picture without its file came near the screen: download it. */
  readonly onNear: (id: string) => void
  /** Where the page was scrolled, to come back to it. */
  readonly scrollTop?: number
  readonly onScroll?: (top: number) => void
}

/** How far below the screen a picture starts downloading. */
const NEAR_MARGIN = '600px' // tokens-allow: an observer margin, not a layout length

/**
 * The By time section a year falls in, as its heading says it. Centuries
 * from 1000 BCE on ("600s BCE", "900s", "1800s"), millennia before that
 * ("3000s BCE" is 3999 to 3000 BCE), and everything older than 10,000 BCE
 * in one section, so 45,000 years make a short list. A negative year is BCE.
 */
export function periodOf(year: number): string {
  if (year < -10_000) return 'Before 10,000 BCE'
  if (year >= 1) {
    const century = Math.floor(year / 100) * 100
    return century === 0 ? '1–99' : `${century}s`
  }
  const bce = Math.max(1, -year)
  if (bce >= 1000) {
    const millennium = Math.floor(bce / 1000) * 1000
    return `${millennium >= 10_000 ? millennium.toLocaleString('en-US') : millennium}s BCE`
  }
  const century = Math.floor(bce / 100) * 100
  return century === 0 ? '1–99 BCE' : `${century}s BCE`
}

/**
 * The gallery (SPEC 12, "Pictures and the gallery"). By kind: every picture
 * in sections by kind, in columns that share the page's width, each picture
 * at its own shape with its label and its line under it. By time: sections
 * by period (`periodOf`), oldest first, in rows of one height with the date under each.
 * A picture without its file keeps its box, so nothing moves when one lands.
 */
export function Gallery({ pictures, sources, current, filter, onFilter, order, onOrder, onOpen, onNear, scrollTop, onScroll }: GalleryProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const near = useRef(onNear)
  near.current = onNear
  const shown = filter === 'all' ? pictures : pictures.filter((picture) => picture.kind === filter)
  const columns = useColumns(scroller)

  useLayoutEffect(() => {
    if (columns === undefined) return
    if (scrollTop !== undefined && scroller.current !== null) scroller.current.scrollTop = scrollTop
    // Only where the page was when it opened, once its columns are laid out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns === undefined])

  // One observer for the page: a picture without its file asks for it once it is near the screen.
  useEffect(() => {
    const root = scroller.current
    if (root === null) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const id = (entry.target as HTMLElement).dataset['galleryPicture']
          observer.unobserve(entry.target)
          if (id !== undefined) near.current(id)
        }
      },
      { root, rootMargin: `${NEAR_MARGIN} 0px` },
    )
    for (const tile of root.querySelectorAll<HTMLElement>('[data-gallery-picture][data-gallery-missing]')) observer.observe(tile)
    return () => observer.disconnect()
  }, [filter, order, columns, sources])

  return (
    <div ref={scroller} data-gallery="" data-gallery-order={order} onScroll={onScroll === undefined ? undefined : (event) => onScroll(event.currentTarget.scrollTop)} {...stylex.props(styles.scroll)}>
      <div {...stylex.props(styles.page)}>
        <Text variant="pageTitle" tone="default" as="h1">
          Gallery
        </Text>
        <Text variant="body" tone="subtle" as="p" sx={styles.lead}>
          Forty-five thousand years of paintings, carvings, prints and studies of nature, and pictures of space that make them look recent.
        </Text>
        <div {...stylex.props(styles.bar)}>
          <GalleryPills pictures={pictures} filter={filter} onFilter={onFilter} />
          <Segmented label="Order" value={order} options={ORDERS} onChange={onOrder} />
        </div>
        <div data-gallery-wall="" {...stylex.props(styles.wall)}>
          {columns === undefined ? null : order === 'kind' ? (
            <ByKind pictures={shown} columns={columns} sources={sources} current={current} titled={filter === 'all'} onOpen={onOpen} />
          ) : (
            <ByTime pictures={shown} sources={sources} current={current} onOpen={onOpen} />
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * How many columns fit the wall: as many at least `--gallery-column` wide as
 * fit, sharing the width evenly. Measured before the first paint and again
 * when the page is resized, so the first frame is already laid out.
 */
function useColumns(scroller: RefObject<HTMLDivElement | null>): number | undefined {
  const [columns, setColumns] = useState<number | undefined>(undefined)
  useLayoutEffect(() => {
    const wall = scroller.current?.querySelector<HTMLElement>('[data-gallery-wall]')
    if (wall === null || wall === undefined) return
    const measure = () => {
      const style = getComputedStyle(wall)
      const min = Number.parseFloat(style.getPropertyValue('--gallery-column-min')) || 1
      const gap = Number.parseFloat(style.columnGap) || 0
      setColumns(Math.max(1, Math.floor((wall.clientWidth + gap) / (min + gap))))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(wall)
    return () => observer.disconnect()
  }, [scroller])
  return columns
}

/**
 * Places pictures in columns, each in the shortest column so far, as a pure
 * function of their shapes and words, so the boxes are placed before any
 * image loads. A height is in column widths: the picture's, then about how
 * much its label and line take.
 */
function intoColumns<T extends GalleryPictureView>(pictures: ReadonlyArray<T>, count: number): ReadonlyArray<ReadonlyArray<T>> {
  const columns: Array<Array<T>> = Array.from({ length: count }, () => [])
  const heights: Array<number> = Array.from({ length: count }, () => 0)
  for (const picture of pictures) {
    let at = 0
    for (let index = 1; index < count; index++) if (heights[index]! < heights[at]! - 0.01) at = index
    columns[at]!.push(picture)
    // About 40 characters to a line of the serif in a column, 0.1 column widths a line, and the label's line.
    heights[at]! += 1 / picture.ratio + 0.1 * (1 + Math.ceil(picture.line.text.length / 40)) + 0.2
  }
  return columns
}

type WallProps = Pick<GalleryProps, 'sources' | 'current' | 'onOpen'> & { readonly pictures: ReadonlyArray<GalleryPictureView> }

/** Sections by kind (titled under All), each in columns. */
function ByKind({ pictures, columns, sources, current, titled, onOpen }: WallProps & { readonly columns: number; readonly titled: boolean }) {
  return GALLERY_SECTIONS.map((section) => {
    const list = pictures.filter((picture) => picture.kind === section.kind)
    if (list.length === 0) return null
    return (
      <section key={section.kind} aria-label={section.name} {...stylex.props(styles.section)}>
        {titled ? (
          <Text variant="sectionLabel" tone="muted" as="h2" sx={styles.heading}>
            {section.name}
          </Text>
        ) : null}
        <div {...stylex.props(styles.columns)}>
          {intoColumns(list, columns).map((column, index) => (
            <ul key={index} {...stylex.props(styles.column)}>
              {column.map((picture) => (
                <li key={picture.id} data-gallery-picture={picture.id} data-gallery-missing={sources[picture.id] === undefined ? '' : undefined} {...stylex.props(styles.plate)}>
                  <PictureButton picture={picture} src={sources[picture.id]} current={picture.id === current} onOpen={onOpen}>
                    <Text variant="meta" tone="muted" truncate tooltipWhenTruncated sx={styles.label}>
                      <Text variant="inherit" tone="subtle">
                        {picture.title}
                      </Text>
                      {` · ${picture.artist}, ${picture.date}`}
                    </Text>
                  </PictureButton>
                  <PictureLine line={picture.line} place="gallery" />
                </li>
              ))}
            </ul>
          ))}
        </div>
      </section>
    )
  })
}

/**
 * Sections by period, oldest first, each a row of its own: a heading over a
 * rule across the page, then its pictures at one height, wrapping. Under
 * each picture its title, on up to two lines, then "date · artist", muted;
 * a picture narrower than a caption gets a tile of the caption's width.
 */
function ByTime({ pictures, sources, current, onOpen }: WallProps) {
  // Sorted by year, each period's pictures are next to each other and the periods come oldest first.
  const sorted = pictures.toSorted((a, b) => a.year - b.year)
  const periods = [...new Set(sorted.map((picture) => periodOf(picture.year)))]
  return periods.map((period) => (
    <section key={period} aria-label={period} {...stylex.props(styles.section)}>
      <Text variant="sectionLabel" tone="muted" as="h2" numeric sx={styles.timeHeading}>
        {period}
      </Text>
      <ul {...stylex.props(styles.row)}>
        {sorted
          .filter((picture) => periodOf(picture.year) === period)
          .map((picture) => (
            <li key={picture.id} data-gallery-picture={picture.id} data-gallery-missing={sources[picture.id] === undefined ? '' : undefined} {...stylex.props(styles.tile, styles.atRow(picture.ratio))}>
              <PictureButton picture={picture} src={sources[picture.id]} current={picture.id === current} onOpen={onOpen} width={`calc(${sizes['--gallery-row']} * ${picture.ratio})`}>
                <Text variant="meta" tone="subtle" clamp={2} tooltipWhenTruncated>
                  {picture.title}
                </Text>
                <Text variant="meta" tone="muted" numeric truncate tooltipWhenTruncated>
                  {picture.date} · {picture.artist}
                </Text>
              </PictureButton>
            </li>
          ))}
      </ul>
    </section>
  ))
}

/** All, then each kind, with its count. */
function GalleryPills({ pictures, filter, onFilter }: Pick<GalleryProps, 'pictures' | 'filter' | 'onFilter'>) {
  const pills: ReadonlyArray<{ readonly filter: GalleryFilter; readonly name: string; readonly count: number }> = [
    { filter: 'all', name: 'All', count: pictures.length },
    ...GALLERY_SECTIONS.map((section) => ({ filter: section.kind, name: section.name, count: pictures.filter((picture) => picture.kind === section.kind).length })),
  ]
  return (
    <PillRow aria-label="Show">
      {pills.map((pill) => (
        <FilterPill key={pill.filter}>
          <Button variant="filter" pressed={filter === pill.filter} {...activateHandlers<HTMLButtonElement>(() => onFilter(pill.filter))}>
            {pill.name}
            <Text variant="inherit" tone="muted" numeric sx={styles.count}>
              {pill.count}
            </Text>
          </Button>
        </FilterPill>
      ))}
    </PillRow>
  )
}

/** A picture that opens its page: its box at its shape (at `width` when the tile is wider), then what the wall says under it. */
function PictureButton({ picture, src, current, onOpen, width, children }: { readonly picture: PictureCardView; readonly src: string | undefined; readonly current: boolean; readonly onOpen: GalleryProps['onOpen']; readonly width?: string; readonly children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={`${picture.title}, ${picture.artist}, ${picture.date}`}
      aria-current={current ? 'true' : undefined}
      {...activateHandlers<HTMLButtonElement>((event) => onOpen(picture.id, event))}
      {...stylex.props(styles.open, pictureLift)}
    >
      <span {...stylex.props(styles.frame, width !== undefined && styles.frameWidth(width), current && styles.current)}>
        <PictureImage src={src} ratio={picture.ratio} />
      </span>
      <span aria-hidden {...stylex.props(styles.words)}>
        {children}
      </span>
    </button>
  )
}

const styles = stylex.create({
  scroll: {
    flexGrow: 1,
    alignSelf: 'stretch',
    width: '100%',
    minHeight: 0,
    overflowY: 'auto',
    scrollbarGutter: 'stable',
  },
  page: {
    display: 'flex',
    flexDirection: 'column',
    paddingBlock: spacing['--space-10'],
    paddingInline: spacing['--space-12'],
  },
  lead: { margin: 0, marginTop: spacing['--space-1-5'] },
  bar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing['--space-3'],
    marginTop: spacing['--space-5'],
  },
  count: { marginInlineStart: spacing['--space-1-5'] },
  // Read by `useColumns`: the narrowest a column gets, and the gap between columns.
  wall: {
    '--gallery-column-min': sizes['--gallery-column'],
    columnGap: spacing['--space-6'],
  },
  section: { marginTop: spacing['--space-7'] },
  heading: { margin: 0, marginBottom: spacing['--space-3'] },
  columns: { display: 'flex', alignItems: 'flex-start', gap: spacing['--space-6'] },
  column: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-8'],
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 0,
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  plate: { display: 'flex', flexDirection: 'column', gap: spacing['--space-1-5'], minWidth: 0 },
  label: { display: 'block', marginTop: spacing['--space-1'] },
  timeHeading: {
    margin: 0,
    marginBottom: spacing['--space-3'],
    paddingBottom: spacing['--space-2'],
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: colors['--border-strong'],
  },
  // One height: each picture as wide as its shape at that height. Captions may differ in height, so pictures align at the top.
  row: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    gap: `${spacing['--space-6']} ${spacing['--space-5']}`,
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  tile: { flexShrink: 0, minWidth: 0 },
  // As wide as the picture at the row's height, and never narrower than a caption.
  atRow: (ratio: number) => ({ width: `max(calc(${sizes['--gallery-row']} * ${ratio}), ${sizes['--gallery-tile-min']})` }),
  frameWidth: (width: string) => ({ width }),
  open: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-2'],
    width: '100%',
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    textAlign: 'start',
    color: 'inherit',
    font: 'inherit',
    cursor: 'default',
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineWidth: sizes['--focus-ring-width'],
    outlineOffset: sizes['--focus-ring-offset'],
    outlineColor: accent['--focus-ring'],
    borderRadius: 0,
  },
  frame: { display: 'block', borderRadius: radii['--radius-inline'] },
  // The picture Home showed last: a quiet ring around the picture, not the accent of focus.
  current: {
    outlineStyle: 'solid',
    outlineWidth: sizes['--focus-ring-width'],
    outlineOffset: sizes['--focus-ring-offset'],
    outlineColor: colors['--border-strongest'],
  },
  words: { display: 'flex', flexDirection: 'column', minWidth: 0 },
})
