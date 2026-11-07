import { useEffect, useRef } from 'react'
import { Globe } from '@phosphor-icons/react/dist/icons/Globe'
import type { ConversationKind, PickConversation, PickConversations } from '@juno/contract'
import { Icon, Popover, SelectButton } from '@juno/ui'
import { ConversationList, kindIcons, loadLists } from './DestinationPickers'

export interface PlacePick {
  readonly id: string
  readonly name: string
  readonly kind: ConversationKind
  readonly tint: PickConversation['tint']
}

export interface PlacePickerProps {
  /** Undefined is Anywhere. */
  readonly place: PlacePick | undefined
  readonly open: boolean
  readonly onOpen: (open: boolean) => void
  readonly query: string
  readonly onQuery: (query: string) => void
  /** The list's sections, already narrowed to the places that apply; undefined while they load. */
  readonly conversations: PickConversations | undefined
  readonly loading?: boolean
  /** A conversation, or Anywhere with `undefined`. */
  readonly onPick: (conversation: PickConversation | undefined) => void
}

/**
 * A place filter (All topics, spec section 11): a button drawn like the
 * page's other pop-up buttons (`SelectButton`), with the place's kind icon,
 * and Home's searchable list, opening below it, with Anywhere as the list's
 * first row.
 */
export function PlacePicker({ place, open, onOpen, query, onQuery, conversations, loading, onPick }: PlacePickerProps) {
  useEffect(() => {
    const idle = requestIdleCallback(() => void loadLists(), { timeout: 5_000 })
    return () => cancelIdleCallback(idle)
  }, [])
  const button = useRef<HTMLButtonElement>(null)
  const warm = () => void loadLists()
  const label = place?.name ?? 'Anywhere'
  // A pick puts focus back on the button, as Esc does.
  const pick = (conversation: PickConversation | undefined) => {
    onPick(conversation)
    button.current?.focus()
  }
  return (
    <Popover
      open={open}
      onClose={() => onOpen(false)}
      placement="bottom-start"
      width="picker"
      maxHeight="none"
      layer="picker"
      padding="none"
      label="Pick a place"
      anchor={
        <SelectButton ref={button} size={28} fill aria-label={`Where: ${label}`} leading={<Icon icon={place === undefined ? Globe : kindIcons[place.kind]} size={13} />} expanded={open} onPointerEnter={warm} onFocus={warm} onClick={() => onOpen(!open)}>
          {label}
        </SelectButton>
      }
    >
      {open ? (
        <ConversationList
          query={query}
          onQuery={onQuery}
          conversations={conversations}
          loading={loading}
          onPickConversation={pick}
          onClose={() => onOpen(false)}
          onAnywhere={() => pick(undefined)}
          selected={place?.id}
        />
      ) : null}
    </Popover>
  )
}
