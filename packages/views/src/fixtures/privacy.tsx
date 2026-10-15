import { useLayoutEffect, type ReactNode } from 'react'
import { applyPrivacy } from '@juno/ui'

/** Turns privacy mode on for a fixture, as the app does on <html>, and off again when it goes. */
export function PrivacyOn({ children }: { readonly children: ReactNode }) {
  useLayoutEffect(() => {
    applyPrivacy(true)
    return () => applyPrivacy(false)
  }, [])
  return children
}
