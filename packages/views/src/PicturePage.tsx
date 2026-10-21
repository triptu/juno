import * as stylex from '@stylexjs/stylex'
import { ArrowUpRight } from '@phosphor-icons/react/dist/icons/ArrowUpRight'
import { CaretLeft } from '@phosphor-icons/react/dist/icons/CaretLeft'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { ImageSquare } from '@phosphor-icons/react/dist/icons/ImageSquare'
import { useId, type MouseEvent } from 'react'
import { accent, colors, sizes, spacing, text } from '@juno/tokens/tokens.stylex'
import { activateHandlers, Button, Icon, IconButton, Text, type ActivateEvent } from '@juno/ui'
import { PictureImage, type PictureCardView } from './PictureImage'
import type { PictureLineView } from './PictureLine'
import { PictureScale, type PictureScaleView } from './PictureScale'

/** A picture with its words (`@juno/pictures`'s `Picture` has these fields). */
export interface PictureStoryView extends PictureCardView {
  readonly culture?: string
  readonly medium: string
  readonly place: string
  /** What the picture shows, for screen readers. */
  readonly caption: string
  readonly line: PictureLineView & { readonly context?: string }
  readonly about: string
  /** The one page to read more, labelled with the institution. */
  readonly learnMore: { readonly label: string; readonly url: string }
  readonly scale?: PictureScaleView
  readonly credit: string
}

export interface PicturePageProps {
  readonly picture: PictureStoryView
  /** The large file, else the small one scaled, else undefined while neither is on this Mac. */
  readonly src: string | undefined
  /** All pictures: the gallery, in this tab, or a new one with ⌘. */
  readonly onAllPictures: (event: ActivateEvent) => void
  /** The previous or next picture in the gallery's order. */
  readonly onStep: (step: -1 | 1) => void
  /** The page to read more, opened in the browser. */
  readonly onOpenLink: (url: string) => void
}

/**
 * The picture page (SPEC 12, "Pictures and the gallery"): the picture as
 * large as the page allows, whole, and beside it a column like a museum
 * wall text: the title, the artist, the date and medium, where it is; the
 * picture's line, larger, with who said it and when; a short paragraph
 * about it; how big or how far, where that is known; and at the foot one
 * link to read more, labelled with the institution, over the credit.
 * Below about 900px of width the label goes under the picture and the page
 * scrolls.
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
            <PictureImage src={src} ratio={picture.ratio} alt={picture.caption} />
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
          <blockquote data-picture-page-line="" {...stylex.props(styles.lead)}>
            {picture.line.by === undefined ? picture.line.text : `“${picture.line.text}”`}
          </blockquote>
          {picture.line.by === undefined && picture.line.context === undefined ? null : (
            <Text variant="meta" tone="muted" as="p" selectable sx={styles.said}>
              {saidOf(picture.line)}
            </Text>
          )}
          <Text variant="body" tone="secondary" as="p" selectable sx={styles.about}>
            {picture.about}
          </Text>
          {picture.scale === undefined ? null : <PictureScale scale={picture.scale} src={src} />}
          <footer {...stylex.props(styles.foot)}>
            <a data-picture-learn-more="" href={picture.learnMore.url} onClick={link(picture.learnMore.url)} {...stylex.props(styles.link)}>
              {picture.learnMore.label}
              <Icon icon={ArrowUpRight} size={12} />
            </a>
            <Text variant="meta" tone="muted" as="p" selectable sx={styles.meta}>
              {picture.credit}
            </Text>
          </footer>
        </div>
      </div>
    </article>
  )
}

/**
 * The quiet line under the page's line: who said it and the context clause
 * ("Louis Leroy, in Le Charivari, 1874, of this picture."), or a fact's
 * context alone as a sentence. Ends with a full stop.
 */
function saidOf(line: PictureStoryView['line']): string {
  const said = line.by === undefined ? (line.context ?? '') : line.context === undefined ? line.by : `${line.by}, ${line.context}`
  const sentence = said.charAt(0).toUpperCase() + said.slice(1)
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`
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
  // The line leads the words: the serif at 24.
  lead: {
    margin: 0,
    marginTop: spacing['--space-6'],
    fontFamily: text['--text-picture-line-family'],
    fontSize: text['--text-picture-lead-size'],
    fontWeight: text['--text-picture-line-weight'],
    lineHeight: text['--text-picture-lead-leading'],
    color: colors['--foreground-default'],
    textWrap: 'pretty',
    userSelect: 'text',
  },
  said: { margin: 0, marginTop: spacing['--space-2'] },
  about: { margin: 0, marginTop: spacing['--space-4'] },
  foot: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: spacing['--space-0-5'],
    marginTop: 'auto',
    paddingTop: spacing['--space-6'],
  },
  // A link that opens outside the app: the pointer cursor, as a link in a message has (CLAUDE.md).
  link: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-1'],
    fontFamily: text['--text-ui-family'],
    fontSize: text['--text-ui-size'],
    lineHeight: text['--text-ui-leading'],
    color: accent['--hl-text'],
    textDecoration: { default: 'none', ':hover': 'underline' },
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineWidth: sizes['--focus-ring-width'],
    outlineColor: accent['--focus-ring'],
  },
})
