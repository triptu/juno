import * as stylex from '@stylexjs/stylex'
import { parseRecipe, renderArt, renderPebble, type ArtSize } from '@juno/topic-art'
import { motion } from '@juno/tokens/tokens.stylex'

export type TopicArtSize = ArtSize

export interface TopicArtProps {
  /** The topic id. Seeds the placeholder, so the same topic shows the same pebble everywhere. */
  readonly topicId: string
  /**
   * The topic's art as a recipe (`TopicRow.art`, `TopicDetail.art`). Absent
   * shows the Tide placeholder. When it arrives while the component is on
   * screen, the art fades in over the placeholder (opacity only, so nothing
   * moves); art that is there on the first paint shows at once.
   */
  readonly recipe?: string | undefined
  /** 40 in rows, 20 in the topic header, 16 in tabs. */
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

/** The art for a recipe, or `undefined` when the stored text does not pass the vocabulary: that topic keeps its pebble. */
function artMarkup(recipe: string, size: TopicArtSize): string | undefined {
  const key = `${size}:${recipe}`
  const hit = rendered.get(key)
  if (hit !== undefined) return hit === '' ? undefined : hit
  const parsed = parseRecipe(recipe)
  const markup = parsed.ok && parsed.recipe.confident ? renderArt(parsed.recipe, size) : ''
  remember(key, () => markup)
  return markup === '' ? undefined : markup
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
  const art = recipe === undefined ? undefined : artMarkup(recipe, size)
  const pebble = remember(`${size}:pebble:${topicId}`, () => renderPebble(topicId, size))
  return (
    <span role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} data-topic-art={art === undefined ? 'placeholder' : 'art'} {...stylex.props(styles.box, sizes[size])}>
      {/* Our own markup, rebuilt from the checked recipe (see @juno/topic-art); no model text reaches here. */}
      <span {...stylex.props(styles.layer, art !== undefined && styles.hidden)} dangerouslySetInnerHTML={{ __html: pebble }} />
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
  // Both layers fill the box; the cross-fade is opacity alone, 240ms, and the
  // duration token collapses to nothing under reduced motion. A layer that is
  // present on the first paint has no previous opacity to animate from.
  layer: {
    position: 'absolute',
    inset: 0,
    display: 'block',
    lineHeight: 0,
    opacity: 1,
    transitionProperty: 'opacity',
    transitionDuration: motion['--duration-appear'],
    transitionTimingFunction: motion['--ease-out'],
  },
  hidden: {
    opacity: 0,
  },
})

const sizes = stylex.create({
  40: { width: '40px', height: '40px' },
  20: { width: '20px', height: '20px' },
  16: { width: '16px', height: '16px' },
})
