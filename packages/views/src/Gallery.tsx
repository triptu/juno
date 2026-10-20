import * as stylex from '@stylexjs/stylex'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { accent, colors, radii, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { activateHandlers, Button, FilterPill, PillRow, Text, type ActivateEvent } from '@juno/ui'
import { PictureImage, pictureLift, type PictureCardView } from './PictureImage'

export type GalleryKind = PictureCardView['kind']
export type GalleryFilter = 'all' | GalleryKind

/** The gallery's sections, in order, with their names. */
export const GALLERY_SECTIONS: ReadonlyArray<{ readonly kind: GalleryKind; readonly name: string }> = [
  { kind: 'painting', name: 'Paintings' },
  { kind: 'print', name: 'Prints' },
  { kind: 'illustration', name: 'Nature' },
  { kind: 'space', name: 'Space' },
]

export interface GalleryProps {
  /** Every picture, in the catalog's order. */
  readonly pictures: ReadonlyArray<PictureCardView>
  /** The small file of each picture on this Mac, by id; a picture without one shows its box in the secondary fill. */
  readonly sources: Readonly<Record<string, string>>
  /** The picture Home showed last: a thin ring. */
  readonly current?: string
  readonly filter: GalleryFilter
  readonly onFilter: (filter: GalleryFilter) => void
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
 * The gallery (SPEC 12, "Pictures and the gallery"): every picture in
 * sections by kind, in rows of one height with each picture at its own
 * shape, and its title and "artist, date" under it. A picture without its
 * file keeps its box, so the rows never move when one lands.
 */
export function Gallery({ pictures, sources, current, filter, onFilter, onOpen, onNear, scrollTop, onScroll }: GalleryProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const near = useRef(onNear)
  near.current = onNear
  const sections = GALLERY_SECTIONS.filter((section) => filter === 'all' || section.kind === filter).map((section) => ({
    ...section,
    pictures: pictures.filter((picture) => picture.kind === section.kind),
  }))

  useLayoutEffect(() => {
    if (scrollTop !== undefined && scroller.current !== null) scroller.current.scrollTop = scrollTop
    // Only where the page was when it opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
  }, [filter, sources])

  return (
    <div ref={scroller} data-gallery="" onScroll={onScroll === undefined ? undefined : (event) => onScroll(event.currentTarget.scrollTop)} {...stylex.props(styles.scroll)}>
      <div {...stylex.props(styles.page)}>
        <Text variant="pageTitle" tone="default" as="h1">
          Gallery
        </Text>
        <Text variant="body" tone="subtle" as="p" sx={styles.lead}>
          The pictures Home shows when you are caught up, each with its story. Paintings, prints and nature studies in the public domain, and images from Hubble, Webb and NASA.
        </Text>
        <div {...stylex.props(styles.pills)}>
          <PillRow aria-label="Show">
            {[{ kind: 'all' as const, name: 'All', count: pictures.length }, ...GALLERY_SECTIONS.map((section) => ({ ...section, count: pictures.filter((picture) => picture.kind === section.kind).length }))].map((pill) => (
              <FilterPill key={pill.kind}>
                <Button variant="filter" pressed={filter === pill.kind} {...activateHandlers<HTMLButtonElement>(() => onFilter(pill.kind))}>
                  {pill.name}
                  <Text variant="inherit" tone="muted" numeric sx={styles.count}>
                    {pill.count}
                  </Text>
                </Button>
              </FilterPill>
            ))}
          </PillRow>
        </div>
        {sections.map((section) =>
          section.pictures.length === 0 ? null : (
            <section key={section.kind} aria-label={section.name} {...stylex.props(styles.section)}>
              {filter === 'all' ? (
                <Text variant="sectionLabel" tone="muted" as="h2" sx={styles.heading}>
                  {section.name}
                </Text>
              ) : null}
              <ul {...stylex.props(styles.row)}>
                {section.pictures.map((picture) => {
                  const src = sources[picture.id]
                  return (
                    <li key={picture.id} data-gallery-picture={picture.id} data-gallery-missing={src === undefined ? '' : undefined} {...stylex.props(styles.tile, styles.share(picture.ratio))}>
                      <button
                        type="button"
                        aria-label={`${picture.title}, ${picture.artist}, ${picture.date}`}
                        aria-current={picture.id === current ? 'true' : undefined}
                        {...activateHandlers<HTMLButtonElement>((event) => onOpen(picture.id, event))}
                        {...stylex.props(styles.open, pictureLift)}
                      >
                        <span {...stylex.props(styles.frame, picture.id === current && styles.current)}>
                          <PictureImage src={src} ratio={picture.ratio} />
                        </span>
                        <span aria-hidden {...stylex.props(styles.words)}>
                          <Text variant="ui" weight="medium" tone="default" truncate tooltipWhenTruncated>
                            {picture.title}
                          </Text>
                          <Text variant="meta" tone="muted" truncate tooltipWhenTruncated>
                            {picture.artist}, {picture.date}
                          </Text>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ),
        )}
      </div>
    </div>
  )
}

const styles = stylex.create({
  scroll: {
    flexGrow: 1,
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
  pills: { marginTop: spacing['--space-5'] },
  count: { marginInlineStart: spacing['--space-1-5'] },
  section: { marginTop: spacing['--space-7'] },
  heading: { margin: 0, marginBottom: spacing['--space-3'] },
  // Rows of one height: each picture grows by its width over height, so a row stays level as it fills the line.
  row: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: `${spacing['--space-6']} ${spacing['--space-5']}`,
    margin: 0,
    padding: 0,
    listStyle: 'none',
    // The last row keeps its pictures' sizes instead of stretching to the end.
    '::after': { content: "''", flexGrow: 1000 },
  },
  tile: { minWidth: 0 },
  share: (ratio: number) => ({
    flexGrow: ratio,
    flexBasis: `calc(${sizes['--gallery-row']} * ${ratio})`,
    maxWidth: `calc(${sizes['--gallery-row']} * ${ratio} * 1.5)`,
  }),
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
