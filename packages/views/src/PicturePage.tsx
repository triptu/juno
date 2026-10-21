import * as stylex from '@stylexjs/stylex'
import { CaretLeft } from '@phosphor-icons/react/dist/icons/CaretLeft'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { ImageSquare } from '@phosphor-icons/react/dist/icons/ImageSquare'
import { useId, type MouseEvent } from 'react'
import { accent, colors, sizes, spacing, text } from '@juno/tokens/tokens.stylex'
import { activateHandlers, Button, IconButton, Text, type ActivateEvent } from '@juno/ui'
import { PictureImage, type PictureCardView } from './PictureImage'

/** One fact of a picture's story. */
export interface PictureFactView {
  readonly text: string
}

/** A picture with its story (`@juno/pictures`'s `Picture` has these fields). */
export interface PictureStoryView extends PictureCardView {
  readonly culture?: string
  readonly medium: string
  readonly place: string
  readonly caption: string
  readonly facts: ReadonlyArray<PictureFactView>
  readonly credit: string
  readonly sourceUrl: string
}

export interface PicturePageProps {
  readonly picture: PictureStoryView
  /** The large file, else the small one scaled, else undefined while neither is on this Mac. */
  readonly src: string | undefined
  /** All pictures: the gallery, in this tab, or a new one with ⌘. */
  readonly onAllPictures: (event: ActivateEvent) => void
  /** The previous or next picture in the gallery's order. */
  readonly onStep: (step: -1 | 1) => void
  /** The picture credit's source page, opened in the browser. */
  readonly onOpenLink: (url: string) => void
}

/**
 * The picture page (SPEC 12, "Pictures and the gallery"): the picture as
 * large as the page allows, and beside it a column like a museum label:
 * the title, the artist, the date and medium, where it is, a caption, the
 * facts and the credit. Below about 900px of
 * width the label goes under the picture and the page scrolls.
 */
export function PicturePage({ picture, src, onAllPictures, onStep, onOpenLink }: PicturePageProps) {
  const titleId = useId()
  const link = (url: string) => (event: MouseEvent) => {
    event.preventDefault()
    onOpenLink(url)
  }
  return (
    <article aria-labelledby={titleId} data-picture-page={picture.id} {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.layout)}>
        <div {...stylex.props(styles.bar)}>
          <Button variant="secondary" size="sm" tone="subtle" iconStart={ImageSquare} {...activateHandlers<HTMLButtonElement>(onAllPictures)}>
            All pictures
          </Button>
          <span {...stylex.props(styles.steps)}>
            <IconButton icon={CaretLeft} label="Previous picture" shortcut="←" size={28} variant="secondary" tone="subtle" onClick={() => onStep(-1)} />
            <IconButton icon={CaretRight} label="Next picture" shortcut="→" size={28} variant="secondary" tone="subtle" onClick={() => onStep(1)} />
          </span>
        </div>
        <div {...stylex.props(styles.wall)}>
          <div {...stylex.props(styles.frame, styles.fit(picture.ratio))}>
            <PictureImage src={src} ratio={picture.ratio} />
          </div>
        </div>
        <div {...stylex.props(styles.label)}>
          <Text variant="emptyTitle" tone="default" as="h1" id={titleId} selectable sx={styles.title}>
            {picture.title}
          </Text>
          <Text variant="ui" weight="medium" tone="default" as="p" selectable sx={styles.artist}>
            {picture.culture === undefined ? picture.artist : `${picture.artist} · ${picture.culture}`}
          </Text>
          <Text variant="meta" tone="muted" as="p" selectable sx={styles.meta}>
            {picture.date} · {picture.medium}
          </Text>
          <Text variant="meta" tone="muted" as="p" selectable sx={styles.meta}>
            {picture.place}
          </Text>
          <p {...stylex.props(styles.caption)}>{picture.caption}</p>
          <ul {...stylex.props(styles.facts)}>
            {picture.facts.map((fact) => (
              <li key={fact.text} {...stylex.props(styles.fact)}>
                {fact.text}
              </li>
            ))}
          </ul>
          <footer {...stylex.props(styles.foot)}>
            <Text variant="meta" tone="muted" as="p" selectable sx={styles.meta}>
              {picture.credit} ·{' '}
              <a href={picture.sourceUrl} onClick={link(picture.sourceUrl)} {...stylex.props(styles.link)}>
                Source
              </a>
            </Text>
          </footer>
        </div>
      </div>
    </article>
  )
}

