import * as stylex from '@stylexjs/stylex'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/icons/MagnifyingGlass'
import { useEffect, useEffectEvent, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { colors, layout, radii, sizes, spacing, text, weights, z } from '@juno/tokens/tokens.stylex'
import { commandKey, Icon, Kbd, OptionGroupLabel, OptionList, Surface, Text } from '@juno/ui'
import { PaletteRow, rowDomId, type PaletteItem } from './PaletteRow'

export type { PaletteIconName, PaletteItem } from './PaletteRow'

/** The palette's four tabs (spec section 10), in the order of ⌘1 to ⌘4. */
export type PaletteTab = 'all' | 'conversations' | 'messages' | 'commands'

const tabOptions: ReadonlyArray<{ readonly value: PaletteTab; readonly label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'conversations', label: 'Conversations' },
  { value: 'messages', label: 'Messages' },
  { value: 'commands', label: 'Commands' },
]

const placeholders: Record<PaletteTab, string> = {
  all: 'Search, or ask Juno',
  conversations: 'Find a conversation',
  messages: 'Search messages',
  commands: 'Find a page, setting or command',
}

const HOVER = '@media (hover: hover)'

export interface PaletteSection {
  /** "Frequent", "Conversations", "Recent", "Topics and messages", "Results", "Pages, settings and commands", "Pages", "Settings", "Commands", "Juno", or the open topic's name over its commands. */
  readonly heading: string
  /** Unique among the sections; the heading by default. */
  readonly key?: string
  /** A quiet key at the heading's end: the tab that shows more of the group ("⌘2"). */
  readonly hint?: string
  readonly items: ReadonlyArray<PaletteItem>
}

export interface CommandPaletteProps {
  readonly tab: PaletteTab
  /** Tab and Shift Tab, ⌘1 to ⌘4, and the tab row. */
  readonly onTab: (tab: PaletteTab) => void
  readonly query: string
  readonly onQuery: (query: string) => void
  /** The query that produced the displayed rows, which may lag the input. */
  readonly resultsQuery: string
  readonly sections: ReadonlyArray<PaletteSection>
  /** The last row, under a line below the list, reached by the arrows like the others: "All results for …". */
  readonly footer?: PaletteItem
  /** The results belong to the current input, rather than a held previous query. */
  readonly settled: boolean
  /** The displayed query has answered, including an empty answer held while the next query loads. */
  readonly resultsReady?: boolean
  /** For row times. */
  readonly now: number
  readonly onSelect: (id: string, options: { readonly newTab: boolean }) => void
  /** The row the arrows or the pointer chose, for a prefetch. */
  readonly onActiveChange?: (id: string) => void
  /** The context menu of a row with `menu`, at the pointer or, from the keyboard, at the row. */
  readonly onMenu?: (id: string, at: { readonly x: number; readonly y: number } | undefined) => void
  readonly onClose: () => void
}

/**
 * ⌘K (spec section 10, inventory 9): a search field, the row of four tabs
 * under it, and sections of results. Dumb: the owner gives the rows and
 * runs what is chosen. The active row keeps its identity until the
 * displayed query or the tab changes; Enter runs it, ⌘Enter opens it in a
 * new tab, Tab and Shift Tab or ⌘1 to ⌘4 switch tabs, Esc and a press
 * outside close.
 */
