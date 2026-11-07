import * as stylex from '@stylexjs/stylex'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Ref, type RefObject, type TextareaHTMLAttributes, type UIEvent } from 'react'
import { accent, colors, layout, radii, spacing, text } from '@juno/tokens/tokens.stylex'
import { chunk } from './chunks'
import { variants as typeVariants } from './internal/type'
import type { HueName } from './internal/hue'

export type TextareaVariant = 'inline' | 'card' | 'field'

/** A run of the text drawn as a chip (a picked @person or #channel) or as a link. */
export interface TextareaMark {
  readonly start: number
  readonly end: number
  readonly look: 'person' | 'channel' | 'link'
  /** The person's hue, as their avatar and message chips have it. */
  readonly hue?: HueName
}

export interface TextareaRange {
  readonly start: number
  readonly end: number
}

/** Slack's markup in the text, drawn as it will look (`markupLayout` in `@juno/richtext`). */
export interface TextareaFormat {
  /** Styled runs, without their markers, except that a code run takes in its backticks or fences. */
  readonly spans: ReadonlyArray<TextareaRange & { readonly style: 'bold' | 'italic' | 'strike' | 'code' }>
  /** Marker characters, drawn dimmed. */
  readonly markers: ReadonlyArray<TextareaRange>
  /** Code blocks, fences included: the lines wholly inside one are drawn as one tinted block. */
  readonly codeBlocks: ReadonlyArray<TextareaRange>
  /** Quote lines, drawn as messages draw a quote. */
  readonly quotes: ReadonlyArray<TextareaRange>
}

/** The `field` variant's growth limit: 8 lines of ui text (13.5 × 1.5), its 6px insets and its border. */
const FIELD_MAX_HEIGHT = '176px' // tokens-allow: One component's growth limit.

export interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'style' | 'className' | 'value'> {
  /**
   * `inline`: no border of its own, grows with its content to a maximum and
   * then scrolls (composer). `card`: a bordered block on the page background
   * inside a card (send card). `field`: drawn like a 32px TextField, and
   * grows with its content to 8 lines and then scrolls
   * (a note on What Juno remembers).
   */
  readonly variant?: TextareaVariant
  /** For `inline`: the growth limit. */
  readonly maxHeight?: 'composer' | 'assistant'
  readonly label?: string
  /** The element, for an owner that focuses it (⌘J on the Juno composer). */
  readonly ref?: Ref<HTMLTextAreaElement>
  readonly value?: string
  /**
   * For `inline`: runs of the text drawn as chips. With it the text is drawn
   * by a layer under the field, which keeps its caret, selection and input.
   */
  readonly marks?: ReadonlyArray<TextareaMark>
  /**
   * For `inline`: Slack's markup, drawn by the same layer as `marks`. Every
   * look keeps each glyph's width: bold is a stroke, italic the field
   * font's slant, code a tint in the field font.
   */
  readonly format?: TextareaFormat
  /** With `marks` or `format`: the character at this offset is the `TEXTAREA_ANCHOR`. */
  readonly anchorAt?: number
}

/**
 * A multi-line input. The inline variant grows with its content through
 * `field-sizing: content`, so no layout is read on a keystroke.
 *
 * With `marks` or `format` the field's own text is transparent and a layer
 * under it draws the same text in the same box, with the marked runs as
 * chips and the markup styled (`TextareaLines`). Nothing it draws changes a
 * glyph's width: chips give their inset back with a negative margin, and
 * the markup's looks keep the field's font and widths. So every glyph sits
 * where the field's caret and selection expect it. The layer follows the
 * field's scroll.
 */
// Line and chip drawing loads as soon as a layered field mounts.
let lines: typeof import('./TextareaLines') | undefined
const lineDrawing = chunk(() => import('./TextareaLines').then((module) => (lines = module)))

export function Textarea({ variant = 'inline', maxHeight = 'composer', label, rows, marks, format, anchorAt, onScroll, ref, ...rest }: TextareaProps) {
  'use no memo' // The value changes on every keystroke; keep the wrapper small and drawing in its chunk.
  const layered = marks !== undefined || format !== undefined
  const formatted = format !== undefined
  const linesReady = lineDrawing.useReady()
  useEffect(() => {
    if (!layered) return
    void lineDrawing.load()
  }, [layered])
  const layer = useRef<HTMLDivElement>(null)
  // Scrolled down at all: the top fade shows. Set only when it changes, so scrolling re-renders twice at most.
  const [scrolled, setScrolled] = useState(false)
  const own = useRef<HTMLTextAreaElement | null>(null)
  // Text the field opens with (a saved draft, a message to edit) takes typing at its end, not before it.
  useLayoutEffect(() => {
    const element = own.current
    if (element !== null) element.setSelectionRange(element.value.length, element.value.length)
  }, [])
  const attach = useCallback(
    (node: HTMLTextAreaElement | null) => {
      own.current = node
      setRef(ref, node)
    },
    [ref],
  )
  const field = (
    <textarea
      ref={attach}
      aria-label={label}
      rows={rows ?? (variant === 'card' ? 2 : 1)}
      {...rest}
      {...(variant !== 'inline'
        ? { onScroll }
        : {
            onScroll: (event: UIEvent<HTMLTextAreaElement>) => {
              if (layer.current !== null) layer.current.scrollTop = event.currentTarget.scrollTop
              setScrolled(event.currentTarget.scrollTop > 0)
              onScroll?.(event)
            },
          })}
      {...stylex.props(styles.base, variants[variant], variant === 'field' && typeVariants.ui, variant === 'inline' && maxHeights[maxHeight], variant === 'inline' && scrolled && styles.topFade, layered && styles.inkless)}
    />
  )
  if (!layered) return field
  return (
    <div {...stylex.props(styles.marked)}>
      <div ref={layer} dir={rest.dir} aria-hidden data-textarea-layer="" {...stylex.props(variants.inline, scrolled && styles.topFade, styles.layer)}>
        {linesReady && lines !== undefined ? (formatted ? lines.drawnLines(rest.value ?? '', marks ?? [], format, anchorAt) : lines.drawn(rest.value ?? '', marks ?? [], anchorAt)) : (rest.value ?? '') + (rest.value?.endsWith('\n') ? '\u200b' : '')}
      </div>
      {field}
    </div>
  )
}

