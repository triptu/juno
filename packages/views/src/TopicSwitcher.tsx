import * as stylex from '@stylexjs/stylex'
import { useLayoutEffect, useState, type KeyboardEvent } from 'react'
import type { ThreadSummary } from '@juno/contract'
import { layout, spacing } from '@juno/tokens/tokens.stylex'
import { Chip, OptionGroupLabel, OptionList, OptionRow, Text, useOptionListKeys, type ActivateEvent } from '@juno/ui'
import { countLabel, titleMatches as matches } from './look'
import { PickerNoMatch, PickerSearch } from './PickerSearch'
import { relativeTime } from './time'

export interface TopicSwitcherProps {
  /** The channel's Main topic id. */
  readonly mainId: string
  /** Main's unread messages. */
  readonly mainUnread: number
  /** The topic the header belongs to: its row is marked. */
  readonly currentId: string
  /** The channel's threads, open ones newest first, then the resolved ones (`resolved`); undefined while they load. */
  readonly threads: ReadonlyArray<ThreadSummary> | undefined
  readonly now: number
  readonly query: string
  readonly onQuery: (query: string) => void
  /** A topic picked: click or Enter in the current tab, ⌘-click or ⌘Enter in a new one (`event.metaKey`). */
  readonly onOpen: (id: string, event: Pick<ActivateEvent, 'metaKey'>) => void
}

const replies = (count: number) => (count === 1 ? '1 reply' : `${count} replies`)

const rowId = (id: string) => `switch-${id}`

/**
 * The header's topic switcher (SPEC 7, inventory 5): the popover the title
 * opens. A search field, then the channel's Main and its threads, newest
 * activity first, with the resolved ones last under their own label. Unread
 * shows as in the sidebar, a bold title and a count; the topic on screen is
 * the selected row. Typing filters, ↑ ↓ move, Enter opens and ⌘Enter opens
 * in a new tab. Esc is the popover's: it closes and gives focus back to
 * the title.
 */
export function TopicSwitcher({ mainId, mainUnread, currentId, threads, now, query, onQuery, onOpen }: TopicSwitcherProps) {
  const main = matches('Main', query)
  const shown = (threads ?? []).filter((thread) => matches(thread.title, query))
  const open = shown.filter((thread) => thread.resolved !== true)
  const resolved = shown.filter((thread) => thread.resolved === true)
  const topicIds = [...(main ? [mainId] : []), ...open.map((thread) => thread.id), ...resolved.map((thread) => thread.id)]
  const ids = topicIds.map(rowId)
  const [chosen, setChosen] = useState<string | undefined>(undefined)
  // It opens on the topic on screen, as a Mac pop-up menu opens on its current
  // item, so one row is lit, not that one and Main. A query starts on the first match.
  const current = rowId(currentId)
  const start = query.trim() === '' && ids.includes(current) ? current : ids[0]
  const activeId = chosen !== undefined && ids.includes(chosen) ? chosen : start
  const pick = (id: string, metaKey = false) => {
    const topicId = topicIds[ids.indexOf(id)]
    if (topicId !== undefined) onOpen(topicId, { metaKey })
  }
  // The row the arrows reach, and the current row on open, come into view; the pointer never scrolls the list.
  const moveTo = (id: string) => {
    setChosen(id)
    reveal(id)
  }
  // On open and after each query, before the paint.
  useLayoutEffect(() => {
    if (start !== undefined) reveal(start)
  }, [start])
  const keys = useOptionListKeys({ ids, activeId, onActiveChange: moveTo, onSelect: (id) => pick(id) })
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' && event.metaKey && activeId !== undefined) {
      event.preventDefault()
      pick(activeId, true)
      return
    }
    keys(event)
  }

  const row = (thread: ThreadSummary) => (
    <ThreadRow key={thread.id} thread={thread} now={now} active={rowId(thread.id) === activeId} current={thread.id === currentId} onOpen={onOpen} onActivate={setChosen} />
  )

  return (
    <div data-topic-switcher="">
      <PickerSearch query={query} onQuery={onQuery} placeholder="Search this channel" onKeyDown={onKeyDown} activeId={activeId} />
      {/* Not a Tab stop: the rows are driven from the search field, so Chromium's own stop on a scroller would lead nowhere. */}
      <div tabIndex={-1} {...stylex.props(styles.scroll)}>
        <OptionList label="Topics in this channel" {...(activeId === undefined ? {} : { activeId })}>
          {main ? <MainRow mainId={mainId} unread={mainUnread} active={rowId(mainId) === activeId} current={mainId === currentId} onOpen={onOpen} onActivate={setChosen} /> : null}
          {open.map(row)}
          {resolved.length === 0 ? null : (
            <div role="group" aria-label="Resolved">
              <OptionGroupLabel>Resolved</OptionGroupLabel>
              {resolved.map(row)}
            </div>
          )}
          {threads !== undefined && ids.length === 0 ? <PickerNoMatch /> : null}
        </OptionList>
      </div>
    </div>
  )
}

