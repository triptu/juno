import { CheckCircle } from '@phosphor-icons/react/dist/icons/CheckCircle'
import { Toast, ToastRegion } from '@juno/ui'
import { menuKeys } from './keys'

export interface ActionToastProps {
  /** "Resolved · Postgres 16 migration plan" (SPEC 17, inventory 16). */
  readonly text: string
  /** The resolve toast's check. */
  readonly check?: boolean
  /** Undo, for a reversible action. Without it the toast only informs. */
  readonly onUndo?: () => void
  /** A way on from the message, such as "Change limit", when there is no Undo. */
  readonly action?: { readonly label: string; readonly onAction: () => void }
}

/** The one toast, bottom-left of the window (inventory 16): what an action did, with Undo ⌘Z when it can be undone. */
export function ActionToast({ text, check = false, onUndo, action }: ActionToastProps) {
  return (
    <ToastRegion>
      <Toast
        text={text}
        {...(check ? { icon: CheckCircle } : {})}
        {...(onUndo !== undefined ? { action: { label: 'Undo', kbd: menuKeys('edit.undo'), onAction: onUndo } } : action !== undefined ? { action } : {})}
      />
    </ToastRegion>
  )
}
