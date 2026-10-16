import { onSharingPrivacy, persistPrivacy, privacyAtom, privacySharingAtom, registry } from '@juno/state'

/**
 * Privacy mode (SPEC section 5): the account menu, the sidebar footer and
 * ⌃⌘H all come here. Main remembers it for the next launch and leaves the
 * text out of notifications while it is on. The user's choice ends any
 * claim sharing had on it, so it stays as they set it when sharing ends.
 */
export function setPrivacy(on: boolean): void {
  registry.set(privacyAtom, on)
  registry.set(privacySharingAtom, false)
  persistPrivacy(on)
}

export function togglePrivacy(): void {
  setPrivacy(!registry.get(privacyAtom))
}

/** Follows main turning the mode on when sharing starts and off when it ends. Main already saved it. Returns the unsubscribe. */
export function followSharingPrivacy(): () => void {
  return onSharingPrivacy(({ privacy, sharing }) => {
    registry.set(privacyAtom, privacy)
    registry.set(privacySharingAtom, sharing)
  })
}