interface RowProps {
  readonly active: boolean
  /** The topic on screen. */
  readonly current: boolean
  readonly onOpen: TopicSwitcherProps['onOpen']
  readonly onActivate: (rowId: string) => void
}

/** Main: first, with its line, and no icon, so its title starts on the threads' edge. */
function MainRow({ mainId, unread, active, current, onOpen, onActivate }: RowProps & { readonly mainId: string; readonly unread: number }) {
  const id = rowId(mainId)
  return (
    <OptionRow
      id={id}
      size={44}
      active={active}
      selected={current}
      label={
        <Text variant="body" weight={unread > 0 ? 'semibold' : 'medium'} tone="default" sx={styles.title}>
          Main
        </Text>
      }
      sub="Messages outside threads"
      subPlacement="below"
      trailing={<Badges unread={unread} exact mentionsMe={false} />}
      onSelect={(event) => onOpen(mainId, event)}
      onActivate={() => onActivate(id)}
    />
  )
}

/** A thread: its title (bold while unread, quieter once resolved), replies and time, and the sidebar's badges. */
function ThreadRow({ thread, now, active, current, onOpen, onActivate }: RowProps & { readonly thread: ThreadSummary; readonly now: number }) {
  const id = rowId(thread.id)
  return (
    <OptionRow
      id={id}
      size={44}
      active={active}
      selected={current}
      label={
        <Text variant="body" weight={thread.unreadCount > 0 ? 'semibold' : 'medium'} tone={thread.resolved === true ? 'subtle' : 'default'} truncate dir="auto" sx={styles.title}>
          {thread.title}
        </Text>
      }
      sub={`${replies(thread.replyCount)} · ${relativeTime(thread.lastActivityAt, now)}`}
      subPlacement="below"
      trailing={<Badges unread={thread.unreadCount} exact={thread.unreadExact} mentionsMe={thread.mentionsMe} />}
      onSelect={(event) => onOpen(thread.id, event)}
      onActivate={() => onActivate(id)}
    />
  )
}

/** The sidebar's unread count and @ tag, at the row's end. */
function Badges({ unread, exact, mentionsMe }: { readonly unread: number; readonly exact: boolean; readonly mentionsMe: boolean }) {
  if (unread === 0 && !mentionsMe) return null
  const label = exact ? `${unread} unread` : `${unread} or more unread`
  return (
    <span {...stylex.props(styles.badges)}>
      {mentionsMe ? (
        <Chip variant="soft" title="Mentions you">
          @
        </Chip>
      ) : null}
      {unread > 0 ? (
        <Chip variant="strong" numeric title={label}>
          {countLabel(unread, exact)}
        </Chip>
      ) : null}
    </span>
  )
}

const reveal = (id: string) => document.getElementById(id)?.scrollIntoView({ block: 'nearest' })

const styles = stylex.create({
  // The row's 20px title line (OptionRow 44), not the body's 1.6.
  title: {
    lineHeight: 'inherit',
  },
  scroll: {
    // The list's height before it scrolls, as the destination list's.
    maxHeight: layout['--destination-list-max-height'],
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    padding: spacing['--space-1-5'],
  },
  badges: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-1'],
  },
})
