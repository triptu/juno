import * as stylex from '@stylexjs/stylex'
import { Fragment, useEffect, useLayoutEffect, useRef } from 'react'
import { accent, colors, radii, sizes, spacing, text } from '@juno/tokens/tokens.stylex'
import { activateHandlers, Button, FilterPill, PillRow, Text, type ActivateEvent } from '@juno/ui'
import { PictureImage, pictureLift, type PictureCardView } from './PictureImage'

export type GalleryKind = PictureCardView['kind']
/** The quotes, or the facts: words to read, after the pictures. */
export type GalleryWords = 'quotes' | 'facts'
/** All is every picture; the quotes and the facts have a pill each. */
export type GalleryFilter = 'all' | GalleryKind | GalleryWords

export type GalleryTheme = 'focus' | 'thinking' | 'wonder' | 'life' | 'made' | 'art'

/** A quote (with who said it) or a fact (without). Its source is never shown (SPEC 12). */
export interface GalleryThoughtView {
  readonly text: string
  readonly by?: string
  readonly theme: GalleryTheme
}

/** The quotes' and facts' sections, in order, with their names. */
export const GALLERY_THEMES: ReadonlyArray<{ readonly theme: GalleryTheme; readonly name: string }> = [
  { theme: 'focus', name: 'Focus and craft' },
  { theme: 'thinking', name: 'Thinking deeply' },
  { theme: 'wonder', name: 'Wonder at the universe' },
  { theme: 'life', name: 'Life' },
  { theme: 'made', name: 'Things made' },
  { theme: 'art', name: 'Art and beauty' },
]

const WORDS: ReadonlyArray<{ readonly words: GalleryWords; readonly name: string }> = [
  { words: 'quotes', name: 'Quotes' },
  { words: 'facts', name: 'Facts' },
]

const isQuote = (thought: GalleryThoughtView) => thought.by !== undefined
const wordsOf = (thoughts: ReadonlyArray<GalleryThoughtView>, words: GalleryWords) => thoughts.filter((thought) => isQuote(thought) === (words === 'quotes'))

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
  /** Every quote and fact, in the list's order. */
  readonly thoughts: ReadonlyArray<GalleryThoughtView>
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
 * file keeps its box, so the rows never move when one lands. The Quotes and
 * Facts pills show the words instead, in sections by theme.
 */
