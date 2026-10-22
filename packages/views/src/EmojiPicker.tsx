import * as stylex from '@stylexjs/stylex'
import { neighbour } from './emojiPickerNavigation'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/icons/MagnifyingGlass'
import { useDeferredValue, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'
import { matchEmoji, type PickerItem as Item, type PreparedEmojiPicker } from '@juno/contract'
import { accent, colors, layout, radii, sizes, spacing, text } from '@juno/tokens/tokens.stylex'
import { Emoji, ScrollArea, Surface, Text, TextField } from '@juno/ui'

export interface EmojiPickerProps {
  readonly data: PreparedEmojiPicker
  /** The container warms the full index; until then search uses names only. */
  readonly searchReady?: boolean
  /** Recently used names (Slack names), shown first as "Frequently used" when non-empty. */
  readonly recent?: ReadonlyArray<string>
  /** A Slack emoji name: "+1", "partying_face", a custom name. */
  readonly onPick: (name: string, unicode?: string) => void
  /** Esc. */
  readonly onClose: () => void
  /** Names already chosen (Settings' quick reactions): drawn as chosen and not picked again. */
  readonly selected?: ReadonlyArray<{ readonly name: string; readonly url?: string }>
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
export function EmojiPicker({ data, recent = EMPTY, selected = EMPTY, onPick, onClose, initialQuery = '', searchReady = true }: EmojiPickerProps) {
  const [query, setQuery] = useState(initialQuery)
  const [failed, setFailed] = useState<ReadonlySet<string>>(NONE)
  const [focused, setFocused] = useState<number | undefined>(undefined)
  const search = normalize(useDeferredValue(query))
  const gridRef = useRef<HTMLDivElement>(null)
  const pendingFocus = useRef<number | undefined>(undefined)
  const scrollerRef = useRef<HTMLElement>(null)

  const { standard, customItems, all, byName } = data
  const selectedItems = useMemo(() => new Set(selected.map((reaction) => {
    const item = byName.get(reaction.name.toLowerCase(), reaction.url === undefined ? 'standard' : 'workspace')
    return item === undefined ? `${reaction.url === undefined ? 'standard' : 'workspace'}:${reaction.name}` : itemKey(item)
  })), [selected, byName])
  const isChosen = (item: Item) => selectedItems.has(itemKey(item))
  // A known recent name is a real cell from the first paint. Fill its image
  // later without adding or removing slots during this open.
  const [recentSlots] = useState<ReadonlyArray<Item>>(() => {
    const seen = new Set<string>()
    return recent.flatMap((name) => {
      const item = byName.get(name.toLowerCase()) ?? { name, keys: [name.toLowerCase()] }
      const key = itemKey(item)
      if (seen.has(key)) return []
      seen.add(key)
      return [item]
    })
  })

  const browse = useMemo((): ReadonlyArray<Section> => {
    const recentItems = recentSlots.map((item) => byName.get(item.name.toLowerCase()) ?? item)
    return [
      ...(recentItems.length > 0 ? [{ key: 'recent', heading: 'Frequently used', items: recentItems }] : []),
      ...standard.map((category) => ({ key: category.heading, ...category })),
      ...(customItems.length > 0 ? [{ key: 'custom', heading: 'Workspace', items: customItems }] : []),
    ]
  }, [byName, recentSlots, customItems, standard])

  const results = useMemo((): ReadonlyArray<Section> | undefined => {
    if (search === '') return undefined
    const matches = matchEmoji(all, search, recent, [], Infinity, searchReady)
    return [{ key: 'results', items: matches }]
  }, [all, search, recent, searchReady])

  const [cold, setCold] = useState<{ readonly search: string; readonly all: typeof all; readonly items: ReadonlyArray<Item> }>()
  const items = results?.[0]?.items
  if (!searchReady && items !== undefined && cold?.items !== items) setCold({ search, all, items })
  else if (cold !== undefined && (cold.search !== search || cold.all !== all)) setCold(undefined)
  const sections = useMemo(() => {
    if (items === undefined) return browse
    if (cold?.search !== search || cold.all !== all || !searchReady) return [{ key: 'results', items }]
    // Refine this cold query by appending new matches, keeping the cells already under the pointer.
    const seen = new Set(cold.items.map(itemKey))
    return [{ key: 'results', items: [...cold.items, ...items.filter((item) => !seen.has(itemKey(item)))] }]
  }, [items, browse, cold, search, all, searchReady])
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
      const matches = typed === search ? sections.flatMap((section) => section.items) : matchEmoji(all, typed, recent, [], Infinity, searchReady)
      const match = typed === '' ? undefined : matches.find((item) => !isChosen(item))
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
    const target = neighbour(sections, index, event.key, COLUMNS)
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
                          key={row.section === 'recent' ? itemKey(recentSlots[row.start + index]!) : itemKey(item)}
                          type="button"
                          tabIndex={row.first + index === tabStop ? 0 : -1}
                          data-emoji={item.name}
                          data-cell={row.first + index}
                          aria-label={chosen ? `:${item.name}:, added` : `:${item.name}:`}
                          aria-disabled={chosen || undefined}
                          title={chosen ? `:${item.name}: is added` : `:${item.name}:`}
                          {...stylex.props(styles.cell, chosen && styles.chosen)}
                        >
                          {item.unicode !== undefined ? <Emoji glyph={item.unicode} size={20} /> : item.url === undefined || failed.has(itemKey(item)) ? <span aria-hidden="true" {...stylex.props(styles.fallback)}><span data-emoji-placeholder="" {...stylex.props(styles.placeholder)} /></span> : (
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

const itemKey = (item: Item) => `${item.unicode === undefined ? 'workspace' : 'standard'}:${item.name}`

/** Search text as a name: lowercase, no colons, spaces as underscores (":Party face" finds partying_face). */
function normalize(query: string): string {
  return query.trim().toLowerCase().replace(/:/g, '').replace(/\s+/g, '_')
}

// Custom images in a 32px cell, the size of a text emoji's square there (`Emoji` 20).
const GLYPH = sizes['--icon-20']
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
    color: 'inherit',
    userSelect: 'none',
    cursor: 'default',
    backgroundColor: {
      default: 'transparent',
      ':hover': { default: null, [HOVER]: colors['--surface-hover'] },
      ':focus-visible': colors['--surface-hover'],
    },
    transitionProperty: 'background-color',
    transitionDuration: '0s',
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
  },
  image: {
    width: GLYPH,
    height: GLYPH,
    objectFit: 'contain',
  },
  fallback: { width: GLYPH, height: GLYPH, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  placeholder: { width: sizes['--icon-12'], height: sizes['--icon-12'], boxSizing: 'border-box', border: `1px solid ${colors['--foreground-muted']}`, borderRadius: radii['--radius-inline'] },
  noMatch: {
    paddingBlock: spacing['--space-3-5'],
    paddingInline: spacing['--space-2-5'],
  },
})
