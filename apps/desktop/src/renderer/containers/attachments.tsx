import { useCallback, useEffect, useMemo } from 'react'
import { attachmentsAtom, clearAttachments, readyFiles, registry, removeAttachment, restoreAttachments, sendableFiles, whenStarted, type Attachment } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { AttachButton } from '@juno/views'
import { chunk } from './chunks'

const chipsPanel = chunk(() => import('./AttachmentChipsPanel'))
const AttachmentChipsPanel = chipsPanel.component((module) => module.default)

/** Fetch the chips' and the staging's chunks once a composer has painted, so the first attach does not wait for them. */
let preloaded = false
function preload(): void {
  if (preloaded) return
  preloaded = true
  window.requestIdleCallback(() => {
    void chipsPanel.load()
    void import('./staging')
  })
}

/** Paste, drop and attach load the chips before staging publishes files, so the composer grows once. */
export const attach = (key: string, files: ReadonlyArray<File>) =>
  void Promise.all([chipsPanel.load(), import('./staging')]).then(([, { stageFiles }]) => stageFiles(key, files))

/**
 * A composer's attachments (spec section 8): the attach button, the chips
 * and the handler for pasted and dropped files, for the composer whose
 * draft `key` owns (a topic, or a Home tab). Without `tabbable` the
 * attach button is out of the Tab order and works by pointer.
 */
export function useAttachments(key: string, { tabbable = true }: { readonly tabbable?: boolean } = {}) {
  const files = useAtomValue(attachmentsAtom(key))
  useEffect(preload, [])
  const onFiles = useCallback((list: ReadonlyArray<File>) => attach(key, list), [key])
  const leading = useMemo(() => <AttachButton onFiles={onFiles} tabbable={tabbable} />, [onFiles, tabbable])
  const onRemove = useCallback((id: string) => removeAttachment(registry, key, id), [key])
  const chips = files.length === 0 ? undefined : <AttachmentChipsPanel files={files} onRemove={onRemove} />
  return { files, onFiles, leading, chips }
}

/**
 * The staged files a send takes, which leave the composer: `undefined`
 * while one is still staging, so Enter waits for it. With `staging`, files
 * still staging go too, and the post waits for them in the engine (the
 * topic composer, spec section 8); `started` resolves once the engine
 * knows each of them, and the send goes after it. `restore` puts them back
 * after a send that queued nothing.
 */
export function takeAttachments(
  key: string,
  { staging = false }: { readonly staging?: boolean } = {},
): { readonly ids: ReadonlyArray<string>; readonly started: Promise<unknown>; readonly restore: () => void } | undefined {
  const ids = staging ? sendableFiles(registry, key) : readyFiles(registry, key)
  if (ids === undefined) return undefined
  const taken: ReadonlyArray<Attachment> = registry.get(attachmentsAtom(key))
  clearAttachments(registry, key)
  return { ids, started: whenStarted(ids), restore: () => restoreAttachments(registry, key, taken) }
}
