import { ChatMessageId, type ChatItem } from '@juno/agent-contract'
import type { Store } from '../store/store'

/** Notes follow their source; Undo ends on the next owner send or after a minute. */
export function pinNotes(store: Store, items: ReadonlyArray<ChatItem>): ReadonlyArray<ChatItem> {
  const pins = store.db.prepare('SELECT id, version, source_id AS source, text, at FROM pins WHERE active = 1 ORDER BY at').all() as Array<{ id: string; version: number; source: number; text: string; at: number }>
  if (pins.length === 0) return items
  const last = store.db.prepare("SELECT max(at) AS at FROM inbox WHERE kind IN ('send', 'steer', 'retry')").get() as { at: number | null }
  const now = store.now()
  return items.flatMap((item): ChatItem[] => [item, ...(item._tag !== 'owner' || item.id === undefined ? [] : pins.filter((pin) => String(pin.source) === item.id).map((pin): ChatItem => ({
    _tag: 'note', id: ChatMessageId.make(`pin:${pin.id}:${pin.version}`), kind: 'remembered', text: pin.text,
    ...(now < pin.at + 60_000 && (last.at ?? 0) <= pin.at ? { undo: true } : {}),
  })))])
}