export function CommandPalette({ tab, onTab, query, onQuery, resultsQuery, sections, footer, settled, resultsReady = settled, now, onSelect, onActiveChange, onMenu, onClose }: CommandPaletteProps) {
  const listed = sections.flatMap((section) => section.items)
  const items = footer === undefined ? listed : [...listed, footer]
  const hasBody = resultsReady || listed.length > 0
  const ids = items.map((item) => item.id)
  // The automatic selection is the first listed row, never the last row under the line, so a late command still takes it.
  const first = listed[0]?.id
  const shown = `${tab}\n${resultsQuery}`
  const [selection, setSelection] = useState({ query: shown, id: first })
  // Pin even the automatic first selection. A late command or re-ranked
  // local result must not change what Enter will open.
  const chosen = selection.query === shown ? selection.id : first
  if (selection.query !== shown || (chosen === undefined && first !== undefined)) {
    setSelection({ query: shown, id: chosen ?? first })
  }
  // If a selected result disappears, Enter does nothing until the user
  // chooses another row; it must not silently open the new first result.
  const activeId = chosen !== undefined && ids.includes(chosen) ? chosen : undefined

  const activate = (id: string) => setSelection({ query: shown, id })
  const warmActive = useEffectEvent((id: string) => onActiveChange?.(id))
  useEffect(() => {
    if (activeId !== undefined) warmActive(activeId)
  }, [activeId])

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const index = activeId === undefined ? -1 : ids.indexOf(activeId)
    const move = (to: number) => {
      event.preventDefault()
      const id = ids[(to + ids.length) % ids.length]
      if (id === undefined) return
      activate(id)
      // A row the arrows reach comes into view; the list scrolls, never the page. The pointer never scrolls it.
      document.getElementById(rowDomId(id))?.scrollIntoView({ block: 'nearest' })
    }
    const step = (delta: number) => {
      const at = tabOptions.findIndex((option) => option.value === tab)
      const next = tabOptions[(at + delta + tabOptions.length) % tabOptions.length]
      if (next !== undefined) onTab(next.value)
    }
    switch (event.key) {
      case 'ArrowDown':
        return ids.length === 0 ? undefined : move(index + 1)
      case 'ArrowUp':
        return ids.length === 0 ? undefined : move(index <= 0 ? ids.length - 1 : index - 1)
      case 'Escape':
        event.preventDefault()
        return onClose()
      // The field is the palette's one stop: Tab switches tabs and never reaches the window under the dim.
      case 'Tab':
        event.preventDefault()
        return step(event.shiftKey ? -1 : 1)
      case '1':
      case '2':
      case '3':
      case '4': {
        if (!commandKey(event)) return
        event.preventDefault()
        const option = tabOptions[Number(event.key) - 1]
        return option === undefined ? undefined : onTab(option.value)
      }
      case 'Enter':
        if (event.nativeEvent.isComposing || activeId === undefined) return
        event.preventDefault()
        return onSelect(activeId, { newTab: commandKey(event) })
      case 'ContextMenu':
      case 'F10': {
        if (event.key === 'F10' && !event.shiftKey) return
        const item = items.find((candidate) => candidate.id === activeId)
        if (item?.menu !== true || onMenu === undefined) return
        event.preventDefault()
        const box = document.getElementById(rowDomId(item.id))?.getBoundingClientRect()
        return onMenu(item.id, box === undefined ? undefined : { x: Math.round(box.left + box.width / 2), y: Math.round(box.bottom) })
      }
    }
  }

  const onOverlayDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose()
  }

  const row = (item: PaletteItem, isFooter = false) => (
    <PaletteRow
      key={item.id}
      item={item}
      active={item.id === activeId}
      footer={isFooter}
      now={now}
      onSelect={(newTab) => onSelect(item.id, { newTab })}
      onActivate={() => {
        if (item.id !== activeId) activate(item.id)
      }}
      {...(item.menu === true && onMenu !== undefined ? { onMenu: (at: { readonly x: number; readonly y: number }) => onMenu(item.id, at) } : {})}
    />
  )

  return (
    <div {...stylex.props(styles.overlay)} onPointerDown={onOverlayDown}>
      <Surface kind="popover" radius="palette" padding="none" role="dialog" aria-modal="true" aria-label="Search and commands" sx={styles.panel}>
        <label {...stylex.props(styles.header)}>
          <span {...stylex.props(styles.searchIcon)}>
            <Icon icon={MagnifyingGlass} size={18} />
          </span>
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls={footer === undefined ? 'palette-results' : 'palette-results palette-footer'}
            aria-autocomplete="list"
            aria-activedescendant={activeId === undefined ? undefined : rowDomId(activeId)}
            aria-label={placeholders[tab]}
            placeholder={placeholders[tab]}
            spellCheck={false}
            value={query}
            onChange={(event) => {
              onQuery(event.target.value)
            }}
            onKeyDown={onKeyDown}
            {...stylex.props(styles.input)}
          />
          <Kbd look="key">esc</Kbd>
        </label>
        {/* A press switches on mouse down and keeps focus in the field, the palette's one stop. */}
        <div role="radiogroup" aria-label="Search in" {...stylex.props(styles.tabs, hasBody && styles.divider)}>
          {tabOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={option.value === tab}
              tabIndex={-1}
              onMouseDown={(event) => {
                event.preventDefault()
                if (event.button === 0) onTab(option.value)
              }}
              {...stylex.props(styles.tab, option.value === tab && styles.tabOn)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div {...stylex.props(styles.scroll, tab === 'all' && styles.scrollAll)}>
          <OptionList id="palette-results" label="Results" aria-busy={!settled} {...(activeId === undefined || activeId === footer?.id ? {} : { activeId: rowDomId(activeId) })}>
            {sections.map((section) =>
              section.items.length === 0 ? null : (
                <div key={section.key ?? section.heading} role="group" aria-label={section.heading}>
                  <OptionGroupLabel>
                    {section.heading}
                    {section.hint === undefined ? null : (
                      <span aria-hidden="true" {...stylex.props(styles.groupHint)}>
                        {section.hint}
                      </span>
                    )}
                  </OptionGroupLabel>
                  {section.items.map((item) => row(item))}
                </div>
              ),
            )}
            {resultsReady && listed.length === 0 ? (
              <Text variant="ui" tone="muted" as="div" sx={styles.empty}>
                No matches.
              </Text>
            ) : null}
          </OptionList>
        </div>
        {footer === undefined || !hasBody ? null : (
          <div {...stylex.props(styles.footer)}>
            <OptionList id="palette-footer" label="Search" {...(activeId === footer.id ? { activeId: rowDomId(footer.id) } : {})}>
              {row(footer, true)}
            </OptionList>
          </div>
        )}
      </Surface>
    </div>
  )
}

const styles = stylex.create({
  overlay: {
    position: 'absolute',
    inset: 0,
    zIndex: z['--z-palette'],
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingTop: layout['--palette-top'],
    paddingInline: spacing['--space-6'],
    // In a short window the list gives up height so the palette ends above the window's bottom edge.
    paddingBottom: spacing['--space-6'],
    boxSizing: 'border-box',
    backgroundColor: colors['--overlay'],
    // Over the title bars' drag regions, which would otherwise take the press.
    WebkitAppRegion: 'no-drag',
  },
  panel: {
    display: 'flex',
    flexDirection: 'column',
    width: layout['--palette-width'],
    maxWidth: '100%',
    maxHeight: '100%',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2-5'],
    paddingTop: spacing['--space-3-5'],
    paddingBottom: spacing['--space-2'],
    paddingInline: spacing['--space-4'],
    flexShrink: 0,
    cursor: 'text',
    // Its own compositor layer, so a keystroke re-rasters this row and not the window-sized overlay with the panel's shadows (performance 2.3).
    willChange: 'transform',
  },
  searchIcon: {
    display: 'inline-flex',
    color: colors['--foreground-muted'],
  },
  divider: {
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: colors['--border-default'],
  },
  input: {
    flexGrow: 1,
    minWidth: 0,
    margin: 0,
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    color: colors['--foreground-default'],
    fontFamily: text['--text-heading-family'],
    fontSize: text['--text-heading-size'],
    fontWeight: weights['--weight-regular'],
    lineHeight: text['--text-heading-leading'],
    outline: 'none',
    '::placeholder': { color: colors['--foreground-muted'], opacity: 1 },
  },
  scroll: {
    maxHeight: layout['--palette-list-max-height'],
    minHeight: 0,
    scrollbarGutter: 'stable both-edges',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    padding: spacing['--space-1-5'],
  },
  // At the heading's end, not part of its name.
  groupHint: {
    float: 'inline-end',
    fontWeight: weights['--weight-regular'],
  },
  scrollAll: {
    maxHeight: layout['--palette-all-list-max-height'],
  },
  // The first tab's text starts where the field's text does: past the 18px icon and the gap, less the tab's own padding.
  tabs: {
    display: 'flex',
    gap: spacing['--space-0-5'],
    flexShrink: 0,
    paddingInlineStart: `calc(${spacing['--space-4']} + ${sizes['--icon-18']})`,
    paddingInlineEnd: spacing['--space-4'],
    paddingBottom: spacing['--space-2'],
  },
  // The quick-filter look (the sidebar's All, Channels, DMs). The weight stays medium when chosen, so a switch never changes a tab's width.
  tab: {
    display: 'inline-flex',
    alignItems: 'center',
    height: sizes['--control-26'],
    margin: 0,
    paddingBlock: 0,
    paddingInline: spacing['--space-2-5'],
    borderWidth: 0,
    borderRadius: radii['--radius-md-plus'],
    fontFamily: text['--text-meta-family'],
    fontSize: text['--text-meta-size'],
    fontWeight: weights['--weight-medium'],
    lineHeight: text['--text-meta-leading'],
    whiteSpace: 'nowrap',
    color: {
      default: colors['--foreground-subtle'],
      ':hover': { default: null, [HOVER]: colors['--foreground-default'] },
    },
    backgroundColor: {
      default: 'transparent',
      ':hover': { default: null, [HOVER]: colors['--surface-hover'] },
    },
  },
  tabOn: {
    color: colors['--foreground-default'],
    backgroundColor: {
      default: colors['--secondary-default'],
      ':hover': { default: null, [HOVER]: colors['--secondary-hover'] },
    },
  },
  // The list's gutters too, so the last row lines up with the rows above whatever the scrollbars.
  footer: {
    flexShrink: 0,
    overflow: 'hidden',
    scrollbarGutter: 'stable both-edges',
    padding: spacing['--space-1-5'],
    borderTopWidth: '1px',
    borderTopStyle: 'solid',
    borderTopColor: colors['--border-default'],
  },
  empty: {
    paddingBlock: spacing['--space-5'],
    paddingInline: spacing['--space-2-5'],
  },
})

