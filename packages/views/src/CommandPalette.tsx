import * as stylex from '@stylexjs/stylex'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/icons/MagnifyingGlass'
import { useEffect, useEffectEvent, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { colors, layout, spacing, text, weights, z } from '@juno/tokens/tokens.stylex'
import { Icon, Kbd, OptionGroupLabel, OptionList, Segmented, Surface, Text } from '@juno/ui'
import { PaletteRow, rowDomId, type PaletteItem } from './PaletteRow'

export type { PaletteIconName, PaletteItem } from './PaletteRow'

/** The palette's two tabs (spec section 10). */
export type PaletteTab = 'conversations' | 'messages'

const tabOptions: ReadonlyArray<{ readonly value: PaletteTab; readonly label: string }> = [
  { value: 'conversations', label: 'Conversations' },
  { value: 'messages', label: 'Messages' },
]

const placeholders: Record<PaletteTab, string> = {
  conversations: 'Find a conversation, or type >',
  messages: 'Search, or ask Juno',
}

export interface PaletteSection {
  /** "Frequent", "Conversations", "Pages", "Settings", "Commands", "Recent", "Results", "Juno", or the open topic's name over its commands. */
  readonly heading: string
  /** Unique among the sections; the heading by default. */
  readonly key?: string
  readonly items: ReadonlyArray<PaletteItem>
}

export interface CommandPaletteProps {
  readonly tab: PaletteTab
  /** Tab and Shift Tab, ⌘1 and ⌘2, and the segmented control. */
  readonly onTab: (tab: PaletteTab) => void
  readonly query: string
  readonly onQuery: (query: string) => void
  /** The query that produced the displayed rows, which may lag the input. */
  readonly resultsQuery: string
  readonly sections: ReadonlyArray<PaletteSection>
  /** The results for the query are known, so an empty list says "No matches." */
  readonly settled: boolean
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
 * ⌘K (spec section 10, inventory 9): a search field and the two tabs over
 * sections of results. Dumb: the owner gives the rows and runs what is
 * chosen. The active row keeps its identity until the displayed query or
 * the tab changes; Enter runs it, ⌘Enter opens it in a new tab, Tab and
 * Shift Tab or ⌘1 and ⌘2 switch tabs, Esc and a press outside close.
 */
export function CommandPalette({ tab, onTab, query, onQuery, resultsQuery, sections, settled, now, onSelect, onActiveChange, onMenu, onClose }: CommandPaletteProps) {
  const items = sections.flatMap((section) => section.items)
  const ids = items.map((item) => item.id)
  const shown = `${tab}\n${resultsQuery}`
  const [selection, setSelection] = useState({ query: shown, id: ids[0] })
  // Pin even the automatic first selection. A late command or re-ranked
  // local result must not change what Enter will open.
  const chosen = selection.query === shown ? selection.id : ids[0]
  if (selection.query !== shown || (chosen === undefined && ids.length > 0)) {
    setSelection({ query: shown, id: chosen ?? ids[0] })
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
        return onTab(tab === 'conversations' ? 'messages' : 'conversations')
      case '1':
      case '2':
        if (!event.metaKey) return
        event.preventDefault()
        return onTab(event.key === '1' ? 'conversations' : 'messages')
      case 'Enter':
        if (event.nativeEvent.isComposing || activeId === undefined) return
        event.preventDefault()
        return onSelect(activeId, { newTab: event.metaKey })
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
            aria-controls="palette-results"
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
          {/* A press keeps focus in the field, the palette's one stop. */}
          <span {...stylex.props(styles.tabs)} onMouseDown={(event) => event.preventDefault()}>
            <Segmented label="Search in" options={tabOptions} value={tab} onChange={onTab} />
          </span>
          <Kbd look="key">esc</Kbd>
        </label>
        <div {...stylex.props(styles.scroll)}>
          <OptionList id="palette-results" label="Results" aria-busy={!settled} {...(activeId === undefined ? {} : { activeId: rowDomId(activeId) })}>
            {sections.map((section) =>
              section.items.length === 0 ? null : (
                <div key={section.key ?? section.heading} role="group" aria-label={section.heading}>
                  <OptionGroupLabel>{section.heading}</OptionGroupLabel>
                  {section.items.map((item) => (
                    <PaletteRow
                      key={item.id}
                      item={item}
                      active={item.id === activeId}
                      now={now}
                      onSelect={(newTab) => onSelect(item.id, { newTab })}
                      onActivate={() => {
                        if (item.id !== activeId) activate(item.id)
                      }}
                      {...(item.menu === true && onMenu !== undefined ? { onMenu: (at: { readonly x: number; readonly y: number }) => onMenu(item.id, at) } : {})}
                    />
                  ))}
                </div>
              ),
            )}
            {settled && items.length === 0 ? (
              <Text variant="ui" tone="muted" as="div" sx={styles.empty}>
                No matches.
              </Text>
            ) : null}
          </OptionList>
        </div>
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
    backgroundColor: colors['--overlay'],
    // Over the title bars' drag regions, which would otherwise take the press.
    WebkitAppRegion: 'no-drag',
  },
  panel: {
    display: 'flex',
    flexDirection: 'column',
    width: layout['--palette-width'],
    maxWidth: '100%',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2-5'],
    paddingBlock: spacing['--space-3-5'],
    paddingInline: spacing['--space-4'],
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: colors['--border-default'],
    cursor: 'text',
    // Its own compositor layer, so a keystroke re-rasters this row and not the window-sized overlay with the panel's shadows (performance 2.3).
    willChange: 'transform',
  },
  searchIcon: {
    display: 'inline-flex',
    color: colors['--foreground-muted'],
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
    scrollbarGutter: 'stable both-edges',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    padding: spacing['--space-1-5'],
  },
  // Room for the input to shrink into: the control never gives up its width.
  tabs: {
    display: 'inline-flex',
    flexShrink: 0,
  },
  empty: {
    paddingBlock: spacing['--space-5'],
    paddingInline: spacing['--space-2-5'],
  },
})

