import * as stylex from '@stylexjs/stylex'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/icons/MagnifyingGlass'
import { memo, useDeferredValue, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import type { EmojiCategory } from '@juno/contract'
import { accent, colors, layout, motion, radii, sizes, spacing, text } from '@juno/tokens/tokens.stylex'
import { ScrollArea, Surface, Text, TextField } from '@juno/ui'

export interface EmojiPickerProps {
  /** All standard emoji, by category (from @juno/contract's emojiCatalog). */
  readonly catalog: ReadonlyArray<EmojiCategory>
  /** The workspace's custom emoji, shown as their own category first when non-empty. */
  readonly custom?: ReadonlyArray<{ readonly name: string; readonly url: string }>
  /** Recently used names (Slack names), shown first as "Frequently used" when non-empty. */
  readonly recent?: ReadonlyArray<string>
  /** A Slack emoji name: "+1", "partying_face", a custom name. */
  readonly onPick: (name: string) => void
  /** Esc. */
  readonly onClose: () => void
  /** Names already chosen (Settings' quick reactions): drawn as chosen and not picked again. */
  readonly selected?: ReadonlySet<string>
  /** The search to open with. For fixtures; the app opens the picker empty. */
  readonly initialQuery?: string
}

/** One cell: a standard emoji (`unicode`) or a custom one (`url`). */
interface Item {
  readonly name: string
  readonly unicode?: string
  readonly url?: string
  /** Every name and alias, lowercase, space separated, for search. */
  readonly keys: string
}

interface Section {
  readonly key: string
  /** None for the chunks of a search result. */
  readonly heading?: string
  readonly items: ReadonlyArray<Item>
}

const COLUMNS = 9
/** Search results render in blocks of this many full rows, so off-screen blocks cost nothing. */
const RESULT_CHUNK = COLUMNS * 8

const EMPTY: ReadonlyArray<never> = []
const NONE: ReadonlySet<string> = new Set()

/**
 * The full emoji picker (SPEC 7): a search field, then every emoji by
 * category in a scrolling grid, custom emoji and recent ones first. A panel
 * only: the container positions it (outside the message row, whose paint
 * containment would clip it).
 *
 * About 1,900 buttons. Each category is a section with
 * `content-visibility: auto`, so only the ones on screen are laid out and
 * painted, and the sections are memoized, so typing in search does not
 * rebuild them. The browse grid stays mounted (hidden) while searching, so
 * clearing the search is instant. One click handler on the scroller reads
 * the button's `data-emoji`; the arrows move focus through the grid.
 */
export function EmojiPicker({ catalog, custom = EMPTY, recent = EMPTY, selected = NONE, onPick, onClose, initialQuery = '' }: EmojiPickerProps) {
  const [query, setQuery] = useState(initialQuery)
  const search = normalize(useDeferredValue(query))
  const browseRef = useRef<HTMLDivElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLElement>(null)

  const standard = useMemo(() => catalog.map((category) => ({ heading: category.name, items: category.emoji.map(standardItem) })), [catalog])
  const customItems = useMemo(() => custom.map((emoji) => ({ name: emoji.name, url: emoji.url, keys: emoji.name.toLowerCase() })), [custom])
  // In catalog order, custom first as in the browse grid.
  const all = useMemo(() => [...customItems, ...standard.flatMap((category) => category.items)], [customItems, standard])

  const browse = useMemo((): ReadonlyArray<Section> => {
    const byName = new Map<string, Item>()
    for (const item of all) for (const key of item.keys.split(' ')) if (!byName.has(key)) byName.set(key, item)
    const seen = new Set<string>()
    const recentItems = recent.flatMap((name) => {
      const item = byName.get(name.toLowerCase())
      if (item === undefined || seen.has(item.name)) return []
      seen.add(item.name)
      return [item]
    })
    return [
      ...(recentItems.length > 0 ? [{ key: 'recent', heading: 'Frequently used', items: recentItems }] : []),
      ...(customItems.length > 0 ? [{ key: 'custom', heading: 'Custom', items: customItems }] : []),
      ...standard.map((category) => ({ key: category.heading, ...category })),
    ]
  }, [all, recent, customItems, standard])

  const results = useMemo((): ReadonlyArray<Section> | undefined => {
    if (search === '') return undefined
    const matches = all.filter((item) => item.keys.includes(search))
    const chunks: Section[] = []
    for (let start = 0; start < matches.length; start += RESULT_CHUNK) {
      chunks.push({ key: String(start), items: matches.slice(start, start + RESULT_CHUNK) })
    }
    return chunks
  }, [all, search])

  const active = () => (results === undefined ? browseRef.current : resultsRef.current)

  const onPanelKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    onClose()
  }

  const onFieldKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      // The live query, not the deferred one, so Enter right after typing picks what was typed.
      const typed = normalize(query)
      const first = typed === '' ? undefined : all.find((item) => item.keys.includes(typed) && !selected.has(item.name))
      if (first === undefined) return
      event.preventDefault()
      onPick(first.name)
    } else if (event.key === 'ArrowDown') {
      const first = active()?.querySelector<HTMLElement>('button[data-emoji]')
      if (first == null) return
      event.preventDefault()
      first.focus()
    }
  }

  const onGridKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const container = active()
    const from = event.target
    if (container === null || !(from instanceof HTMLElement) || from.dataset['emoji'] === undefined) return
    const target = neighbour(container, from, event.key)
    if (target === undefined) return
    event.preventDefault()
    ;(target ?? container.closest('[data-emoji-picker]')?.querySelector('input'))?.focus()
  }

  const onGridClick = (event: MouseEvent<HTMLElement>) => {
    const button = (event.target as Element).closest<HTMLElement>('button[data-emoji]')
    const name = button?.dataset['emoji']
    if (name !== undefined && !selected.has(name)) onPick(name)
  }

  return (
    <Surface kind="popover" padding="none" role="dialog" aria-label="Emoji" data-emoji-picker="" onKeyDown={onPanelKeyDown} sx={styles.panel}>
      <div {...stylex.props(styles.header)}>
        <TextField
          size={30}
          leadingIcon={MagnifyingGlass}
          label="Search emoji"
          placeholder="Search emoji"
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.currentTarget.value)
            // A new search starts at the top.
            scrollerRef.current?.scrollTo({ top: 0 })
          }}
          onKeyDown={onFieldKeyDown}
        />
      </div>
      <ScrollArea ref={scrollerRef} scrollbar="hover" sx={styles.scroller} onClick={onGridClick} onKeyDown={onGridKeyDown}>
        <div ref={browseRef} hidden={results !== undefined}>
          {browse.map((section, index) => (
            <EmojiSection key={section.key} section={section} selected={selected} tabStop={results === undefined && index === 0} />
          ))}
        </div>
        {results === undefined ? null : (
          <div ref={resultsRef} data-emoji-results="" {...stylex.props(styles.results)}>
            {results.map((section, index) => (
              <EmojiSection key={section.key} section={section} selected={selected} tabStop={index === 0} />
            ))}
            {results.length === 0 ? (
              <Text variant="ui" tone="muted" as="div" sx={styles.noMatch}>
                No match.
              </Text>
            ) : null}
          </div>
        )}
      </ScrollArea>
    </Surface>
  )
}

