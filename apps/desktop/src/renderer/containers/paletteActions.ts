/**
 * What ⌘K's rows do (spec section 10, inventory 9): open a topic (at a
 * message, which then flashes), a channel's Main or a person's DM, narrow
 * the sidebar to a channel, start a New chat to someone never messaged,
 * and run a command. The palette's container (`Palette.tsx`) shows the
 * rows; this module runs them, and opens and closes the palette.
 */
import type { PaletteCommand, SearchMessage, SearchPerson } from '@juno/contract'
import { loadOlderMessages, paletteOpenAtom, registry, sendMessage, showToast, type OpenOptions } from '@juno/state'
import { mark } from '@juno/state/perf'
import { junoCommands, openJunoTab } from './juno/actions'
import { openNewChatTo, openTopic, openTopicAt } from './navigation'
import { resolveTopic } from './topicActions'

/** Where focus was before the palette opened, to give it back on close. */
let returnFocus: HTMLElement | undefined

export function openPalette(): void {
  if (registry.get(paletteOpenAtom)) return
  mark('juno.palette-open', undefined, { replace: true })
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
  registry.set(paletteOpenAtom, true)
}

/** Closes the palette. `restoreFocus` is false when a row opened something that takes focus itself. */
export function closePalette(restoreFocus = true): void {
  if (!registry.get(paletteOpenAtom)) return
  registry.set(paletteOpenAtom, false)
  const target = returnFocus
  returnFocus = undefined
  if (restoreFocus && target?.isConnected === true) target.focus({ preventScroll: true })
}

/** ⌘K toggles: it opens the palette, and closes it again. */
export function togglePalette(): void {
  if (registry.get(paletteOpenAtom)) closePalette()
  else openPalette()
}

/** The ts just after `ts`, so a page fetched "before" it includes it. */
function justAfter(ts: string): string {
  const [seconds = '0', micros = '0'] = ts.split('.')
  const next = Number(micros) + 1
  return next >= 1_000_000 ? `${Number(seconds) + 1}.000000` : `${seconds}.${String(next).padStart(6, '0')}`
}

/**
 * A message result: its topic, opened at it, and it flashes. A match only
 * Slack's search found is fetched first, with the page that ends at it, so
 * the topic opens at it rather than at the bottom.
 */
export async function openMessage(message: SearchMessage, options: OpenOptions): Promise<void> {
  if (!message.stored) await loadOlderMessages(registry, message.topicId, justAfter(message.ts))
  openTopicAt(message.topicId, message.ts, { ...options, flash: true })
}

/** A person's result: your Main with them, or a New chat addressed to them when you have never messaged (spec section 10). */
export function openPerson(person: Pick<SearchPerson, 'person' | 'mainId'>, options: OpenOptions): void {
  if (person.mainId !== undefined) return openTopic(person.mainId, options)
  openNewChatTo({ key: `u:${person.person.id}`, name: person.person.name, kind: 'im', tint: 'dm', person: person.person, empty: true })
}

/**
 * Runs a command row. A send posts at once into that Main; sends are final
 * (ADR 0010), so the toast has no Undo. "Ask" opens Juno with the request.
 */
export async function runPaletteCommand(command: PaletteCommand): Promise<void> {
  switch (command.kind) {
    case 'send-dm':
    case 'post': {
      const to = command.kind === 'send-dm' ? { kind: 'person' as const, userId: command.userId } : { kind: 'channel' as const, channelId: command.channelId }
      const exit = await sendMessage(registry, to, command.text)
      showToast(registry, { text: exit._tag === 'Success' ? `Posted in ${command.place} · Main` : `Could not post in ${command.place}` })
      return
    }
    case 'open-dm':
      return openPerson(command, {})
    case 'ask':
      openJunoTab()
      junoCommands.send(command.prompt)
      return
    case 'resolve':
      return resolveTopic(command.topicId)
  }
}