export function Gallery({ pictures, thoughts, sources, current, filter, onFilter, onOpen, onNear, scrollTop, onScroll }: GalleryProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const near = useRef(onNear)
  near.current = onNear
  const words = filter === 'quotes' || filter === 'facts' ? filter : undefined
  const sections = GALLERY_SECTIONS.filter((section) => words === undefined && (filter === 'all' || section.kind === filter)).map((section) => ({
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
          A thousand years of paintings, prints and studies of nature, and pictures of space that make them look recent.
        </Text>
        <GalleryPills pictures={pictures} thoughts={thoughts} filter={filter} onFilter={onFilter} />
        {words === undefined ? null : <GalleryWordList thoughts={wordsOf(thoughts, words)} words={words} />}
        {sections.map((section) =>
          section.pictures.length === 0 ? null : (
            <section key={section.kind} aria-label={section.name} {...stylex.props(styles.section)}>
              {filter === 'all' ? (
                <Text variant="sectionLabel" tone="muted" as="h2" sx={styles.heading}>
                  {section.name}
                </Text>
              ) : null}
              <ul {...stylex.props(styles.row)}>
                {section.pictures.map((picture) => (
                  <GalleryTile key={picture.id} picture={picture} src={sources[picture.id]} current={picture.id === current} onOpen={onOpen} />
                ))}
              </ul>
            </section>
          ),
        )}
      </div>
    </div>
  )
}

/** All, then each kind, with its count; then, a step apart, Quotes and Facts. */
function GalleryPills({ pictures, thoughts, filter, onFilter }: Pick<GalleryProps, 'pictures' | 'thoughts' | 'filter' | 'onFilter'>) {
  const pills: ReadonlyArray<{ readonly filter: GalleryFilter; readonly name: string; readonly count: number }> = [
    { filter: 'all', name: 'All', count: pictures.length },
    ...GALLERY_SECTIONS.map((section) => ({ filter: section.kind, name: section.name, count: pictures.filter((picture) => picture.kind === section.kind).length })),
    ...WORDS.map((entry) => ({ filter: entry.words, name: entry.name, count: wordsOf(thoughts, entry.words).length })),
  ]
  return (
    <div {...stylex.props(styles.pills)}>
      <PillRow aria-label="Show">
        {pills.map((pill) => (
          <Fragment key={pill.filter}>
            {/* The words are not pictures: a step of room sets them apart from All and the kinds. */}
            {pill.filter === 'quotes' ? <span aria-hidden {...stylex.props(styles.pillStep)} /> : null}
            <FilterPill>
              <Button variant="filter" pressed={filter === pill.filter} {...activateHandlers<HTMLButtonElement>(() => onFilter(pill.filter))}>
                {pill.name}
                <Text variant="inherit" tone="muted" numeric sx={styles.count}>
                  {pill.count}
                </Text>
              </Button>
            </FilterPill>
          </Fragment>
        ))}
      </PillRow>
    </div>
  )
}

/**
 * The quotes or the facts, in sections by theme: set as the picture page
 * sets its words, a quote in the serif of its caption with who said it on
 * a quiet line under it, a fact in the body text of its facts. In columns
 * of the picture page's label width, as many as the page holds.
 */
function GalleryWordList({ thoughts, words }: { readonly thoughts: ReadonlyArray<GalleryThoughtView>; readonly words: GalleryWords }) {
  return GALLERY_THEMES.map(({ theme, name }) => {
    const entries = thoughts.filter((thought) => thought.theme === theme)
    if (entries.length === 0) return null
    return (
      <section key={theme} aria-label={name} data-gallery-words={words} {...stylex.props(styles.section)}>
        <Text variant="sectionLabel" tone="muted" as="h2" sx={styles.heading}>
          {name}
        </Text>
        <ul {...stylex.props(styles.wordList)}>
          {entries.map((entry) =>
            entry.by === undefined ? (
              <li key={entry.text} data-gallery-fact="" {...stylex.props(styles.entry)}>
                <Text variant="body" tone="secondary" as="p" selectable>
                  {entry.text}
                </Text>
              </li>
            ) : (
              <li key={entry.text} data-gallery-quote="" {...stylex.props(styles.entry)}>
                <blockquote {...stylex.props(styles.quote)}>{entry.text}</blockquote>
                <Text variant="meta" tone="muted" as="p" selectable sx={styles.by}>
                  {entry.by}
                </Text>
              </li>
            ),
          )}
        </ul>
      </section>
    )
  })
}

/** One picture on the wall: its box at its shape, its title and "artist, date" under it. */
function GalleryTile({ picture, src, current, onOpen }: { readonly picture: PictureCardView; readonly src: string | undefined; readonly current: boolean; readonly onOpen: GalleryProps['onOpen'] }) {
  return (
    <li data-gallery-picture={picture.id} data-gallery-missing={src === undefined ? '' : undefined} {...stylex.props(styles.tile, styles.share(picture.ratio))}>
      <button
        type="button"
        aria-label={`${picture.title}, ${picture.artist}, ${picture.date}`}
        aria-current={current ? 'true' : undefined}
        {...activateHandlers<HTMLButtonElement>((event) => onOpen(picture.id, event))}
        {...stylex.props(styles.open, pictureLift)}
      >
        <span {...stylex.props(styles.frame, current && styles.current)}>
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
  pillStep: { flexShrink: 0, width: spacing['--space-3'] },
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
  // Columns of the picture page's label width, as many as fit; an entry never breaks across two.
  wordList: {
    columnWidth: sizes['--picture-label-width'],
    columnGap: spacing['--space-8'],
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  // At most the label's width, so a line keeps a reading length however wide its column is.
  entry: {
    maxWidth: sizes['--picture-label-width'],
    breakInside: 'avoid',
    contain: 'content',
    paddingBottom: spacing['--space-5'],
  },
  quote: {
    margin: 0,
    fontFamily: text['--text-thought-family'],
    fontSize: text['--text-thought-size'],
    fontWeight: text['--text-thought-weight'],
    lineHeight: text['--text-thought-leading'],
    letterSpacing: text['--text-thought-tracking'],
    color: colors['--foreground-default'],
    userSelect: 'text',
  },
  by: { marginTop: spacing['--space-1'] },
})
