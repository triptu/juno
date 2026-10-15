import * as stylex from '@stylexjs/stylex'
import { ChatCircle } from '@phosphor-icons/react/dist/icons/ChatCircle'
import { ChatsCircle } from '@phosphor-icons/react/dist/icons/ChatsCircle'
import { ChatText } from '@phosphor-icons/react/dist/icons/ChatText'
import { CheckCircle } from '@phosphor-icons/react/dist/icons/CheckCircle'
import { FunnelSimple } from '@phosphor-icons/react/dist/icons/FunnelSimple'
import { Hash } from '@phosphor-icons/react/dist/icons/Hash'
import { Lock } from '@phosphor-icons/react/dist/icons/Lock'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/icons/MagnifyingGlass'
import { PaperPlaneTilt } from '@phosphor-icons/react/dist/icons/PaperPlaneTilt'
import { Sparkle } from '@phosphor-icons/react/dist/icons/Sparkle'
import { User } from '@phosphor-icons/react/dist/icons/User'
import { Users } from '@phosphor-icons/react/dist/icons/Users'
import { useEffect, useEffectEvent, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { colors, layout, spacing, text, weights, z } from '@juno/tokens/tokens.stylex'
import { Chip, Icon, Kbd, OptionGroupLabel, OptionList, OptionRow, Surface, Text, type PhosphorIcon } from '@juno/ui'
import { relativeTime } from './time'

/** What a row's icon shows. */
export type PaletteIconName = 'thread' | 'public' | 'private' | 'dm' | 'group' | 'message' | 'scope' | 'person' | 'send' | 'open-dm' | 'ask' | 'resolve'

const icons: Record<PaletteIconName, PhosphorIcon> = {
  thread: ChatsCircle,
  public: Hash,
  private: Lock,
  dm: User,
  group: Users,
  message: ChatText,
  scope: FunnelSimple,
  person: User,
  send: PaperPlaneTilt,
  'open-dm': ChatCircle,
  ask: Sparkle,
  resolve: CheckCircle,
}

export interface PaletteItem {
  readonly id: string
  readonly icon: PaletteIconName
  readonly label: string
  /** The plain part of the sub line: "#eng", "Public channel · Main". */
  readonly sub?: string
  /** Epoch milliseconds, shown after `sub` as "4m". */
  readonly at?: number
  /** A matched message, shown after `sub` as "Leo: text". Hidden in privacy mode. */
  readonly snippet?: { readonly sender: string; readonly text: string }
  /** A command's confidence, "95%". */
  readonly badge?: string
  /** The key hint on the active row; a ⌘↵ keycap and "New tab" by default when `opensTab`. */
  readonly hint?: string
  /** ⌘Enter and ⌘-click open it in a new tab. */
  readonly opensTab?: boolean
  /** It has a context menu (a channel). */
  readonly menu?: boolean
}

export interface PaletteSection {
  readonly heading: 'Recent' | 'Results' | 'Juno'
  readonly items: ReadonlyArray<PaletteItem>
}

export interface CommandPaletteProps {
  readonly query: string
  readonly onQuery: (query: string) => void
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

const rowDomId = (id: string) => `palette-${id}`

/**
 * ⌘K (spec section 10, inventory 9): a search field over sections of
 * results. Dumb: the owner gives the rows and runs what is chosen. The
 * active row is the one the arrows or the pointer chose, else the first;
 * Enter runs it, ⌘Enter opens it in a new tab, Esc and a press outside
 * close.
 */
export function CommandPalette({ query, onQuery, sections, settled, now, onSelect, onActiveChange, onMenu, onClose }: CommandPaletteProps) {
  const items = sections.flatMap((section) => section.items)
  const ids = items.map((item) => item.id)
  const [chosen, setChosen] = useState<string | undefined>(undefined)
  const activeId = chosen !== undefined && ids.includes(chosen) ? chosen : ids[0]

  const activate = (id: string) => {
    setChosen(id)
    onActiveChange?.(id)
  }
  // The first row becomes active without a key or a pointer: warm it too.
  const warmFirst = useEffectEvent((id: string) => onActiveChange?.(id))
  useEffect(() => {
    if (activeId !== undefined && chosen === undefined) warmFirst(activeId)
  }, [activeId, chosen])

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
            aria-label="Search, or tell Juno"
            placeholder="Search, or tell Juno: message maya the slot works"
            spellCheck={false}
            value={query}
            onChange={(event) => {
              setChosen(undefined)
              onQuery(event.target.value)
            }}
            onKeyDown={onKeyDown}
            {...stylex.props(styles.input)}
          />
          <Kbd look="key">esc</Kbd>
        </label>
        <div {...stylex.props(styles.scroll)}>
          <OptionList id="palette-results" label="Results" {...(activeId === undefined ? {} : { activeId: rowDomId(activeId) })}>
            {sections.map((section) =>
              section.items.length === 0 ? null : (
                <div key={section.heading} role="group" aria-label={section.heading}>
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

interface PaletteRowProps {
  readonly item: PaletteItem
  readonly active: boolean
  readonly now: number
  readonly onSelect: (newTab: boolean) => void
  readonly onActivate: () => void
  readonly onMenu?: (at: { readonly x: number; readonly y: number }) => void
}

function PaletteRow({ item, active, now, onSelect, onActivate, onMenu }: PaletteRowProps) {
  const time = item.at === undefined ? undefined : relativeTime(item.at, now)
  const plain = [item.sub, item.snippet === undefined ? time : undefined].filter((part) => part !== undefined && part !== '').join(' · ')
  const sub =
    item.snippet === undefined ? (
      plain === '' ? undefined : plain
    ) : (
      <>
        {plain === '' ? null : `${plain} · `}
        <span dir="auto" data-sensitive="">
          {item.snippet.sender === '' ? null : (
            <>
              <bdi>{item.snippet.sender}</bdi>:{' '}
            </>
          )}
          {item.snippet.text}
        </span>
      </>
    )
  const hint = item.hint === undefined && item.opensTab === true ? (
    <span {...stylex.props(styles.tabHint)}>
      <Kbd look="key">⌘↵</Kbd>
      <Text variant="tagSmall" tone="muted">New tab</Text>
    </span>
  ) : <Kbd>{item.hint ?? '↵'}</Kbd>
  return (
    <OptionRow
      id={rowDomId(item.id)}
      size={55}
      active={active}
      leading={
        <>
          <Icon icon={icons[item.icon]} size={16} />
          {/* Laid over the row's end: moving the active row must not reflow any row's text. */}
          {active && item.badge === undefined ? (
            <span aria-hidden="true" {...stylex.props(styles.hintOver)}>
              {hint}
            </span>
          ) : null}
        </>
      }
      label={item.icon === 'public' && item.label.startsWith('#') ? item.label.slice(1) : item.label}
      {...(sub === undefined ? {} : { sub, subPlacement: 'below' as const })}
      trailing={
        // A command keeps its hint's place in flow, hidden while another row is active.
        item.badge === undefined ? undefined : (
          <>
            <Chip variant="filled" size={20} icon={Sparkle} iconSize={12} title="Juno's read of what you typed" numeric>
              {item.badge}
            </Chip>
            <span aria-hidden="true" {...stylex.props(!active && styles.hintHidden)}>
              {hint}
            </span>
          </>
        )
      }
      onSelect={(event) => onSelect(event.metaKey && item.opensTab === true)}
      onActivate={onActivate}
      {...(onMenu === undefined
        ? {}
        : {
            onContextMenu: (event) => {
              event.preventDefault()
              onMenu({ x: event.clientX, y: event.clientY })
            },
          })}
    />
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
  tabHint: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-1'],
  },
  hintHidden: {
    visibility: 'hidden',
  },
  // Over the end of the active row (its `contain` makes it the containing block), on its background, with a soft edge over any text it covers.
  hintOver: {
    position: 'absolute',
    insetInlineEnd: spacing['--space-2-5'],
    top: '50%',
    transform: 'translateY(-50%)',
    paddingInlineStart: spacing['--space-2'],
    backgroundColor: colors['--surface-hover'],
    boxShadow: `calc(-1 * ${spacing['--space-2']}) 0 ${spacing['--space-2']} ${colors['--surface-hover']}`,
  },
  empty: {
    paddingBlock: spacing['--space-5'],
    paddingInline: spacing['--space-2-5'],
  },
})
