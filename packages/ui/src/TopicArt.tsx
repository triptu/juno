import * as stylex from '@stylexjs/stylex'
import { useLayoutEffect, useRef } from 'react'
import { parseRecipe, pebbleHue, renderArt, renderPebble, type ArtSize } from '@juno/topic-art'
import { sizes as tokenSizes } from '@juno/tokens/tokens.stylex'
import { rootDuration } from './motion'

export type TopicArtSize = ArtSize

export interface TopicArtProps {
  /** The topic id. Seeds the placeholder, so the same topic shows the same pebble everywhere. */
  readonly topicId: string
  /**
   * The topic's art as a recipe (`TopicRow.art`, `TopicDetail.art`). Absent
   * shows the Tide placeholder. When it arrives, the placeholder fades out
   * under the art (opacity only, so nothing moves). The fade runs on the
   * clock from the moment the art arrived, so a row that renders later (it
   * was off screen, under `content-visibility`) shows the art at full
   * opacity. Art that is there on the first paint shows at once.
   */
  readonly recipe?: string | undefined
  /** 40 in rows, 20 in peek, 16 in tabs. */
  readonly size?: TopicArtSize
  /** Accessible name. Omit when the title is next to it; the art is decoration. */
  readonly label?: string
}

/** Rendered markup by size and recipe (or topic id for a pebble). A list redraws the same strings many times. */
const rendered = new Map<string, string>()
const CACHE_LIMIT = 2_000

function remember(key: string, make: () => string): string {
  const hit = rendered.get(key)
  if (hit !== undefined) return hit
  const markup = make()
  if (rendered.size >= CACHE_LIMIT) rendered.delete(rendered.keys().next().value!)
  rendered.set(key, markup)
  return markup
}

/**
 * The art for a recipe, or `undefined` when the stored text does not pass the
 * vocabulary: that topic keeps its pebble. Drawn in the topic's pebble hue,
 * not the recipe's, so the list spreads over every hue and the swap keeps
 * the pebble's colour.
 */
function artMarkup(topicId: string, recipe: string, size: TopicArtSize): string | undefined {
  const key = `${size}:${topicId}:${recipe}`
  const hit = rendered.get(key)
  if (hit !== undefined) return hit === '' ? undefined : hit
  const parsed = parseRecipe(recipe)
  const markup = parsed.ok && parsed.recipe.confident ? renderArt(parsed.recipe, size, pebbleHue(topicId)) : ''
  remember(key, () => markup)
  return markup === '' ? undefined : markup
}

/** `--duration-appear` and `--ease-out`, read from the root once, at the first fade. */
let fadeTiming: { readonly duration: number; readonly easing: string } | undefined
let reducedMotion: MediaQueryList | undefined

/**
 * Fades the placeholder layer between `from` and `to`. A Web Animation runs
 * on the document clock from the moment it is made, whether or not its
 * element renders. A CSS transition starts only when the element's style is
 * next computed, which `content-visibility` puts off until the row comes
 * near the view, so a row scrolled in later would play the fade then. Runs
 * only when art arrives or goes, never per scroll frame.
 */
function fade(layer: HTMLElement, from: number, to: number): void {
  reducedMotion ??= matchMedia('(prefers-reduced-motion: reduce)')
  if (reducedMotion.matches) return
  fadeTiming ??= {
    duration: rootDuration('--duration-appear'),
    easing: getComputedStyle(document.documentElement).getPropertyValue('--ease-out').trim() || 'ease-out',
  }
  layer.animate([{ opacity: from }, { opacity: to }], fadeTiming)
}

/**
 * A topic's tile: the AI drawing when the topic has one, the Tide pebble
 * until then (and while AI assist is off). Both are inline SVG rebuilt from
 * a whitelist by `@juno/topic-art`, never model text, with colours as CSS
 * variables so they follow the theme. The box is `size` square from the
 * first paint, and the swap changes opacity only, so a drawing that arrives
 * late moves nothing (performance 3.3).
 */
export function TopicArt({ topicId, recipe, size = 40, label }: TopicArtProps) {
  const art = recipe === undefined ? undefined : artMarkup(topicId, recipe, size)
  const pebble = remember(`${size}:pebble:${topicId}`, () => renderPebble(topicId, size))
  const hasArt = art !== undefined
  const pebbleLayer = useRef<HTMLSpanElement>(null)
  const shown = useRef(hasArt)
  useLayoutEffect(() => {
    if (shown.current === hasArt) return
    shown.current = hasArt
    if (pebbleLayer.current !== null) fade(pebbleLayer.current, hasArt ? 1 : 0, hasArt ? 0 : 1)
  }, [hasArt])
  return (
    <span role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} data-topic-art={art === undefined ? 'placeholder' : 'art'} {...stylex.props(styles.box, sizes[size])}>
      {/* Our own markup, rebuilt from the checked recipe (see @juno/topic-art); no model text reaches here. */}
      <span ref={pebbleLayer} {...stylex.props(styles.layer, hasArt && styles.hidden)} dangerouslySetInnerHTML={{ __html: pebble }} />
      {art === undefined ? null : <span {...stylex.props(styles.layer)} dangerouslySetInnerHTML={{ __html: art }} />}
    </span>
  )
}

const styles = stylex.create({
  box: {
    position: 'relative',
    display: 'inline-block',
    flexShrink: 0,
    verticalAlign: 'middle',
    userSelect: 'none',
    // Nothing inside has a layout effect outside the box.
    contain: 'strict',
  },
  // Both layers fill the box. The swap is opacity alone; `fade` animates it,
  // not a transition, because a transition starts only when the row renders.
  // That includes the 0.01ms one global.css gives everything under reduced
  // motion, which draws one frame of the old opacity.
  layer: {
    position: 'absolute',
    inset: 0,
    display: 'block',
    lineHeight: 0,
    opacity: 1,
    transitionProperty: 'none',
  },
  hidden: {
    opacity: 0,
  },
})

const sizes = stylex.create({
  40: { width: tokenSizes['--illustration-figure'], height: tokenSizes['--illustration-figure'] },
  20: { width: tokenSizes['--icon-20'], height: tokenSizes['--icon-20'] },
  16: { width: tokenSizes['--icon-16'], height: tokenSizes['--icon-16'] },
})
