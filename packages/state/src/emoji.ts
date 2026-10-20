/** Loaded with the picker chunk, after the first list paint. One subscription per app. */
import * as Atom from 'effect/reactivity/Atom'
import { Schema } from 'effect'
import { WorkspaceEmojiValue, emojiCatalog, prepareEmojiPicker, workspaceEmoji, type PreparedEmojiPicker, type EmojiCategory } from '@juno/contract'
import { mark, measure } from './perf'
import { registry } from './client'
import { composerEmojiAtom } from './mentions'
import { install } from './emojiCodec.generated.mjs'

// Static compiler output keeps the cold decoder fast without dynamic code in the renderer.
install([WorkspaceEmojiValue.ast])
Schema.decodeUnknownSync(WorkspaceEmojiValue)('[]')

export const workspaceEmojiDataAtom = Atom.make((get) => {
  const answer = get(composerEmojiAtom(true))
  if (answer._tag !== 'Success') return undefined
  const started = mark('juno.emoji-resolve')
  const custom = workspaceEmoji(answer.value, emojiCatalog)
  measure('juno.emoji-resolve', started, { replace: true })
  return custom
}).pipe(Atom.keepAlive)

export const emojiPickerDataAtom = Atom.family((catalog: ReadonlyArray<EmojiCategory>) => Atom.make((get) => {
  const custom = get(workspaceEmojiDataAtom)
  if (custom === undefined) return undefined
  const started = mark('juno.emoji-prepare')
  const data = prepareEmojiPicker(catalog, custom)
  measure('juno.emoji-prepare', started, { replace: true })
  return { custom, data }
}).pipe(Atom.keepAlive))

let warmed = false
export function warmWorkspaceEmoji(catalog: ReadonlyArray<EmojiCategory>): void {
  if (warmed) return
  warmed = true
  const started = mark('juno.emoji-subscribe')
  const atom = emojiPickerDataAtom(catalog)
  registry.mount(atom)
  let measured = false
  registry.subscribe(atom, (value) => {
    if (value === undefined) return
    prepared = value.data
    ready()
    if (!measured) { measure('juno.emoji-ready', started); measured = true }
  }, { immediate: true })
}

let prepared: PreparedEmojiPicker | undefined
let ready: () => void = () => {}
export const workspaceEmojiReady = new Promise<void>((resolve) => { ready = resolve })

/** Reads only the global preload's cache. It cannot start or retain a subscription. */
export function cachedEmojiImages(names: ReadonlyArray<string>): ReadonlyMap<string, string> {
  const images = new Map<string, string>()
  for (const name of names) {
    const url = prepared?.byName.get(name)?.url
    if (url !== undefined) images.set(name, url)
  }
  return images
}
