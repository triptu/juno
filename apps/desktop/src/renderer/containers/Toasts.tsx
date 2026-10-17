import { useEffect } from 'react'
import { dismissToast, registry, TOAST_LIFE_MS, toastAtom } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { ActionToast } from '@juno/views'
import { undoFromToast } from './topicActions'

/** The one toast (inventory 16). It goes after 5 s with Undo, 4 s without; a new toast replaces it. */
export function Toasts() {
  const toast = useAtomValue(toastAtom)
  const key = toast?.key
  const undoable = toast?.undoable === true
  // A toast with a button to follow stays as long as one with Undo.
  const lasting = undoable || toast?.action !== undefined
  useEffect(() => {
    if (key === undefined) return
    const timer = setTimeout(() => dismissToast(registry, key), lasting ? TOAST_LIFE_MS.undo : TOAST_LIFE_MS.info)
    return () => clearTimeout(timer)
  }, [key, lasting])
  if (toast === undefined) return null
  return <ActionToast key={toast.key} text={toast.text} check={toast.check === true} {...(toast.undoable ? { onUndo: undoFromToast } : {})}
    {...(toast.action === undefined ? {} : { action: { label: toast.action.label, onAction: () => { dismissToast(registry, toast.key); toast.action!.onAction() } } })} />
}
