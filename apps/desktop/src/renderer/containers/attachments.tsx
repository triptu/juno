import { lazy, Suspense, useCallback, useEffect, useMemo } from 'react'
import { attachmentsAtom, clearAttachments, readyFiles, registry, removeAttachment, restoreAttachments, type Attachment } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { AttachButton } from '@juno/views'

const AttachmentChipsPanel = lazy(() => import('./AttachmentChipsPanel'))

/** Fetch the chips' and the staging's chunks once a composer has painted, so the first attach does not wait for them. */
let preloaded = false
function preload(): void {
  if (preloaded) return
  preloaded = true
  window.requestIdleCallback(() => {
    void import('./AttachmentChipsPanel')
    void import('./staging')
  })
}

/** Adds files to the composer whose draft `key` owns: paste, drop and the attach button all end here. */
export const attach = (key: string, files: ReadonlyArray<File>) => void import('./staging').then(({ stageFiles }) => stageFiles(key, files))

/**
 * A composer's attachments (spec section 8): the attach button, the chips
 * and the handler for pasted and dropped files, for the composer whose
 * draft `key` owns (a topic, or a New chat tab).
 */
export function useAttachments(key: string) {
  const files = useAtomValue(attachmentsAtom(key))
  useEffect(preload, [])
  const onFiles = useCallback((list: ReadonlyArray<File>) => attach(key, list), [key])
  const leading = useMemo(() => <AttachButton onFiles={onFiles} />, [onFiles])
  const onRemove = useCallback((id: string) => removeAttachment(registry, key, id), [key])
  const chips =
    files.length === 0 ? undefined : (
      <Suspense fallback={null}>
        <AttachmentChipsPanel files={files} onRemove={onRemove} />
      </Suspense>
    )
  return { files, onFiles, leading, chips }
}

/**
 * The staged files a send takes, which leave the composer: `undefined`
 * while one is still staging, so Enter waits for it. `restore` puts them
 * back after a send that queued nothing.
 */
export function takeAttachments(key: string): { readonly ids: ReadonlyArray<string>; readonly restore: () => void } | undefined {
  const ids = readyFiles(registry, key)
  if (ids === undefined) return undefined
  const taken: ReadonlyArray<Attachment> = registry.get(attachmentsAtom(key))
  clearAttachments(registry, key)
  return { ids, restore: () => restoreAttachments(registry, key, taken) }
}