function setRef(ref: Ref<HTMLTextAreaElement> | undefined, node: HTMLTextAreaElement | null): void {
  if (typeof ref === 'function') ref(node)
  else if (ref !== undefined && ref !== null) (ref as RefObject<HTMLTextAreaElement | null>).current = node
}

/** How far a scrolled composer's text fades under its top edge. */
const TOP_FADE = spacing['--space-4']

const styles = stylex.create({
  base: {
    display: 'block',
    width: '100%',
    margin: 0,
    boxSizing: 'border-box',
    backgroundColor: colors['--surface-default'],
    color: colors['--foreground-default'],
    outline: 'none',
    userSelect: 'text',
    cursor: 'text',
    '::placeholder': {
      color: colors['--foreground-muted'],
      opacity: 1,
    },
  },
  // The wrapper takes the field's place in its row; the field stays in flow and sets the height.
  marked: {
    position: 'relative',
    width: '100%',
    minWidth: 0,
  },
  // The field keeps its caret and selection; the layer under it draws the text.
  inkless: {
    position: 'relative',
    color: 'transparent',
    caretColor: colors['--foreground-default'],
    // The selection's fill covers the layer, so the field draws the selected text itself.
    '::selection': {
      color: colors['--foreground-default'],
    },
  },
  // Scrolled, a line under the top edge fades out over 16px instead of being cut at the frame. A static mask, set
  // while the field is scrolled at all: a field at its top fades nothing, and no animation runs on the field. The
  // layer that draws marked text takes it too, and scrolls with the field.
  topFade: {
    maskImage: `linear-gradient(to bottom, transparent, black ${TOP_FADE})`, // tokens-allow: a mask's alpha, not a colour that shows.
  },
  layer: {
    unicodeBidi: 'plaintext',
    position: 'absolute',
    inset: 0,
    boxSizing: 'border-box',
    color: colors['--foreground-default'],
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    // It overflows exactly when the field does, so a classic scrollbar narrows both alike.
    overflowY: 'auto',
    scrollbarColor: 'transparent transparent',
    pointerEvents: 'none',
    userSelect: 'none',
  },
})

const variants = stylex.create({
  inline: {
    // 8 + 22 + 8 and the frame's 1px border = the 40px single-line composer. The frame keeps this box inside its
    // border, so a scrolled line is cut below the border.
    paddingBlock: layout['--composer-padding-block'],
    paddingInline: spacing['--space-1'],
    borderWidth: 0,
    backgroundColor: 'transparent',
    fontFamily: text['--text-body-family'],
    fontSize: text['--text-body-size'],
    lineHeight: layout['--composer-line-height'],
    letterSpacing: text['--text-body-tracking'],
    resize: 'none',
    fieldSizing: 'content',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
  },
  card: {
    paddingBlock: spacing['--space-2'],
    paddingInline: spacing['--space-2-5'],
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: {
      default: colors['--input-border'],
      ':focus': accent['--focus-ring'],
    },
    borderRadius: radii['--radius-lg'],
    backgroundColor: colors['--background'],
    fontFamily: text['--text-body-family'],
    fontSize: text['--text-body-size'],
    lineHeight: text['--text-body-small-leading'],
    letterSpacing: text['--text-body-tracking'],
    resize: 'none',
  },
  // The 32px TextField's border, radius, inset and text, on more than one line.
  field: {
    paddingBlock: spacing['--space-1-5'],
    paddingInline: spacing['--space-2-5'],
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: {
      default: colors['--input-border'],
      ':focus': accent['--focus-ring'],
    },
    borderRadius: radii['--radius-md-plus'],
    letterSpacing: text['--text-ui-tracking'],
    resize: 'none',
    fieldSizing: 'content',
    maxHeight: FIELD_MAX_HEIGHT,
    overflowY: 'auto',
    overscrollBehavior: 'contain',
  },
})

const maxHeights = stylex.create({
  composer: { maxHeight: layout['--composer-max-height'] },
  assistant: { maxHeight: layout['--assistant-input-max-height'] },
})
