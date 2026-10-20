import * as stylex from '@stylexjs/stylex'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/icons/MagnifyingGlass'
import { useDeferredValue, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'
import { matchEmoji, prepareEmojiPicker, type EmojiCategory, type PickerItem as Item, type PickerCustomEmoji, type PreparedEmojiPicker } from '@juno/contract'
import { accent, colors, layout, motion, radii, sizes, spacing, text } from '@juno/tokens/tokens.stylex'
import { ScrollArea, Surface, Text, TextField } from '@juno/ui'

export interface EmojiPickerProps {
  /** All standard emoji, by category (from @juno/contract's emojiCatalog). */
  readonly catalog: ReadonlyArray<EmojiCategory>
  readonly data?: PreparedEmojiPicker
  /** The workspace's custom emoji, shown as their own category after the standard categories when non-empty. */
  readonly custom?: ReadonlyArray<PickerCustomEmoji>
  /** Recently used names (Slack names), shown first as "Frequently used" when non-empty. */
  readonly recent?: ReadonlyArray<string>
  /** A Slack emoji name: "+1", "partying_face", a custom name. */
  readonly onPick: (name: string, unicode?: string) => void
  /** Esc. */
  readonly onClose: () => void
  /** Names already chosen (Settings' quick reactions): drawn as chosen and not picked again. */
  readonly selected?: ReadonlySet<string>
  /** The search to open with. For fixtures; the app opens the picker empty. */
  readonly initialQuery?: string
}

interface Section {
  readonly key: string
  /** None for search results. */
  readonly heading?: string
  readonly items: ReadonlyArray<Item>
}

const COLUMNS = 9
// Grid geometry mirrors --control-32 and the tag heading's padding and line height.
const ROW_HEIGHT = 32
const HEADER_HEIGHT = 30

const EMPTY: ReadonlyArray<never> = []
const NONE: ReadonlySet<string> = new Set()

/** A windowed grid: only nearby rows mount, including in a large workspace or search. */
export function EmojiPicker({ catalog, data, custom = EMPTY, recent = EMPTY, selected = NONE, onPick, onClose, initialQuery = '' }: EmojiPickerProps) {
  const [query, setQuery] = useState(initialQuery)
  const [failed, setFailed] = useState<ReadonlySet<string>>(NONE)
  const [focused, setFocused] = useState<number | undefined>(undefined)
  const search = normalize(useDeferredValue(query))
  const gridRef = useRef<HTMLDivElement>(null)
  const pendingFocus = useRef<number | undefined>(undefined)
  const scrollerRef = useRef<HTMLElement>(null)

  const { standard, customItems, all, byName } = data ?? prepareEmojiPicker(catalog, custom)
  const selectedItems = useMemo(() => new Set([...selected].map((name) => byName.get(name.toLowerCase()))), [selected, byName])
  const isChosen = (item: Item) => selectedItems.has(item)

  const browse = useMemo((): ReadonlyArray<Section> => {
    const seen = new Set<Item>()
    const recentItems = recent.flatMap((name) => {
      const item = byName.get(name.toLowerCase())
      if (item === undefined || seen.has(item)) return []
      seen.add(item)
      return [item]
    })
    return [
      ...(recentItems.length > 0 ? [{ key: 'recent', heading: 'Frequently used', items: recentItems }] : []),
      ...standard.map((category) => ({ key: category.heading, ...category })),
      ...(customItems.length > 0 ? [{ key: 'custom', heading: 'Workspace', items: customItems }] : []),
    ]
  }, [byName, recent, customItems, standard])

  const results = useMemo((): ReadonlyArray<Section> | undefined => {
    if (search === '') return undefined
    const matches = matchEmoji(all, search, [], [], Infinity)
    return [{ key: 'results', items: matches }]
  }, [all, search])

  const sections = results ?? browse
  const grid = useMemo(() => {
    const rows: Array<{ key: string; heading: string } | { key: string; section: string; items: ReadonlyArray<Item>; start: number; first: number }> = []
    const groups: Array<{ section: Section; top: number; height: number; first: number; row: number }> = []
    let top = 0
    let count = 0
    for (const section of sections) {
      const height = (section.heading === undefined ? 0 : HEADER_HEIGHT) + Math.ceil(section.items.length / COLUMNS) * ROW_HEIGHT
      groups.push({ section, top, height, first: count, row: rows.length + (section.heading === undefined ? 0 : 1) })
      top += height
      if (section.heading !== undefined) {
        rows.push({ key: section.key, heading: section.heading })
      }
      for (let start = 0; start < section.items.length; start += COLUMNS) {
        rows.push({ key: `${section.key}:${start}`, section: section.key, items: section.items, start, first: count + start })
      }
      count += section.items.length
    }
    const groupAt = (index: number) => groups.find((group) => index >= group.first && index < group.first + group.section.items.length)
    const rowAt = (index: number) => { const group = groupAt(index); return group === undefined ? undefined : group.row + Math.floor((index - group.first) / COLUMNS) }
    const itemAt = (index: number) => { const group = groupAt(index); return group?.section.items[index - group.first] }
    return { rows, groups, count, rowAt, itemAt }
  }, [sections])
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: grid.rows.length,
    getScrollElement: () => scrollerRef.current,
    estimateSize: (index) => 'heading' in grid.rows[index]! ? HEADER_HEIGHT : ROW_HEIGHT,
    getItemKey: (index) => grid.rows[index]!.key,
    overscan: 3,
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range)
      const row = focused === undefined ? undefined : grid.rowAt(focused)
      return row === undefined || indexes.includes(row) ? indexes : [...indexes, row].toSorted((a, b) => a - b)
    },
    scrollPaddingStart: HEADER_HEIGHT,
  })
  const visibleRows = virtualizer.getVirtualItems()
  const firstRow = visibleRows.find((row) => row.index >= (virtualizer.range?.startIndex ?? 0) && 'items' in grid.rows[row.index]!)
  const first = firstRow === undefined ? undefined : grid.rows[firstRow.index]
  const tabStop = focused ?? (first !== undefined && 'items' in first ? first.first : 0)
  const focusCell = (index: number) => {
    const cell = gridRef.current?.querySelector<HTMLElement>(`[data-cell="${index}"]`)
    if (cell) { pendingFocus.current = undefined; cell.focus(); return }
    pendingFocus.current = index
    virtualizer.scrollToIndex(grid.rowAt(index) ?? 0, { align: 'auto' })
  }
  useLayoutEffect(() => {
    const index = pendingFocus.current
    if (index === undefined) return
    const cell = gridRef.current?.querySelector<HTMLElement>(`[data-cell="${index}"]`)
    if (cell) { pendingFocus.current = undefined; cell.focus() }
  })
  useLayoutEffect(() => {
    pendingFocus.current = undefined
    setFocused(undefined)
    virtualizer.scrollToOffset(0)
  }, [search, virtualizer])

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
      const match = typed === '' ? undefined : matchEmoji(all, typed, [], [], Infinity).find((item) => !isChosen(item))
      if (match === undefined) return
      event.preventDefault()
      onPick(match.name, match.unicode)
    } else if (event.key === 'ArrowDown') {
      if (grid.count === 0) return
      event.preventDefault()
      focusCell(0)
    }
  }

  const onGridKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const from = event.target
    if (!(from instanceof HTMLElement) || from.dataset['cell'] === undefined) return
    const index = pendingFocus.current ?? Number(from.dataset['cell'])
    const target = neighbour(sections, index, event.key)
    if (target === undefined) return
    event.preventDefault()
    if (target === null) scrollerRef.current?.closest('[data-emoji-picker]')?.querySelector('input')?.focus()
    else focusCell(target)
  }

  const onGridClick = (event: MouseEvent<HTMLElement>) => {
    const button = (event.target as Element).closest<HTMLElement>('button[data-emoji]')
    const item = grid.itemAt(Number(button?.dataset['cell']))
    if (item !== undefined && !isChosen(item)) onPick(item.name, item.unicode)
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
      <ScrollArea ref={scrollerRef} scrollbar="hover" sx={styles.scroller} onClick={onGridClick} onKeyDown={onGridKeyDown} onFocusCapture={(event) => {
        const cell = (event.target as HTMLElement).dataset['cell']
        if (cell !== undefined) setFocused(Number(cell))
      }} onBlurCapture={(event) => {
        if (!(event.relatedTarget instanceof HTMLElement) || event.relatedTarget.dataset['cell'] === undefined) setFocused(undefined)
      }}>
        <div ref={gridRef} data-emoji-results={results === undefined ? undefined : ''} {...stylex.props(styles.window(virtualizer.getTotalSize()))}>
          {grid.groups.map(({ section, top, height }) => (
            <div key={section.key} role="group" aria-label={section.heading} data-emoji-section="" {...stylex.props(styles.group(height))}>
              {section.heading === undefined ? null : (
                <div {...stylex.props(styles.heading)}>
                  <Text variant="tag" tone="muted" as="h3" sx={styles.headingText}>{section.heading}</Text>
                </div>
              )}
              {visibleRows.map((virtual) => {
                const row = grid.rows[virtual.index]!
                if (!('items' in row) || row.section !== section.key) return null
                return (
                  <div key={virtual.key} {...stylex.props(styles.virtualRow(virtual.start - top, virtual.size), styles.grid)}>
                    {row.items.slice(row.start, row.start + COLUMNS).map((item, index) => {
                      const chosen = isChosen(item)
                      return (
                        <button
                          key={itemKey(item)}
                          type="button"
                          tabIndex={row.first + index === tabStop ? 0 : -1}
                          data-emoji={item.name}
                          data-cell={row.first + index}
                          aria-label={chosen ? `:${item.name}:, added` : `:${item.name}:`}
                          aria-disabled={chosen || undefined}
                          title={chosen ? `:${item.name}: is added` : `:${item.name}:`}
                          {...stylex.props(styles.cell, chosen && styles.chosen)}
                        >
                          {item.url === undefined ? item.unicode : failed.has(itemKey(item)) ? <span {...stylex.props(styles.fallback)}>{`:${item.name}:`}</span> : (
                            <img src={item.url} alt="" draggable={false} loading="lazy" decoding="async" onError={() => setFailed((names) => new Set(names).add(itemKey(item)))} {...stylex.props(styles.image)} />
                          )}
                        </button>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
        {results !== undefined && grid.count === 0 ? <Text variant="ui" tone="muted" as="div" sx={styles.noMatch}>No match.</Text> : null}
      </ScrollArea>
    </Surface>
  )
}

const itemKey = (item: Item) => `${item.url === undefined ? 'standard' : 'workspace'}:${item.name}`

/** Search text as a name: lowercase, no colons, spaces as underscores (":Party face" finds partying_face). */
function normalize(query: string): string {
  return query.trim().toLowerCase().replace(/:/g, '').replace(/\s+/g, '_')
}

/**
 * Where an arrow key moves focus from `from`: the next or previous emoji,
 * or the same column one row up or down, across section edges. `null` means
 * the search field; `undefined` means the key is not an arrow.
 * Uses the complete section order, including rows outside the viewport.
 */
function neighbour(sections: ReadonlyArray<Section>, from: number, key: string): number | null | undefined {
  const groups = sections.filter((section) => section.items.length > 0)
  let start = 0
  const s = groups.findIndex((section) => {
    if (from < start + section.items.length) return true
    start += section.items.length
    return false
  })
  const cells = groups[s]?.items
  if (cells === undefined) return undefined
  const i = from - start
  const column = i % COLUMNS
  const previous = groups[s - 1]?.items
  const next = groups[s + 1]?.items
  switch (key) {
    case 'ArrowLeft': return Math.max(0, from - 1)
    case 'ArrowRight': return Math.min(groups.reduce((count, group) => count + group.items.length, 0) - 1, from + 1)
    case 'ArrowUp': {
      if (i >= COLUMNS) return from - COLUMNS
      if (previous === undefined) return null
      const lastRow = Math.floor((previous.length - 1) / COLUMNS) * COLUMNS
      return start - previous.length + Math.min(lastRow + column, previous.length - 1)
    }
    case 'ArrowDown': {
      if (i + COLUMNS < cells.length) return from + COLUMNS
      if (Math.floor(i / COLUMNS) < Math.floor((cells.length - 1) / COLUMNS)) return start + cells.length - 1
      return next === undefined ? from : start + cells.length + Math.min(column, next.length - 1)
    }
    default: return undefined
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
  window: (height: number) => ({ position: 'relative', height }),
  virtualRow: (top: number, height: number) => ({ position: 'absolute', top, height, width: '100%', boxSizing: 'border-box' }),
  group: (height: number) => ({ position: 'relative', height }),
  heading: {
    position: 'sticky',
    top: 0,
    height: HEADING_HEIGHT,
    boxSizing: 'border-box',
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
  fallback: { width: GLYPH, height: GLYPH, overflow: 'hidden', whiteSpace: 'nowrap', fontSize: text['--text-meta-size'], lineHeight: GLYPH },
  noMatch: {
    paddingBlock: spacing['--space-3-5'],
    paddingInline: spacing['--space-2-5'],
  },
})
