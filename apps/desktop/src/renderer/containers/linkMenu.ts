import type { ContextMenuItem } from '@juno/contract'
import { canOpenWebPanel, copyText, openExternal, openWebPanelInJuno, popupContextMenu, registry, webPanelOpensInJuno } from '@juno/state'
import { messageLinkKind, openMessageLink } from './slackLinks'

type LinkMenuKind =
  | { readonly kind: 'email'; readonly address: string }
  | { readonly kind: 'juno' }
  | { readonly kind: 'web'; readonly opensInJuno: boolean; readonly canOpenInJuno: boolean }
  | { readonly kind: 'browser' }

const plainOpen = { metaKey: false, shiftKey: false, altKey: false, source: 'pointer' } as const
const backgroundOpen = { ...plainOpen, metaKey: true } as const

function emailAddress(url: string): string | undefined {
  if (!url.toLowerCase().startsWith('mailto:')) return undefined
  const address = url.slice(url.indexOf(':') + 1).split('?', 1)[0]
  if (address === undefined || address.length === 0) return undefined
  try {
    return decodeURIComponent(address)
  } catch {
    return address
  }
}

function kindOf(url: string): LinkMenuKind {
  const address = emailAddress(url)
  if (address !== undefined) return { kind: 'email', address }
  const kind = messageLinkKind(url)
  if (kind !== 'web') return { kind }
  return { kind: 'web', opensInJuno: webPanelOpensInJuno(registry, url), canOpenInJuno: canOpenWebPanel(registry, url) }
}

const separator = { separator: true } as const
const copyLink = { id: 'copy-link', label: 'Copy link' } as const

function itemsOf(kind: LinkMenuKind): ReadonlyArray<ContextMenuItem> {
  switch (kind.kind) {
    case 'email':
      return [{ id: 'copy-email', label: 'Copy email address' }, { id: 'new-email', label: 'New email' }]
    case 'juno':
      return [{ id: 'open-link', label: 'Open link' }, { id: 'open-background', label: 'Open in background', sublabel: '⌘ click' }, separator, copyLink]
    case 'browser':
      return [{ id: 'open-link', label: 'Open link' }, separator, copyLink]
    case 'web':
      return [
        { id: 'open-link', label: 'Open link' },
        ...(kind.opensInJuno
          ? [{ id: 'open-browser', label: 'Open in browser', sublabel: '⌘ click' }]
          : kind.canOpenInJuno
            ? [{ id: 'open-juno', label: 'Open in Juno' }]
            : []),
        separator,
        copyLink,
      ]
  }
}

/** Shows the native menu for one message link and applies the chosen action. */
export async function showLinkMenu(url: string, at: { readonly x: number; readonly y: number }): Promise<void> {
  const kind = kindOf(url)
  const chosen = await popupContextMenu(itemsOf(kind), at)
  switch (chosen) {
    case 'copy-email':
      if (kind.kind === 'email') copyText(kind.address)
      return
    case 'new-email':
      return openExternal(url)
    case 'open-link':
      return openMessageLink(url, plainOpen)
    case 'open-background':
      return openMessageLink(url, backgroundOpen)
    case 'open-browser':
      return openExternal(url)
    case 'open-juno':
      return openWebPanelInJuno(registry, url)
    case 'copy-link':
      await copyText(url)
      return
  }
}
