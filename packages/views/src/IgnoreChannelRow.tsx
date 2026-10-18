import * as stylex from '@stylexjs/stylex'
import { Hash } from '@phosphor-icons/react/dist/icons/Hash'
import { Lock } from '@phosphor-icons/react/dist/icons/Lock'
import { useRef, useState, type KeyboardEvent } from 'react'
import type { IgnorableChannel } from '@juno/contract'
import { layout, spacing } from '@juno/tokens/tokens.stylex'
import { Button, Icon, OptionList, OptionRow, Popover, SelectButton, Text, useOptionListKeys } from '@juno/ui'
import { titleMatches } from './look'
import { PickerNoMatch, PickerSearch } from './PickerSearch'

/** The rows the list draws at most; typing finds the rest. */
const SHOWN = 100

export interface IgnoreChannelRowProps {
  /** The channels that can be ignored, by name; undefined while they load. */
  readonly channels: ReadonlyArray<IgnorableChannel> | undefined
  /** The channel Ignore will ignore. */
  readonly chosen: IgnorableChannel | undefined
  readonly open: boolean
  readonly onOpen: (open: boolean) => void
  readonly query: string
  readonly onQuery: (query: string) => void
  readonly onChoose: (channel: IgnorableChannel) => void
  readonly onIgnore: (channel: IgnorableChannel) => void
}

const rowId = (id: string) => `ignore-pick-${id}`
const channelIcon = (channel: IgnorableChannel) => (channel.kind === 'private' ? Lock : Hash)

/**
 * The ignore list's add row (inventory 14), above its card: a select of the
 * channels you are in and have not ignored, then Ignore. The select opens a searchable
 * list under itself, as All topics' place filter does: typing filters by
 * the starts of words, ↑ ↓ move, Enter chooses and Esc closes. A key typed
 * on the closed select opens it with that text. Choosing and ignoring put
 * focus back on the select.
 */
export function IgnoreChannelRow({ channels, chosen, open, onOpen, query, onQuery, onChoose, onIgnore }: IgnoreChannelRowProps) {
  const select = useRef<HTMLButtonElement>(null)
  const choose = (channel: IgnorableChannel) => {
    onChoose(channel)
    onOpen(false)
    select.current?.focus()
  }
  const ignore = () => {
    if (chosen === undefined) return
    onIgnore(chosen)
    select.current?.focus()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (open || event.metaKey || event.ctrlKey || event.altKey) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      onOpen(true)
    } else if ([...event.key].length === 1 && event.key !== ' ') {
      event.preventDefault()
      onQuery(event.key)
      onOpen(true)
    }
  }
  return (
    <div {...stylex.props(styles.row)} data-ignore-add="">
      <Popover
        open={open}
        onClose={() => onOpen(false)}
        placement="bottom-start"
        width="picker"
        maxHeight="none"
        layer="picker"
        padding="none"
        label="Choose a channel"
        anchor={
          <SelectButton
            ref={select}
            size={28}
            aria-label={chosen === undefined ? 'Channel to ignore' : `Channel to ignore: ${chosen.name}`}
            placeholder={chosen === undefined}
            leading={chosen === undefined ? undefined : <Icon icon={channelIcon(chosen)} size={13} />}
            expanded={open}
            onClick={() => onOpen(!open)}
            onKeyDown={onKeyDown}
          >
            {chosen === undefined ? 'Choose a channel' : chosen.name}
          </SelectButton>
        }
      >
        {open ? <ChannelList channels={channels} chosen={chosen} query={query} onQuery={onQuery} onChoose={choose} onClose={() => onOpen(false)} /> : null}
      </Popover>
      <Button variant="secondary" size="sm" disabled={chosen === undefined} onClick={ignore}>
        Ignore
      </Button>
    </div>
  )
}

interface ChannelListProps {
  readonly channels: ReadonlyArray<IgnorableChannel> | undefined
  readonly chosen: IgnorableChannel | undefined
  readonly query: string
  readonly onQuery: (query: string) => void
  readonly onChoose: (channel: IgnorableChannel) => void
  readonly onClose: () => void
}

/** The search field and the matching channels, the chosen one marked. */
function ChannelList({ channels, chosen, query, onQuery, onChoose, onClose }: ChannelListProps) {
  const matches = (channels ?? []).filter((channel) => titleMatches(channel.name, query))
  const shown = matches.slice(0, SHOWN)
  const ids = shown.map((channel) => rowId(channel.id))
  const [picked, setPicked] = useState<string | undefined>(undefined)
  // It opens on the chosen channel, as a Mac pop-up menu opens on its item; a query starts on the first match.
  const current = chosen === undefined ? undefined : rowId(chosen.id)
  const start = query.trim() === '' && current !== undefined && ids.includes(current) ? current : ids[0]
  const activeId = picked !== undefined && ids.includes(picked) ? picked : start
  const moveTo = (id: string) => {
    setPicked(id)
    document.getElementById(id)?.scrollIntoView({ block: 'nearest' })
  }
  const keys = useOptionListKeys({
    ids,
    activeId,
    onActiveChange: moveTo,
    onSelect: (id) => {
      const channel = shown[ids.indexOf(id)]
      if (channel !== undefined) onChoose(channel)
    },
    onClose,
  })
  return (
    <>
      <PickerSearch query={query} onQuery={onQuery} placeholder="Search channels" onKeyDown={keys} activeId={activeId} />
      {/* Not a Tab stop: the rows are driven from the search field. */}
      <div tabIndex={-1} {...stylex.props(styles.scroll)}>
        <OptionList label="Channels" {...(activeId === undefined ? {} : { activeId })}>
          {shown.map((channel) => {
            const id = rowId(channel.id)
            return (
              <OptionRow
                key={id}
                id={id}
                size={32}
                active={id === activeId}
                selected={channel.id === chosen?.id}
                leading={<Icon icon={channelIcon(channel)} size={15} />}
                label={channel.name}
                onSelect={() => onChoose(channel)}
                onActivate={() => setPicked(id)}
              />
            )
          })}
          {channels === undefined ? null : matches.length === 0 ? (
            query.trim() === '' ? (
              <Text variant="ui" tone="muted" as="div" sx={styles.note}>
                No channels to ignore.
              </Text>
            ) : (
              <PickerNoMatch />
            )
          ) : matches.length > SHOWN ? (
            <Text variant="meta" tone="muted" as="div" sx={styles.note}>
              Type to find more.
            </Text>
          ) : null}
        </OptionList>
      </div>
    </>
  )
}

const styles = stylex.create({
  // Above the card: the select, then Ignore beside it.
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
    minWidth: 0,
  },
  scroll: {
    maxHeight: layout['--destination-list-max-height'],
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    padding: spacing['--space-1-5'],
  },
  note: {
    paddingBlock: spacing['--space-3-5'],
    paddingInline: spacing['--space-2-5'],
  },
})
