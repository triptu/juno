// The recipe vocabulary as a user of the package sees it: a model reply in,
// a checked recipe or a quotable reason out; the canonical text reads back
// unchanged; and nothing hostile in a reply reaches the rendered markup.
import { describe, expect, it } from 'bun:test'
import { countElements, HUE_NAMES, parseRecipe, pebbleHue, pebbleShape, renderArt, renderPebble, serialiseRecipe, type Recipe } from '../src/index'

const database = `<svg viewBox="0 0 40 40" data-hue="teal">
  <path d="M9 11 V29 A11 4.5 0 0 0 31 29 V11"/>
  <path d="M9 20 A11 4.5 0 0 0 31 20" detail="1"/>
  <ellipse cx="20" cy="11" rx="11" ry="4.5" fill="soft"/>
  <circle cx="26" cy="29" r="2" fill="accent" stroke="none" detail="1"/>
</svg>`

function parsed(text: string): Recipe {
  const result = parseRecipe(text)
  if (!result.ok) throw new Error(result.reason)
  return result.recipe
}

const reasonOf = (text: string): string => {
  const result = parseRecipe(text)
  return result.ok ? 'accepted' : result.reason
}

describe('parsing a reply', () => {
  it('reads the hue, the confidence and the shapes of a valid drawing', () => {
    const recipe = parsed(database)
    expect(recipe.hue).toBe('teal')
    expect(recipe.confident).toBe(true)
    expect(countElements(recipe)).toBe(4)
    expect(recipe.elements.map((element) => element.tag)).toEqual(['path', 'path', 'ellipse', 'circle'])
  })

  it('ignores prose and fences around the one svg, and reads data-confident', () => {
    const reply = `Here is the icon:\n\`\`\`svg\n<svg viewBox="0 0 40 40" data-hue="amber" data-confident="false"><circle cx="20" cy="20" r="10" fill="soft"/></svg>\n\`\`\``
    const recipe = parsed(reply)
    expect(recipe.hue).toBe('amber')
    expect(recipe.confident).toBe(false)
  })

  it('reads the canonical text back as the same recipe', () => {
    const recipe = parsed(database)
    const text = serialiseRecipe(recipe)
    expect(parsed(text)).toEqual(recipe)
    expect(serialiseRecipe(parsed(text))).toBe(text)
  })

  it('accepts groups two deep with the group attributes, and nothing deeper', () => {
    const two = `<svg viewBox="0 0 40 40" data-hue="sage"><g transform="rotate(10 20 20)"><g opacity="0.5"><rect x="8" y="8" width="24" height="24" rx="4"/></g></g></svg>`
    expect(countElements(parsed(two))).toBe(1)
    const three = `<svg viewBox="0 0 40 40" data-hue="sage"><g><g><g><rect x="8" y="8" width="24" height="24"/></g></g></g></svg>`
    expect(reasonOf(three)).toBe('groups nest deeper than 2')
  })

  it.each([
    ['no svg', 'a circle', 'no <svg> element found'],
    ['a hex hue', '<svg data-hue="#ff0000"><circle cx="20" cy="20" r="5"/></svg>', /data-hue must be one of/],
    ['a script element', '<svg data-hue="teal"><script>alert(1)</script><circle cx="20" cy="20" r="5"/></svg>', 'element <script> is not allowed'],
    ['text content', '<svg data-hue="teal"><text x="1" y="1">hi</text></svg>', 'element <text> is not allowed'],
    ['stray text', '<svg data-hue="teal"><circle cx="20" cy="20" r="5"/>hello</svg>', /text content is not allowed/],
    ['a use with href', '<svg data-hue="teal"><use href="#x"/></svg>', 'element <use> is not allowed'],
    ['an image', '<svg data-hue="teal"><image href="https://x/y.png"/></svg>', 'element <image> is not allowed'],
    ['foreignObject', '<svg data-hue="teal"><foreignObject><div/></foreignObject></svg>', 'element <foreignobject> is not allowed'],
    ['a style element', '<svg data-hue="teal"><style>*{fill:red}</style><circle cx="20" cy="20" r="5"/></svg>', 'element <style> is not allowed'],
    ['an event handler', '<svg data-hue="teal"><circle cx="20" cy="20" r="5" onload="alert(1)"/></svg>', 'attribute onload is not allowed on <circle>'],
    ['a style attribute', '<svg data-hue="teal"><circle cx="20" cy="20" r="5" style="fill:red"/></svg>', 'attribute style is not allowed on <circle>'],
    ['an id', '<svg data-hue="teal"><circle id="x" cx="20" cy="20" r="5"/></svg>', 'attribute id is not allowed on <circle>'],
    ['a hex fill', '<svg data-hue="teal"><circle cx="20" cy="20" r="5" fill="#ff0000"/></svg>', /fill must be one of ink, soft, accent, accent2, none/],
    ['a url fill', '<svg data-hue="teal"><circle cx="20" cy="20" r="5" fill="url(javascript:alert(1))"/></svg>', /fill must be one of/],
    ['a named colour stroke', '<svg data-hue="teal"><circle cx="20" cy="20" r="5" stroke="red"/></svg>', /stroke must be one of/],
    ['path data with letters outside the grammar', '<svg data-hue="teal"><path d="M0 0 url(x)"/></svg>', 'path d has characters outside the path grammar'],
    ['path data with a quote', '<svg data-hue="teal"><path d="M0 0&quot;onload=&quot;x"/></svg>', 'path d has characters outside the path grammar'],
    ['a coordinate off the grid', '<svg data-hue="teal"><circle cx="200" cy="20" r="5"/></svg>', 'cx=200 is off the 40 x 40 grid'],
    ['path numbers off the grid', '<svg data-hue="teal"><path d="M0 0 L999 999"/></svg>', 'coordinate 999 is off the 40 x 40 grid'],
    ['a non-number', '<svg data-hue="teal"><circle cx="abc" cy="20" r="5"/></svg>', /cx must be a number/],
    ['a transform that is not rotate, translate or scale', '<svg data-hue="teal"><circle cx="20" cy="20" r="5" transform="matrix(1 0 0 1 0 0)"/></svg>', 'transform may only be rotate(), translate() or scale()'],
    ['a stroke too thick', '<svg data-hue="teal"><circle cx="20" cy="20" r="5" stroke-width="9"/></svg>', 'stroke-width must be between 1 and 5'],
    ['a bad linecap', '<svg data-hue="teal"><line x1="1" y1="1" x2="9" y2="9" stroke-linecap="square"/></svg>', 'stroke-linecap must be round or butt'],
    ['a detail flag that is not 1', '<svg data-hue="teal"><circle cx="20" cy="20" r="5" detail="yes"/></svg>', 'detail must be "1"'],
    ['a repeated attribute', '<svg data-hue="teal"><circle cx="20" cx="21" cy="20" r="5"/></svg>', 'attribute cx is repeated on <circle>'],
    ['an unclosed group', '<svg data-hue="teal"><g><circle cx="20" cy="20" r="5"/></svg>', 'unclosed <g>'],
    ['a stray closing group', '<svg data-hue="teal"><circle cx="20" cy="20" r="5"/></g></svg>', 'stray </g>'],
    ['an empty drawing', '<svg data-hue="teal"></svg>', 'empty drawing'],
    ['too many elements', `<svg data-hue="teal">${'<circle cx="20" cy="20" r="5"/>'.repeat(41)}</svg>`, 'more than 40 elements'],
  ])('rejects %s with a reason the retry can quote', (_label, text, reason) => {
    const got = reasonOf(text)
    if (reason instanceof RegExp) expect(got).toMatch(reason)
    else expect(got).toBe(reason)
  })

  it('clamps opacities into 0..1 instead of failing', () => {
    const recipe = parsed('<svg data-hue="teal"><circle cx="20" cy="20" r="5" opacity="1.7" fill-opacity="-2"/></svg>')
    expect(recipe.elements[0]!.attrs).toEqual([
      ['cx', '20'],
      ['cy', '20'],
      ['r', '5'],
      ['opacity', '1'],
      ['fill-opacity', '0'],
    ])
  })
})

