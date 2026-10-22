import { useEffect, useRef } from 'react'
import { Globe } from '@phosphor-icons/react/dist/icons/Globe'
import type { ConversationKind, PickConversation, PickConversations } from '@juno/contract'
import { Popover } from '@juno/ui'
import { ConversationList, kindIcons, loadLists, PickerButton } from './DestinationPickers'

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
 * A place filter (All topics, spec section 11): Home's destination
 * button and searchable list, opening below the button, with Anywhere as
 * the list's first row. The button takes the place's tint once one is
 * picked.
 */
export function PlacePicker({ place, open, onOpen, query, onQuery, conversations, loading, onPick }: PlacePickerProps) {
  useEffect(() => {
    const idle = requestIdleCallback(() => void loadLists(), { timeout: 5_000 })
    return () => cancelIdleCallback(idle)
  }, [])
  const button = useRef<HTMLButtonElement>(null)
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
        <PickerButton ref={button} label={`Where: ${label}`} icon={place === undefined ? Globe : kindIcons[place.kind]} tint={place?.tint} muted={place === undefined} wide expanded={open} onOpen={() => onOpen(!open)}>
          {label}
        </PickerButton>
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
