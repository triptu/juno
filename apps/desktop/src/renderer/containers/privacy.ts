import { persistPrivacy, privacyAtom, registry } from '@juno/state'

/**
 * Privacy mode (SPEC section 5): the account menu, the sidebar footer and
 * ⌃⌘H all come here. Main remembers it for the next launch and leaves the
 * text out of notifications while it is on.
 */
export function setPrivacy(on: boolean): void {
  registry.set(privacyAtom, on)
  persistPrivacy(on)
}

export function togglePrivacy(): void {
  setPrivacy(!registry.get(privacyAtom))
}