/** Every tag and attribute name in a markup string. */
function namesIn(markup: string): { tags: Set<string>; attrs: Set<string> } {
  const tags = new Set<string>()
  const attrs = new Set<string>()
  for (const match of markup.matchAll(/<([a-zA-Z]+)([^>]*)>/g)) {
    tags.add(match[1]!)
    for (const attr of match[2]!.matchAll(/([\w:-]+)="/g)) attrs.add(attr[1]!)
  }
  return { tags, attrs }
}

const ALLOWED_TAGS = new Set(['svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'defs', 'clipPath'])
const ALLOWED_ATTRS = new Set([
  'xmlns', 'viewBox', 'width', 'height', 'aria-hidden', 'focusable', 'id', 'clip-path',
  'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'opacity', 'fill-opacity', 'stroke-opacity', 'transform',
  'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'points',
])

describe('rendering', () => {
  it('rebuilds the drawing with role colours as CSS variables and the shared line', () => {
    const svg = renderArt(parsed(database), 40)
    expect(svg).toContain('stroke="var(--art-teal-ink)" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round"')
    expect(svg).toContain('fill="var(--art-teal-soft)"')
    expect(svg).toContain('fill="var(--art-teal-accent)" stroke="none"')
    expect(svg).toContain('width="40" height="40"')
    expect(svg).not.toContain('detail=')
    expect(svg).not.toMatch(/#[0-9a-f]{6}/i)
  })

  it('drops detail and thickens the line below 20px, and keeps everything at 20px', () => {
    const small = renderArt(parsed(database), 16)
    expect(small).toContain('stroke-width="3.58"')
    expect(small.match(/<path/g)).toHaveLength(1)
    expect(small).not.toContain('<circle')
    const header = renderArt(parsed(database), 20)
    expect(header).toContain('stroke-width="2.75"')
    expect(header.match(/<path/g)).toHaveLength(2)
  })

  it('writes only whitelisted tags and attributes, whatever the recipe says', () => {
    const recipe = parsed(
      `<svg data-hue="plum"><g transform="translate(1 2) scale(0.9)" opacity="0.8"><path d="M5 5 L35 35" stroke-dasharray="2 3" stroke-width="2"/><polygon points="5,35 20,5 35,35" fill="accent2" fill-opacity="0.5"/></g><rect x="10" y="10" width="20" height="20" rx="3" stroke-opacity="0.4" stroke-linejoin="bevel" stroke-linecap="butt"/></svg>`,
    )
    const { tags, attrs } = namesIn(renderArt(recipe, 40))
    for (const tag of tags) expect(ALLOWED_TAGS.has(tag), `tag ${tag}`).toBe(true)
    for (const attr of attrs) expect(ALLOWED_ATTRS.has(attr), `attribute ${attr}`).toBe(true)
  })
})

describe('the pebble', () => {
  it('is the same for the same topic at every call, and differs between topics', () => {
    const a = renderPebble('t:C0ENG:1760000000.000100', 40)
    expect(renderPebble('t:C0ENG:1760000000.000100', 40)).toBe(a)
    expect(renderPebble('m:C0ENG', 40)).not.toBe(a)
    expect(a).toContain('clip-path="url(#ta')
    expect(a).toContain('var(--tide-')
    expect(a).not.toMatch(/#[0-9a-f]{6}/i)
  })

  it('shares one clip id across sizes of one topic and uses distinct ids for distinct topics', () => {
    const idOf = (svg: string) => /clipPath id="([^"]+)"/.exec(svg)![1]
    expect(idOf(renderPebble('m:C0ENG', 40))).toBe(idOf(renderPebble('m:C0ENG', 16)))
    expect(idOf(renderPebble('m:C0ENG', 40))).not.toBe(idOf(renderPebble('m:C0PRODUCT', 40)))
  })

  it('comes as parts that draw the same pebble, for a page that renders it itself', () => {
    for (const id of ['m:C0ENG', 't:C0ENG:1760000000.000100', 'signin/left/1']) {
      const shape = pebbleShape(id)
      const svg = renderPebble(id, 40)
      // The same outline, bands and dot, however the SVG is laid out.
      expect(svg).toContain(shape.clip)
      for (const band of shape.bands) {
        expect(svg).toContain(band.d)
        expect(svg).toContain(band.fill)
      }
      expect(svg.includes('<circle')).toBe(shape.dot !== undefined)
    }
  })

  it('writes only whitelisted tags and attributes', () => {
    for (const id of ['m:C0ENG', 't:C0ENG:1760000000.000100', 'm:C0HIRING', 't:D0MAYA:1.000001']) {
      const { tags, attrs } = namesIn(renderPebble(id, 40))
      for (const tag of tags) expect(ALLOWED_TAGS.has(tag), `tag ${tag}`).toBe(true)
      for (const attr of attrs) expect(ALLOWED_ATTRS.has(attr), `attribute ${attr}`).toBe(true)
    }
  })
})

describe('the hue a topic is drawn in', () => {
  it('is its pebble\'s hue, so the art keeps the placeholder\'s colour', () => {
    const recipe = parsed(database)
    for (const id of ['m:C0ENG', 't:C0ENG:1760000000.000100', 'm:C0HIRING', 't:D0MAYA:1.000001']) {
      const hue = pebbleHue(id)
      expect(renderPebble(id, 40)).toContain(`var(--tide-${hue}-base)`)
      const art = renderArt(recipe, 40, hue)
      expect(art).toContain(`var(--art-${hue}-ink)`)
      expect(art.match(/--art-([a-z]+)-/g)!.every((name) => name === `--art-${hue}-`)).toBe(true)
    }
  })

  it('spreads topics over every hue', () => {
    const hues = new Set(Array.from({ length: 64 }, (_, index) => pebbleHue(`t:C0ENG:1760000000.${String(index).padStart(6, '0')}`)))
    expect([...hues].sort()).toEqual([...HUE_NAMES].sort())
  })
})