const NARROW = '@container picture (width < 900px)'

const styles = stylex.create({
  // A size container: the layout inside it reads the page's width.
  root: {
    display: 'flex',
    flexGrow: 1,
    minHeight: 0,
    width: '100%',
    containerType: 'size',
    containerName: 'picture',
  },
  // Wide: the picture on the left, the bar and the label in a column beside it. Narrow: the bar, the picture, then the label, and the page scrolls.
  layout: {
    display: 'grid',
    gridTemplateColumns: { default: `minmax(0, 1fr) ${sizes['--picture-label-width']}`, [NARROW]: 'minmax(0, 1fr)' },
    gridTemplateRows: { default: 'auto minmax(0, 1fr)', [NARROW]: 'auto 60% auto' },
    gridTemplateAreas: { default: '"wall bar" "wall label"', [NARROW]: '"bar" "wall" "label"' },
    width: '100%',
    height: '100%',
    overflowY: { default: 'hidden', [NARROW]: 'auto' },
  },
  // A size container, so the picture fits both its width and its height.
  wall: {
    gridArea: 'wall',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 0,
    minHeight: 0,
    padding: { default: spacing['--space-12'], [NARROW]: spacing['--space-6'] },
    paddingInline: spacing['--space-12'],
    containerType: 'size',
  },
  frame: { flexShrink: 0 },
  fit: (ratio: number) => ({ width: `min(100cqw, calc(100cqh * ${ratio}))` }),
  label: {
    gridArea: 'label',
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    overflowY: { default: 'auto', [NARROW]: 'visible' },
    paddingTop: { default: spacing['--space-8'], [NARROW]: spacing['--space-2'] },
    paddingBottom: spacing['--space-8'],
    paddingInlineStart: { default: 0, [NARROW]: spacing['--space-12'] },
    paddingInlineEnd: spacing['--space-12'],
  },
  bar: {
    gridArea: 'bar',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing['--space-8'],
    paddingInlineStart: { default: 0, [NARROW]: spacing['--space-12'] },
    paddingInlineEnd: spacing['--space-12'],
  },
  steps: { display: 'inline-flex', gap: spacing['--space-1'] },
  title: { margin: 0 },
  artist: { margin: 0, marginTop: spacing['--space-2-5'] },
  meta: { margin: 0, marginTop: spacing['--space-0-5'] },
  caption: {
    margin: 0,
    marginTop: spacing['--space-6'],
    fontFamily: text['--text-thought-family'],
    fontSize: text['--text-thought-size'],
    lineHeight: text['--text-thought-leading'],
    color: colors['--foreground-default'],
    userSelect: 'text',
  },
  facts: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-3'],
    margin: 0,
    marginTop: spacing['--space-4'],
    paddingInlineStart: spacing['--space-4'],
    fontFamily: text['--text-body-family'],
    fontSize: text['--text-body-size'],
    lineHeight: text['--text-body-leading'],
    color: colors['--foreground-secondary'],
    userSelect: 'text',
  },
  fact: { '::marker': { color: colors['--foreground-muted'] } },
  foot: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: spacing['--space-1'],
    marginTop: 'auto',
    paddingTop: spacing['--space-6'],
  },
  link: {
    color: accent['--hl-text'],
    textDecoration: { default: 'none', ':hover': 'underline' },
    cursor: 'default',
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineWidth: sizes['--focus-ring-width'],
    outlineColor: accent['--focus-ring'],
  },
})
