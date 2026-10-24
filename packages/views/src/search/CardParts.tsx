/**
 * Parts of a Search card (SPEC 10a, "Cards"): the message folded with its
 * first match in view, a file as a quiet chip, and a title with its matched
 * words marked.
 */
import * as stylex from '@stylexjs/stylex'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { FileView, MessageBody as MessageBodyModel } from '@juno/contract'
import { accent, colors, layout, radii, sizes, spacing, text, weights } from '@juno/tokens/tokens.stylex'
import { hueForId, Icon, type ActivateEvent } from '@juno/ui'
import { fileCardIcon, fileMeta } from '../FileCard'
import { MessageBody } from '../MessageBody'
import type { LinkInfo } from '../MessageLink'
import { matchRanges } from './marks'

type Cut = { readonly top: boolean; readonly bottom: boolean } | undefined

/**
 * Folds `element` at its maximum height, scrolled so the first matched word
 * sits two lines under the top. Returns which edges hide more, or undefined
 * when the message fits.
 */
function fold(element: HTMLElement, words: ReadonlyArray<string>): Cut {
  if (element.scrollHeight <= element.clientHeight + 1) {
    element.scrollTop = 0
    return undefined
  }
  const first = matchRanges(element, words)[0]
  const lead = 2 * (Number.parseFloat(getComputedStyle(element).lineHeight) || 0)
  const top = first === undefined ? 0 : first.getBoundingClientRect().top - element.getBoundingClientRect().top + element.scrollTop
  const end = element.scrollHeight - element.clientHeight
  element.scrollTop = Math.max(0, Math.min(end, top - lead))
  return { top: element.scrollTop > 0, bottom: element.scrollTop < end - 1 }
}

/**
 * The message, folded at `--search-fold` when it is longer. Folded, it shows
 * the part with the first matched word, two lines under the fold's top; a
 * fade says there is more above or below. Show more unfolds it in place.
 * It folds again whenever its width or its content changes.
 */
export function FoldedBody({ body, now, words, onLink, linkInfo }: { readonly body: MessageBodyModel; readonly now: number; readonly words: ReadonlyArray<string>; readonly onLink?: ((url: string, event: ActivateEvent) => void) | undefined; readonly linkInfo?: LinkInfo | undefined }) {
  const box = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [cut, setCut] = useState<Cut>(undefined)
  const key = words.join('\n')
  useLayoutEffect(() => {
    const element = box.current
    if (element === null || open) return
    const list = key === '' ? [] : key.split('\n')
    const update = () => {
      const next = fold(element, list)
      setCut((current) => (current?.top === next?.top && current?.bottom === next?.bottom ? current : next))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    if (element.firstElementChild !== null) observer.observe(element.firstElementChild)
    return () => observer.disconnect()
  }, [key, open])
  return (
    <>
      <div ref={box} data-search-body="" data-sensitive="" data-folded={cut !== undefined && !open ? '' : undefined} {...stylex.props(styles.body, !open && styles.folded, !open && cut?.top === true && styles.cutTop, !open && cut?.bottom === true && styles.cutBottom, !open && cut?.top === true && cut.bottom && styles.cutBoth)}>
        <MessageBody body={body} now={now} hueOf={hueForId} onLink={onLink} linkInfo={linkInfo} />
      </div>
      {cut === undefined && !open ? null : (
        // Unfolding grows the card in place, which the press asked for. A press leaves focus where it was, so the card
        // around it is not selected by taking focus.
        <span data-expands-in-place="" {...stylex.props(styles.moreSlot)}>
          <button type="button" tabIndex={-1} aria-expanded={open} data-search-more="" onMouseDown={(event) => event.preventDefault()} onClick={() => setOpen((value) => !value)} {...stylex.props(styles.more)}>
            {open ? 'Show less' : 'Show more'}
          </button>
        </span>
      )}
    </>
  )
}

/** A file as a quiet chip: its kind's icon, its name, and its kind and size. The panel shows the file itself. */
export function FileChip({ file }: { readonly file: FileView }) {
  return (
    <span {...stylex.props(styles.file)}>
      <span {...stylex.props(styles.fileIcon)}>
        <Icon icon={fileCardIcon(file)} size={14} />
      </span>
      <span data-sensitive="" {...stylex.props(styles.fileName)}>
        {file.kind === 'deleted' ? 'File deleted' : file.name}
      </span>
      {file.kind === 'deleted' ? null : <span {...stylex.props(styles.fileMeta)}>{fileMeta(file)}</span>}
    </span>
  )
}

/** Text with the matched words marked. Ranges out of order or out of bounds are left plain. */
export function Marked({ text: value, ranges }: { readonly text: string; readonly ranges: ReadonlyArray<{ readonly start: number; readonly end: number }> }) {
  if (ranges.length === 0) return value
  const parts: ReactNode[] = []
  let at = 0
  for (const { start, end } of ranges) {
    if (start < at || end > value.length || end <= start) continue
    if (start > at) parts.push(value.slice(at, start))
    parts.push(
      <mark key={start} data-match="" {...stylex.props(styles.match)}>
        {value.slice(start, end)}
      </mark>,
    )
    at = end
  }
  if (at < value.length) parts.push(value.slice(at))
  return <>{parts}</>
}

const FADE = '24px' // tokens-allow: the fold's fade, about one line

const styles = stylex.create({
  body: {
    marginTop: spacing['--space-0-5'],
    overflow: 'hidden',
  },
  folded: {
    maxHeight: layout['--search-fold'],
  },
  cutTop: {
    maskImage: `linear-gradient(to bottom, transparent, black ${FADE})`, // tokens-allow: a mask's alpha, not a colour that shows.
  },
  cutBottom: {
    maskImage: `linear-gradient(to top, transparent, black ${FADE})`, // tokens-allow: a mask's alpha, not a colour that shows.
  },
  cutBoth: {
    maskImage: `linear-gradient(to bottom, transparent, black ${FADE}, black calc(100% - ${FADE}), transparent)`, // tokens-allow: a mask's alpha, not a colour that shows.
  },
  moreSlot: {
    display: 'flex',
    alignSelf: 'flex-start',
    marginTop: spacing['--space-1'],
  },
  more: {
    height: sizes['--control-24'],
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    color: colors['--foreground-subtle'],
    fontFamily: 'inherit',
    fontSize: text['--text-meta-size'],
    fontWeight: weights['--weight-semibold'],
    cursor: 'default',
  },
  file: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
    maxWidth: '100%',
    height: sizes['--control-32'],
    paddingInlineStart: spacing['--space-2'],
    paddingInlineEnd: spacing['--space-3'],
    borderWidth: spacing['--space-pixel'],
    borderStyle: 'solid',
    borderColor: colors['--border-strong'],
    borderRadius: radii['--radius-lg'],
  },
  fileIcon: {
    display: 'flex',
    flexShrink: 0,
    color: colors['--foreground-subtle'],
  },
  fileName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: text['--text-ui-size'],
    fontWeight: weights['--weight-medium'],
  },
  fileMeta: {
    flexShrink: 0,
    whiteSpace: 'nowrap',
    fontSize: text['--text-tag-small-size'],
    color: colors['--foreground-muted'],
  },
  // A title's matched words: the search mark, as CSS highlights draw it in message text.
  match: {
    backgroundColor: accent['--find'],
    color: accent['--find-fg'],
    borderRadius: radii['--radius-inline'],
  },
})