/** A heading (none for search results) and its grid. Memoized: typing in search leaves it alone. */
const EmojiSection = memo(function EmojiSection({ section, selected, tabStop }: { readonly section: Section; readonly selected: ReadonlySet<string>; readonly tabStop: boolean }) {
  return (
    <div role="group" data-emoji-section="" aria-label={section.heading} {...stylex.props(styles.section, styles.rows(String(Math.ceil(section.items.length / COLUMNS))), section.heading === undefined && styles.bare)}>
      {section.heading === undefined ? null : (
        <div {...stylex.props(styles.heading)}>
          <Text variant="tag" tone="muted" as="h3" sx={styles.headingText}>
            {section.heading}
          </Text>
        </div>
      )}
      <div {...stylex.props(styles.grid)}>
        {section.items.map((item, index) => {
          const chosen = selected.has(item.name)
          return (
            <button
              key={item.name}
              type="button"
              // One tab stop for the whole grid; the arrows move within it.
              tabIndex={tabStop && index === 0 ? 0 : -1}
              data-emoji={item.name}
              aria-label={chosen ? `:${item.name}:, added` : `:${item.name}:`}
              aria-disabled={chosen || undefined}
              title={chosen ? `:${item.name}: is added` : `:${item.name}:`}
              {...stylex.props(styles.cell, chosen && styles.chosen)}
            >
              {item.url === undefined ? (
                item.unicode
              ) : (
                <img src={item.url} alt="" draggable={false} loading="lazy" decoding="async" {...stylex.props(styles.image)} />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
})

function standardItem(emoji: EmojiCategory['emoji'][number]): Item {
  const names = emoji.aliases === undefined ? emoji.name : [emoji.name, ...emoji.aliases].join(' ')
  return { name: emoji.name, unicode: emoji.unicode, keys: names.toLowerCase() }
}

/** Search text as a name: lowercase, no colons, spaces as underscores (":Party face" finds partying_face). */
function normalize(query: string): string {
  return query.trim().toLowerCase().replace(/:/g, '').replace(/\s+/g, '_')
}

/**
 * Where an arrow key moves focus from `from`: the next or previous emoji,
 * or the same column one row up or down, across section edges. `null` means
 * the search field (up from the first row); `undefined` means the key is not
 * an arrow. Reads the DOM order only, never layout.
 */
function neighbour(container: HTMLElement, from: HTMLElement, key: string): HTMLElement | null | undefined {
  const sections = Array.from(container.querySelectorAll('[data-emoji-section]'), (section) =>
    Array.from(section.querySelectorAll<HTMLElement>('button[data-emoji]')),
  ).filter((cells) => cells.length > 0)
  const s = sections.findIndex((cells) => cells.includes(from))
  const cells = sections[s]
  if (cells === undefined) return undefined
  const i = cells.indexOf(from)
  const column = i % COLUMNS
  const previous = sections[s - 1]
  const next = sections[s + 1]
  switch (key) {
    case 'ArrowLeft':
      return cells[i - 1] ?? previous?.at(-1) ?? from
    case 'ArrowRight':
      return cells[i + 1] ?? next?.[0] ?? from
    case 'ArrowUp': {
      if (i >= COLUMNS) return cells[i - COLUMNS]
      if (previous === undefined) return null
      const lastRow = Math.floor((previous.length - 1) / COLUMNS) * COLUMNS
      return previous[Math.min(lastRow + column, previous.length - 1)]
    }
    case 'ArrowDown': {
      if (i + COLUMNS < cells.length) return cells[i + COLUMNS]
      // A partial last row below: its last cell.
      if (Math.floor(i / COLUMNS) < Math.floor((cells.length - 1) / COLUMNS)) return cells.at(-1)
      return next === undefined ? from : next[Math.min(column, next.length - 1)]
    }
    default:
      return undefined
  }
}

// The emoji glyph and custom images in a 32px cell.
const GLYPH = '20px' // tokens-allow: an emoji glyph in a 32px cell
// A section heading: tag text with its block padding. Sticky headers keep
// this much of the scroller's top clear when focus moves up.
const HEADING_HEIGHT = `calc(${spacing['--space-2']} + ${text['--text-tag-leading']} + ${spacing['--space-1']})`
const HOVER = '@media (hover: hover)'

const styles = stylex.create({
  panel: {
    display: 'flex',
    flexDirection: 'column',
    width: layout['--emoji-picker-width'],
    height: layout['--emoji-picker-height'],
    overflow: 'hidden',
  },
  header: {
    flexShrink: 0,
    paddingBlock: spacing['--space-2-5'],
    paddingInline: spacing['--space-3'],
  },
  scroller: {
    flexGrow: 1,
    // 12px in at the start; at the end 2px plus the 10px scrollbar gutter.
    // With --emoji-picker-width this leaves exactly nine cells.
    paddingInlineStart: spacing['--space-3'],
    paddingInlineEnd: spacing['--space-0-5'],
    paddingBottom: spacing['--space-2'],
    scrollPaddingTop: HEADING_HEIGHT,
  },
  results: {
    paddingTop: spacing['--space-1'],
  },
  // Off-screen sections skip layout and paint. The estimate is the heading
  // plus the section's rows, so the scrollbar is right before they render.
  section: {
    contentVisibility: 'auto',
    containIntrinsicSize: `auto calc(${HEADING_HEIGHT} + var(--emoji-rows) * ${sizes['--control-32']})`,
  },
  rows: (rows: string) => ({ '--emoji-rows': rows }),
  bare: {
    containIntrinsicSize: `auto calc(var(--emoji-rows) * ${sizes['--control-32']})`,
  },
  heading: {
    position: 'sticky',
    top: 0,
    zIndex: 1,
    paddingTop: spacing['--space-2'],
    paddingBottom: spacing['--space-1'],
    // In line with the glyphs, which sit centred in their cells.
    paddingInline: spacing['--space-1-5'],
    backgroundColor: colors['--surface-raised'],
  },
  headingText: {
    margin: 0,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: `repeat(${COLUMNS}, ${sizes['--control-32']})`,
    gridAutoRows: sizes['--control-32'],
  },
  cell: {
    appearance: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: 0,
    padding: 0,
    borderWidth: 0,
    borderRadius: radii['--radius-lg'],
    fontSize: GLYPH,
    lineHeight: 1,
    color: 'inherit',
    userSelect: 'none',
    cursor: 'default',
    backgroundColor: {
      default: 'transparent',
      ':hover': { default: null, [HOVER]: colors['--surface-hover'] },
      ':focus-visible': colors['--surface-hover'],
    },
    scale: { default: '1', ':active': motion['--press-scale'] },
    transitionProperty: 'scale, background-color',
    transitionDuration: motion['--duration-fast'],
    transitionTimingFunction: motion['--ease-out'],
    // Inset, so the ring is not clipped by the scroller or the next cell.
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineWidth: sizes['--focus-ring-width'],
    outlineOffset: `calc(-1 * ${sizes['--focus-ring-width']})`,
    outlineColor: accent['--focus-ring'],
  },
  // Already chosen: the accent's soft fill and ring, as your own reaction chip has, and no hover or press.
  chosen: {
    backgroundColor: {
      default: accent['--hl-soft'],
      ':hover': { default: null, [HOVER]: accent['--hl-soft'] },
      ':focus-visible': accent['--hl-soft'],
    },
    boxShadow: `inset 0 0 0 1px ${accent['--hl-ring']}`, // tokens-allow: 1px hairline ring, as the reaction chip's border
    scale: { default: '1', ':active': '1' },
  },
  image: {
    width: GLYPH,
    height: GLYPH,
    objectFit: 'contain',
  },
  noMatch: {
    paddingBlock: spacing['--space-3-5'],
    paddingInline: spacing['--space-2-5'],
  },
})
